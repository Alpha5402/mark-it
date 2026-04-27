
import { BlockModel, InlineModel, ListItemBlock, HeadingBlock, TextInline, INLINE_FLAG } from "../types"
import { parseLine, inlineParse } from "./parse"
import { initialTokenize, tokenizeByLine, uid } from "./tokenize"
import { BlockMatchResult, matchListItem, matchHeading } from "./matcher"

export class DocumentController {
  blocks = new Map<string, BlockModel>()
  
  constructor(content: string) {
    initialTokenize(content).forEach(raw => {
      const parsed = parseLine(raw)
      this.blocks.set(parsed.id, parsed)
      // console.log(parsed)
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
      } else {
        raw += '- '
      }
    } else if (block.type === 'heading') {
      const heading = block as HeadingBlock
      raw += '#'.repeat(heading.headingDepth) + ' '
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
  private inlineToRawText(inlines: InlineModel[]): string {
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
    null {
    const block = this.blocks.get(blockId)
    if (!block) return null

    // 用 parseLine 重新解析整行文本（需要正确提取 leading 以保留缩进信息）
    const leading = newRawText.match(/^[ \t]*/)?.[0] ?? ''
    const newBlock = parseLine({ id: block.id, raw: newRawText, leading })

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
      prefixOffset += listItem.style.ordered 
        ? listItem.style.order.length + 1 
        : 2
    }

    if (block.type === 'heading') {
      const heading = block as HeadingBlock
      // heading marker: n 个 # + 1 个空格
      prefixOffset += heading.headingDepth + 1
    }

    return prefixOffset
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
    return {
      ...newBlock,
      id: uid(),
      inline: inline,
      style: {
        ordered: newBlock.style.ordered,
        order: newBlock.style.ordered ? incrementOrder(newBlock.style.order) : ''
      }
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
