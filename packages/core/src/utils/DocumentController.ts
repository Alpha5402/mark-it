
import { BlockModel, InlineModel, ListItemBlock, HeadingBlock, BlockquoteBlock, CodeBlock, TextInline, INLINE_FLAG } from "../types"
import { parseLine, inlineParse } from "./parse"
import { initialTokenize, tokenizeByLine, uid } from "./tokenize"
import { BlockMatchResult, matchListItem, matchHeading } from "./matcher"

export class DocumentController {
  blocks = new Map<string, BlockModel>()
  
  constructor(content: string) {
    initialTokenize(content).forEach(raw => {
      const parsed = parseLine(raw)
      this.blocks.set(parsed.id, parsed)
    })
  }
  
  getBlocks = () => this.blocks
  getBlock = (id: string) => this.blocks.get(id)

  /**
   * 从快照恢复所有 blocks（用于 Undo/Redo）
   * @param entries 快照中的 [id, block][] 数组
   */
  restoreFromSnapshot(entries: [string, BlockModel][]): void {
    this.blocks = new Map(entries)
  }

  updateBlock = (id: string, line: string): BlockModel => {
    const raw = tokenizeByLine(line, id)
    const parsed = parseLine(raw)
    this.blocks.set(id, parsed)
    return parsed
  }

  insertBlockAfter = (blockId: string, block: BlockModel) => {
    this.blocks.set(blockId, block)
  }

  /**
   * 从 block model 重建整行原始 Markdown 文本（包含标识符）
   * 例如 list-item: "- **bold**text" / heading: "## title"
   */
  getRawText(blockId: string): string {
    const block = this.blocks.get(blockId)
    if (!block) return ''

    let raw = ''

    // 1. 缩进
    if (block.nesting && block.nesting > 0) {
      raw += ' '.repeat(block.nesting)
    }

    // 2. 结构性标记符
    if (block.type === 'list-item') {
      const listItem = block as ListItemBlock
      if (listItem.style.ordered) {
        raw += listItem.style.order
      } else if ('task' in listItem.style && listItem.style.task) {
        raw += '- [' + (listItem.style.checked ? 'x' : ' ') + '] '
      } else {
        raw += '- '
      }
    } else if (block.type === 'heading') {
      const heading = block as HeadingBlock
      raw += '#'.repeat(heading.headingDepth) + ' '
    } else if (block.type === 'hr') {
      return '---'
    } else if (block.type === 'blockquote') {
      const bq = block as BlockquoteBlock
      raw += '>'.repeat(bq.quoteDepth) + ' '
    } else if (block.type === 'code-block') {
      const cb = block as CodeBlock
      return '```' + cb.language + '\n' + cb.code + '\n```'
    }

    // 3. inline 内容（包含 inline 标记符）
    if (block.inline) {
      raw += this.inlineToRawText(block.inline)
    }

    return raw
  }

  /**
   * 将 inline model 数组重建为原始 Markdown 文本（包含标记符如 **、~~、== 等）
   */
  inlineToRawText(inlines: InlineModel[]): string {
    let result = ''
    for (const inline of inlines) {
      if (inline.type === 'text') {
        if (inline.markers && inline.marks !== 0) {
          result += inline.markers.prefix + inline.text + inline.markers.suffix
        } else {
          result += inline.text
        }
      } else if (inline.type === 'link') {
        const linkText = this.inlineToRawText(inline.children)
        result += `[${linkText}](${inline.href})`
      } else if (inline.type === 'image') {
        result += `![${inline.alt}](${inline.src})`
      }
    }
    return result
  }

  /**
   * 从修改后的原始文本进行全行 reconcile
   * 用于标识符内部输入的场景
   */
  reconcileFromRawText(blockId: string, newRawText: string): 
    { kind: 'inline-update'; block: BlockModel } | 
    { kind: 'block-transform'; from: BlockModel; to: BlockModel } | 
    { kind: 'code-block-degrade'; from: BlockModel; lines: BlockModel[] } |
    null {
    const block = this.blocks.get(blockId)
    if (!block) return null

    // 代码块特殊处理：如果编辑后不再匹配代码块正则，按行拆分退化为多个 block
    if (block.type === 'code-block') {
      const codeBlockMatch = newRawText.match(/^(`{3,}|~{3,})\s*(.*)\n([\s\S]*)\n\1\s*$/)
      if (codeBlockMatch) {
        // 仍然是合法的代码块，更新内容
        const newBlock: CodeBlock = {
          id: block.id,
          type: 'code-block',
          language: codeBlockMatch[2].trim(),
          code: codeBlockMatch[3],
          inline: []
        }
        this.blocks.set(blockId, newBlock)
        if (newBlock.language !== (block as CodeBlock).language || newBlock.code !== (block as CodeBlock).code) {
          return { kind: 'block-transform', from: block, to: newBlock }
        }
        return { kind: 'inline-update', block: newBlock }
      } else {
        // 代码块语法被破坏，按行拆分为多个 paragraph
        const lines = newRawText.split('\n')
        const newBlocks: BlockModel[] = []
        
        // 第一行复用当前 block 的 id
        for (let i = 0; i < lines.length; i++) {
          const line = tokenizeByLine(lines[i], i === 0 ? block.id : undefined)
          const parsed = parseLine(line)
          newBlocks.push(parsed)
        }
        
        // 更新 blocks map：删除旧的 code-block，插入新的多行 block
        // 重建 Map 保证顺序
        const newBlocksMap = new Map<string, BlockModel>()
        for (const [id, b] of this.blocks) {
          if (id === blockId) {
            for (const nb of newBlocks) {
              newBlocksMap.set(nb.id, nb)
            }
          } else {
            newBlocksMap.set(id, b)
          }
        }
        this.blocks = newBlocksMap
        
        return { kind: 'code-block-degrade', from: block, lines: newBlocks }
      }
    }

    // 当 blockquote 的引用符号被完全删除后，行首可能残留空格
    // （`> text` → ` text`），需要去掉行首的空格
    let rawTextForParse = newRawText
    if (block.type === 'blockquote' && !newRawText.startsWith('>')) {
      rawTextForParse = newRawText.replace(/^\s/, '')
    }

    // 用 parseLine 重新解析整行文本（需要正确提取 leading 以保留缩进信息）
    const leading = rawTextForParse.match(/^[ \t]*/)?.[0] ?? ''
    const newBlock = parseLine({ id: block.id, raw: rawTextForParse, leading })

    // 判断是否发生了结构变化
    if (newBlock.type !== block.type) {
      // 结构变化（如 list-item → paragraph，heading → paragraph）
      this.blocks.set(blockId, newBlock)
      return { kind: 'block-transform', from: block, to: newBlock }
    }

    // 类型相同但可能深度变了（heading）
    if (newBlock.type === 'heading' && block.type === 'heading') {
      const newHeading = newBlock as HeadingBlock
      const oldHeading = block as HeadingBlock
      if (newHeading.headingDepth !== oldHeading.headingDepth) {
        this.blocks.set(blockId, newBlock)
        return { kind: 'block-transform', from: block, to: newBlock }
      }
    }

    // 结构不变，更新 inline
    block.inline = newBlock.inline
    block.nesting = newBlock.nesting
    return { kind: 'inline-update', block }
  }

  reconcileBlock(id: string, domText: string) {
    const block = this.blocks.get(id)
    if (!block) return null

    let result: BlockMatchResult | null = null

    switch (block.type) {
      case 'list-item':
        result = matchListItem(domText, block as ListItemBlock)
        break
      case 'heading':
        result = matchHeading(domText, block as HeadingBlock)
        break
      default:
        // result = {
        //   type: 'keep',
        //   inline: parseInline(domText)
        // }
    }

    if (!result) return null

    if (result.type === 'keep') {
      block.inline = result.inline
      return { kind: 'inline-update', block }
    }

    if (result.type === 'transform') {
      this.blocks.set(id, result.to)
      return { kind: 'block-transform', from: block, to: result.to }
    }
  }

  transformListItemToParagraph(block: BlockModel): BlockModel {
    return {
      id: block.id,
      type: 'paragraph',
      nesting: block.nesting,
      inline: block.inline ?? [],
    }
  }

  /**
   * 获取指定 block 的前一个 block ID（按文档顺序）
   * 如果已经是第一个 block 则返回 null
   */
  getPreviousBlockId(blockId: string): string | null {
    const ids = Array.from(this.blocks.keys())
    const idx = ids.indexOf(blockId)
    if (idx <= 0) return null
    return ids[idx - 1]
  }

  /**
   * 将当前 block 的内容合并到前一个 block 末尾，然后删除当前 block
   * 返回合并后的 block 和光标应该定位的语义偏移量
   * 
   * 合并策略：
   * - 将当前 block 的原始文本（不含结构前缀）追加到前一个 block 的原始文本末尾
   * - 用 reconcileFromRawText 重新解析前一个 block
   * - 删除当前 block
   */
  mergeBlockWithPrevious(blockId: string): {
    mergedBlock: BlockModel
    cursorRawOffset: number
    removedBlockId: string
  } | null {
    const prevId = this.getPreviousBlockId(blockId)
    if (!prevId) return null

    const currentBlock = this.blocks.get(blockId)
    const prevBlock = this.blocks.get(prevId)
    if (!currentBlock || !prevBlock) return null

    // 获取前一个 block 的原始文本
    const prevRawText = this.getRawText(prevId)
    // 光标应该定位在前一个 block 原始文本的末尾
    const cursorRawOffset = prevRawText.length

    // 获取当前 block 的完整原始文本（包含结构前缀如 ##、- 等）
    // 因为在 markdown 源码中，这些标识符是真实存在的文本
    const currentRawText = this.getRawText(blockId)

    // 合并后的文本 = 前一个 block 原始文本 + 当前 block 完整原始文本
    const mergedRawText = prevRawText + currentRawText

    // 用 reconcile 重新解析前一个 block
    const effect = this.reconcileFromRawText(prevId, mergedRawText)
    if (!effect) return null
    if (effect.kind === 'code-block-degrade') return null

    const mergedBlock = effect.kind === 'block-transform' ? effect.to : effect.block

    // 删除当前 block
    this.blocks.delete(blockId)

    return {
      mergedBlock,
      cursorRawOffset,
      removedBlockId: blockId
    }
  }

  prefixOffset = (BlockId: string) => {
    const block = this.blocks.get(BlockId)
    if (!block || !block.inline) return 0

    // let currentOffset = 0
    let prefixOffset = 0

    if (block.nesting) {
      // 每个 fullLevel indent = 4 个空格字符，remainder = 对应数量的空格字符
      // 总偏移 = nesting（即空格总数）
      prefixOffset += block.nesting
    }

    if (block.type === 'list-item') {
      const listItem = block as ListItemBlock
      if (listItem.style.ordered) {
        prefixOffset += listItem.style.order.length
      } else if ('task' in listItem.style && listItem.style.task) {
        // "- [x] " = 6 characters
        prefixOffset += 6
      } else {
        prefixOffset += 2
      }
    }

    if (block.type === 'heading') {
      const heading = block as HeadingBlock
      // heading marker: n 个 # + 1 个空格
      prefixOffset += heading.headingDepth + 1
    }

    if (block.type === 'blockquote') {
      const bq = block as BlockquoteBlock
      // blockquote marker: n 个 > + 1 个空格
      prefixOffset += bq.quoteDepth + 1
    }

    return prefixOffset
  }

  /**
   * 从原始 Markdown 文本创建一个新 block 并注册到文档中
   * 确保新 block 插入到 afterBlockId 指定的 block 之后（Map 顺序）
   * 用于展开模式下的换行操作
   */
  createBlockFromRawText(rawText: string, afterBlockId?: string): BlockModel {
    const line = tokenizeByLine(rawText)
    const block = parseLine(line)

    if (afterBlockId) {
      // 需要在 afterBlockId 之后插入，重建 Map 保证顺序
      const newBlocks = new Map<string, BlockModel>()
      for (const [id, b] of this.blocks) {
        newBlocks.set(id, b)
        if (id === afterBlockId) {
          newBlocks.set(block.id, block)
        }
      }
      this.blocks = newBlocks
    } else {
      this.blocks.set(block.id, block)
    }

    return block
  }

  recoveryOffset = (BlockId: string, offset: number) => {
    const block = this.blocks.get(BlockId)
    if (!block || !block.inline) return

    // let currentOffset = 0
    const prefixOffset = this.prefixOffset(BlockId)
    
    const textOffset = offset - prefixOffset
    if (textOffset < 0) return
    
    let targetIndex = -1
    let insertPos = 0

    for (let i = 0; i < block.inline.length; i++) {
      const inline = block.inline[i]
      const start = inline.offset
      if (inline.type !== 'text') continue
      const end = start + inline.text.length

      if (textOffset >= start && textOffset <= end) {
        targetIndex = i
        insertPos = textOffset - start
        break
      }
    }

    if (targetIndex === -1 && block.inline.length > 0) {
      targetIndex = block.inline.length - 1
      const last = block.inline[targetIndex]
      if (last.type !== 'text') return
      insertPos = last.text.length
    }

    const target = block.inline[targetIndex]
    if (!target || target.type !== 'text') return

    return {
      target, 
      targetIndex,
      insertPos
    }
  }

  insertText(BlockId: string, offset: number, text: string) {
    const block = this.getBlock(BlockId)
    const result = this.recoveryOffset(BlockId, offset)
    if (!block || !result) return
    
    const { target, targetIndex, insertPos } = result

    // 3️⃣ 更新 target inline
    target.text =
      target.text.slice(0, insertPos) +
      text +
      target.text.slice(insertPos)

    target.dirty = true

    const delta = text.length

    // 4️⃣ 更新 target 之后所有 inline 的 offset
    if (!block.inline) return 

    for (let i = targetIndex + 1; i < block.inline.length; i++) {
      block.inline[i].offset += delta
      block.inline[i].dirty = true
    }
  }

  /**
   * 在指定偏移处删除一个字符（向后删除，即 Backspace）
   * 返回删除后需要定位的光标偏移量，或 null 表示需要跨 block 合并
   */
  deleteText(blockId: string, offset: number): { newOffset: number } | null {
    const block = this.getBlock(blockId)
    if (!block || !block.inline) return null

    const prefixOffset = this.prefixOffset(blockId)
    
    // 如果光标在文本开头（prefixOffset 处），需要跨 block 合并
    if (offset <= prefixOffset) {
      return null
    }

    const result = this.recoveryOffset(blockId, offset)
    if (!result) return null

    const { target, targetIndex, insertPos } = result

    if (insertPos <= 0) {
      // 在该 inline 段的开头，需要检查是否有前一个 inline 段
      if (targetIndex > 0) {
        const prevInline = block.inline[targetIndex - 1]
        if (prevInline.type === 'text' && prevInline.text.length > 0) {
          prevInline.text = prevInline.text.slice(0, -1)
          prevInline.dirty = true
          // 更新后续 inline 的 offset
          for (let i = targetIndex; i < block.inline.length; i++) {
            block.inline[i].offset -= 1
            block.inline[i].dirty = true
          }
          return { newOffset: offset - 1 }
        }
      }
      return null
    }

    // 正常删除：在当前 inline 段内删除一个字符
    target.text = target.text.slice(0, insertPos - 1) + target.text.slice(insertPos)
    target.dirty = true

    // 更新后续 inline 的 offset
    if (block.inline) {
      for (let i = targetIndex + 1; i < block.inline.length; i++) {
        block.inline[i].offset -= 1
        block.inline[i].dirty = true
      }
    }

    return { newOffset: offset - 1 }
  }

  splitBlock(BlockId: string, offset: number) {
    const block = this.getBlock(BlockId)
    const result = this.recoveryOffset(BlockId, offset)
    if (!block || !result) return
    
    const { target, targetIndex, insertPos } = result

    // block.inline = block.inline.slice(0, insertPos)
    const beforeInline: InlineModel = {
      type: target.type,
      text: target.text.slice(0, insertPos),
      marks: target.marks,
      offset: target.offset,
      dirty: true
    }

    if (!block.inline) return 
    const before = [...block.inline.slice(0, targetIndex), beforeInline]

    const afterInline: InlineModel = {
      type: target.type,
      text: target.text.slice(insertPos),
      marks: target.marks,
      offset: 0,
      dirty: true
    }
    const after = [afterInline, ...block.inline.slice(targetIndex + 1)]

    const delta = target.offset

    for (let i = 0; i < after.length; i++) {
      after[i].dirty = true

      if (i === 0) continue
      after[i].offset -= (delta + beforeInline.text.length)
    }

    target.dirty = true

    block.inline = before
    const newLine = cloneBlock(block, after)
    this.blocks.set(newLine.id, newLine)

    return newLine
  }
}

function splitInline(inlines: InlineModel[], offset: number): {
  before: InlineModel[]
  after: InlineModel[]
} {
  const before: InlineModel[] = []
  const after: InlineModel[] = []

  inlines.forEach(inline => {
    if (inline.type === 'text') {
      const local = offset - inline.offset

      const left = {
        ...inline,
        text: inline.text.slice(0, local)
      }

      const right = {
        ...inline,
        text: inline.text.slice(local),
        offset: 0 // ⚠️ 新 block 重新计算
      }

      before.push(left)
      after.push(right)
    } else if (inline.type === 'link') {
      const local = offset - inline.offset

      const { before: c1, after: c2 } =
        splitInline(inline.children, local)

      before.push({
        ...inline,
        children: c1
      })

      after.push({
        ...inline,
        children: c2,
        offset: 0
      })
    }
  })

  return { before, after }
}

function findInlineAtOffset(inlines: InlineModel[], offset: number) {
  for (let i = 0; i < inlines.length; i++) {
    const cur = inlines[i]
    const next = inlines[i + 1]

    if (!next || offset < next.offset) {
      return { index: i, inline: cur }
    }
  }
}

function cloneBlock(origin: BlockModel, inline: InlineModel[]): ListItemBlock | BlockModel {
  if (origin.type === 'list-item') {
    const newBlock = origin as ListItemBlock
    const newStyle = newBlock.style.ordered
      ? { ordered: true as const, order: incrementOrder(newBlock.style.order) }
      : 'task' in newBlock.style && newBlock.style.task
        ? { ordered: false as const, task: true as const, checked: false }
        : { ordered: false as const }
    return {
      ...newBlock,
      id: uid(),
      inline: inline,
      style: newStyle
    }
  }
  
  return {
    ...origin,
    id: uid(),
    inline: inline
  }
}

// function cloneBlockStructure(block: BlockModel): ListItemBlock | BlockModel {
//   if (block.type === 'list-item') {
//     const newBlock = block as ListItemBlock
//     return {
//       ...newBlock,
//       id: uid(),
//       inline: [],
//       style: {
//         ordered: newBlock.style.ordered,
//         order: newBlock.style.ordered ? incrementOrder(newBlock.style.order) : ''
//       }
//     }
//   }

//   return {
//     ...block,
//     id: uid(),
//     inline: []
//   }
// }

function incrementOrder(order: string) {
  if (Number.parseInt(order)) {
    return `${Number.parseInt(order) + 1}.`
  }
  return ''
}
