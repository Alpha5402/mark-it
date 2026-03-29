import { RawLine, BlockModel, InlineModel, INLINE_FLAG, HeadingBlock, ListItemBlock } from "../types";

const TAB_WIDTH = 4

export function inlineParse(input: string): {
  inline: InlineModel[],
  offset: number
} {
  if (!input) return { inline: [], offset: 0}

  const result: InlineModel[] = []

  let i = 0
  let buffer = ''
  let marks = 0
  let logicalOffset = 0

  const flush = () => {
    if (!buffer) return
    result.push({
      type: 'text',
      text: buffer,
      marks,
      offset: logicalOffset - buffer.length,
      dirty: false
    })
    buffer = ''
  }

  const peek = (n = 0) => input[i + n]

  while (i < input.length) {
    // 行内代码 `
    if (peek() === '`') {
      flush()
      const start = ++i
      const end = input.indexOf('`', start)
      const text = input.slice(start, end)

      if (end !== -1) {
        result.push({
          type: 'text',
          text,
          marks: INLINE_FLAG.CODE,
          offset: logicalOffset,
          dirty: false
        })

        logicalOffset += text.length
        i = end + 1
        continue
      }

      // fallback：当作普通字符
      buffer += '`'
      continue
    }

    // 删除线 ~~
    if (peek() === '~' && peek(1) === '~') {
      flush()
      marks ^= INLINE_FLAG.STRIKE
      i += 2
      continue
    }

    // 加粗 **
    if (peek() === '*' && peek(1) === '*') {
      flush()
      marks ^= INLINE_FLAG.BOLD
      i += 2
      continue
    }


    if (peek() === '=' && peek(1) === '=') {
      flush()
      marks ^= INLINE_FLAG.HIGHLIGHT
      i += 2
      continue
    }

    // 斜体 * 或 _
    if (peek() === '*' || peek() === '_') {
      flush()
      marks ^= INLINE_FLAG.ITALIC
      i++
      continue
    }

    // 链接 [text](url)
    if (peek() === '[') {
      const closeBracket = input.indexOf(']', i)
      const openParen = input[closeBracket + 1] === '('
      const closeParen = openParen
        ? input.indexOf(')', closeBracket + 2)
        : -1

      if (closeBracket !== -1 && openParen && closeParen !== -1) {
        flush()

        const linkTextRaw = input.slice(i + 1, closeBracket)
        const href = input.slice(closeBracket + 2, closeParen)

        const parseResult = inlineParse(linkTextRaw) // ⭐ 关键：递归
        const children = parseResult.inline
        
        result.push({
          type: 'link',
          children,
          href,
          marks,
          offset: logicalOffset,
          dirty: false
        })

        logicalOffset += parseResult.offset

        i = closeParen + 1
        continue
      }
    }

    // 普通字符
    buffer += input[i]
    i++
    logicalOffset++
  }

  flush()
  return { inline: result, offset: logicalOffset}
}


const leadingSpaceParse = (leading: string): number => {
  let depth = 0
  for (const char of leading) { 
    if (char === '\t') { 
      depth += TAB_WIDTH; 
    } else {
      depth += 1; 
    } 
  }
  return depth
}

export function parseLine(line: RawLine): BlockModel {
  const { raw, leading } = line

  // 如果是空行
  if (raw.trim() === '')
    return {
      id: line.id,
      type: 'blank'
    }
  
  // 如果是列表项
  if (/^\s*[-*+]\s/.test(raw)) {
    const match = raw.match(/^\s*[-*+]\s/)!
    const content = raw.slice(match[0].length)

    return {
      id: line.id,
      type: 'list-item',
      nesting: leadingSpaceParse(leading),
      inline: inlineParse(content).inline,
      style: {
        ordered: false
      }
    } as ListItemBlock
  }

  // 如果是有序列表
  if (/^(\s*)(\d+)\.\s/.test(raw)) {
    const match = raw.match(/^(\s*)(\d+)\.\s/)!
    const order = match[0]
    const content = raw.slice(order.length)

    return {
      id: line.id,
      type: 'list-item',
      nesting: leadingSpaceParse(leading),
      inline: inlineParse(content).inline,
      style: {
        ordered: true,
        order
      } 
    } as ListItemBlock
  }

  if (/^(#{1,6})\s+(.*)$/.test(raw)) {
    const match = raw.match(/^(#{1,6})\s+(.*)$/)!
    // 注意 heading 不缩进，这里直接复用 depth 作为标题层级
    const depth = match[1].length
    const content = match[2]
    return {
      id: line.id,
      type: 'heading',
      headingDepth: depth,
      inline: inlineParse(content).inline,
    } as HeadingBlock
  }

  return {
    id: line.id,
    type: 'paragraph',
    nesting: leadingSpaceParse(leading),
    inline: inlineParse(raw).inline,
  }
}

