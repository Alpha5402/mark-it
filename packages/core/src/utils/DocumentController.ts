
import { BlockModel, InlineModel, ListItemBlock, HeadingBlock, TextInline } from "../types"
import { parseLine } from "./parse"
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

  updateBlock = (id: string, line: string): BlockModel => {
    const raw = tokenizeByLine(line, id)
    const parsed = parseLine(raw)
    this.blocks.set(id, parsed)
    return parsed
  }

  insertBlockAfter = (blockId: string, block: BlockModel) => {
    this.blocks.set(blockId, block)
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
      const indent = Math.floor(block.nesting / 4)
      const space = block.nesting % 4
      prefixOffset += (indent + space) * 2
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
