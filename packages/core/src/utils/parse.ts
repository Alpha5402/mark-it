import { RawLine, BlockModel, InlineModel, INLINE_FLAG, HeadingBlock, ListItemBlock, BlockquoteBlock, CodeBlock } from "../types";

const TAB_WIDTH = 4

/**
 * 标记符 token，记录在原始文本中的位置和类型
 */
type MarkerToken = {
  pos: number       // 在原始文本中的起始位置
  len: number       // 标记符长度
  raw: string       // 标记符原始文本
  flag: number      // 对应的 INLINE_FLAG
  paired: boolean   // 是否已配对
  pairIndex: number // 配对的另一个 token 的索引（-1 表示未配对）
}

export function inlineParse(input: string): {
  inline: InlineModel[],
  offset: number
} {
  if (!input) return { inline: [], offset: 0 }

  // ========== 第一遍：扫描所有标记符位置 ==========
  const tokens: MarkerToken[] = []
  // 同时处理链接结构
  type LinkSpan = { start: number; closeBracket: number; openParen: number; closeParen: number; isImage?: boolean }
  const links: LinkSpan[] = []

  let i = 0
  while (i < input.length) {
    // 行内代码 ` — 特殊处理，代码块内不解析其他标记符
    if (input[i] === '`') {
      const end = input.indexOf('`', i + 1)
      if (end !== -1) {
        // 检查两个 ` 之间是否有文本内容
        if (end === i + 1) {
          // 紧邻的 ``，中间没有文本，当作普通字符
          i++
          continue
        }
        // 代码块作为一个已配对的 token 对
        const openIdx = tokens.length
        tokens.push({ pos: i, len: 1, raw: '`', flag: INLINE_FLAG.CODE, paired: true, pairIndex: openIdx + 1 })
        tokens.push({ pos: end, len: 1, raw: '`', flag: INLINE_FLAG.CODE, paired: true, pairIndex: openIdx })
        i = end + 1
        continue
      }
      // 没有匹配的 `，当作普通字符
      i++
      continue
    }

    // 图片 ![alt](url)
    if (input[i] === '!' && input[i + 1] === '[') {
      const closeBracket = input.indexOf(']', i + 2)
      if (closeBracket !== -1 && input[closeBracket + 1] === '(') {
        const closeParen = input.indexOf(')', closeBracket + 2)
        if (closeParen !== -1) {
          links.push({ start: i, closeBracket, openParen: closeBracket + 1, closeParen, isImage: true })
          i = closeParen + 1
          continue
        }
      }
      i++
      continue
    }

    // 链接 [text](url)
    if (input[i] === '[') {
      const closeBracket = input.indexOf(']', i + 1)
      if (closeBracket !== -1 && input[closeBracket + 1] === '(') {
        const closeParen = input.indexOf(')', closeBracket + 2)
        if (closeParen !== -1) {
          links.push({ start: i, closeBracket, openParen: closeBracket + 1, closeParen, isImage: false })
          i = closeParen + 1
          continue
        }
      }
      i++
      continue
    }

    // 删除线 ~~
    if (input[i] === '~' && input[i + 1] === '~') {
      tokens.push({ pos: i, len: 2, raw: '~~', flag: INLINE_FLAG.STRIKE, paired: false, pairIndex: -1 })
      i += 2
      continue
    }

    // 加粗 **（必须在单个 * 之前检查）
    if (input[i] === '*' && input[i + 1] === '*') {
      tokens.push({ pos: i, len: 2, raw: '**', flag: INLINE_FLAG.BOLD, paired: false, pairIndex: -1 })
      i += 2
      continue
    }

    // 高亮 ==
    if (input[i] === '=' && input[i + 1] === '=') {
      tokens.push({ pos: i, len: 2, raw: '==', flag: INLINE_FLAG.HIGHLIGHT, paired: false, pairIndex: -1 })
      i += 2
      continue
    }

    // 斜体 * 或 _
    if (input[i] === '*' || input[i] === '_') {
      tokens.push({ pos: i, len: 1, raw: input[i], flag: INLINE_FLAG.ITALIC, paired: false, pairIndex: -1 })
      i++
      continue
    }

    i++
  }

  // ========== 第二遍：从左到右两两配对（同类型标记符） ==========
  // 对每种标记符类型，维护一个"等待配对"的栈
  // 代码块已经在第一遍中配对了，跳过
  const waitingStack = new Map<number, number[]>() // flag -> token index stack

  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t]
    if (token.paired) continue // 已配对（如代码块）

    const stack = waitingStack.get(token.flag)
    if (stack && stack.length > 0) {
      // 有等待配对的同类型标记符
      // 检查两个标记符之间是否有文本内容
      const openIdx = stack[stack.length - 1]
      const openToken = tokens[openIdx]
      const openEnd = openToken.pos + openToken.len  // 开启标记符的结束位置
      const closeStart = token.pos                    // 关闭标记符的起始位置

      if (openEnd >= closeStart) {
        // 两个标记符之间没有任何文本（紧邻或重叠），不配对
        // 将当前 token 也入栈（替换掉之前的，因为之前的已经无法配对了）
        // 弹出旧的，两个都作为未配对
        stack.pop()
        // 不入栈当前 token，因为它也无法与后续配对形成有效结构
        // （两个紧邻的同类标记符都退化为纯文本）
        continue
      }

      // 中间有文本，正常配对
      stack.pop()
      tokens[openIdx].paired = true
      tokens[openIdx].pairIndex = t
      token.paired = true
      token.pairIndex = openIdx
    } else {
      // 没有等待配对的，入栈
      if (!waitingStack.has(token.flag)) {
        waitingStack.set(token.flag, [])
      }
      waitingStack.get(token.flag)!.push(t)
    }
  }

  // ========== 第三遍：根据配对结果生成 inline 段 ==========
  const result: InlineModel[] = []
  let logicalOffset = 0

  // 构建一个位置 → token 的映射，方便快速查找
  const tokenAtPos = new Map<number, { token: MarkerToken; index: number }>()
  for (let t = 0; t < tokens.length; t++) {
    tokenAtPos.set(tokens[t].pos, { token: tokens[t], index: t })
  }

  // 构建一个位置 → link 的映射
  const linkAtPos = new Map<number, LinkSpan>()
  for (const link of links) {
    linkAtPos.set(link.start, link)
  }

  // 当前活跃的格式标记（已配对的开启标记符）
  let currentMarks = 0
  // 活跃标记符栈：记录当前开启的标记符，用于构建 markers
  const activeFlags: { flag: number; raw: string }[] = []

  let pos = 0
  let buffer = ''

  const flush = () => {
    if (!buffer) return

    let markers: { prefix: string; suffix: string } | undefined
    if (currentMarks !== 0 && activeFlags.length > 0) {
      let prefix = ''
      for (const af of activeFlags) {
        if (currentMarks & af.flag) {
          prefix += af.raw
        }
      }
      markers = { prefix, suffix: prefix }
    }

    result.push({
      type: 'text',
      text: buffer,
      marks: currentMarks,
      offset: logicalOffset - buffer.length,
      dirty: false,
      markers
    })
    buffer = ''
  }

  while (pos < input.length) {
    // 检查是否是链接/图片起始
    const link = linkAtPos.get(pos)
    if (link) {
      flush()
      if (link.isImage) {
        // 图片 ![alt](src)
        const altText = input.slice(link.start + 2, link.closeBracket)
        const src = input.slice(link.openParen + 1, link.closeParen)

        result.push({
          type: 'image',
          alt: altText,
          src,
          marks: currentMarks,
          offset: logicalOffset,
          dirty: false
        })

        logicalOffset += altText.length
        pos = link.closeParen + 1
      } else {
        // 链接 [text](url)
        const linkTextRaw = input.slice(link.start + 1, link.closeBracket)
        const href = input.slice(link.openParen + 1, link.closeParen)
        const parseResult = inlineParse(linkTextRaw)

        result.push({
          type: 'link',
          children: parseResult.inline,
          href,
          marks: currentMarks,
          offset: logicalOffset,
          dirty: false
        })

        logicalOffset += parseResult.offset
        pos = link.closeParen + 1
      }
      continue
    }

    // 检查是否是标记符位置
    const entry = tokenAtPos.get(pos)
    if (entry) {
      const { token } = entry

      if (token.paired) {
        // 已配对的标记符
        if (token.flag === INLINE_FLAG.CODE) {
          // 代码块：找到配对的关闭标记符
          const closeToken = tokens[token.pairIndex]
          if (closeToken.pos > token.pos) {
            // 这是开启标记符
            flush()
            const codeText = input.slice(token.pos + token.len, closeToken.pos)
            result.push({
              type: 'text',
              text: codeText,
              marks: INLINE_FLAG.CODE,
              offset: logicalOffset,
              dirty: false,
              markers: { prefix: '`', suffix: '`' }
            })
            logicalOffset += codeText.length
            pos = closeToken.pos + closeToken.len
            continue
          } else {
            // 这是关闭标记符（不应该单独遇到，跳过）
            pos += token.len
            continue
          }
        }

        // 非代码标记符
        const pairToken = tokens[token.pairIndex]
        if (pairToken.pos > token.pos) {
          // 这是开启标记符 → flush 当前 buffer，开启新格式
          flush()
          currentMarks |= token.flag
          activeFlags.push({ flag: token.flag, raw: token.raw })
        } else {
          // 这是关闭标记符 → flush 当前 buffer，关闭格式
          flush()
          currentMarks &= ~token.flag
          // 从 activeFlags 中移除
          const idx = activeFlags.findIndex(af => af.flag === token.flag)
          if (idx !== -1) activeFlags.splice(idx, 1)
        }
        pos += token.len
        continue
      } else {
        // 未配对的标记符 → 当作普通文本
        buffer += token.raw
        pos += token.len
        logicalOffset += token.raw.length
        continue
      }
    }

    // 普通字符
    buffer += input[pos]
    pos++
    logicalOffset++
  }

  flush()
  return { inline: result, offset: logicalOffset }
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
      type: 'blank',
      inline: []
    }

  // 如果是水平线：---、***、___（至少 3 个相同字符，可以有空格）
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(raw.trim()))
    return {
      id: line.id,
      type: 'hr',
      inline: []
    }

  // 如果是围栏代码块（由 tokenize 阶段合并的多行 token）
  const codeBlockMatch = raw.match(/^(`{3,}|~{3,})\s*(.*)\n([\s\S]*)\n\1\s*$/)
  if (codeBlockMatch) {
    return {
      id: line.id,
      type: 'code-block',
      language: codeBlockMatch[2].trim(),
      code: codeBlockMatch[3],
      inline: []
    } as CodeBlock
  }

  // 如果是引用
  if (/^(>+)\s?(.*)$/.test(raw)) {
    const match = raw.match(/^(>+)\s?(.*)$/)!
    const depth = match[1].length
    const content = match[2]
    return {
      id: line.id,
      type: 'blockquote',
      quoteDepth: depth,
      inline: inlineParse(content).inline,
    } as BlockquoteBlock
  }
  
  // 如果是列表项
  if (/^\s*[-*+]\s/.test(raw)) {
    const match = raw.match(/^\s*[-*+]\s/)!
    const afterMarker = raw.slice(match[0].length)

    // 检测任务列表：- [ ] 或 - [x] 或 - [X]
    const taskMatch = afterMarker.match(/^\[([ xX])\]\s?/)
    if (taskMatch) {
      const checked = taskMatch[1] !== ' '
      const content = afterMarker.slice(taskMatch[0].length)
      return {
        id: line.id,
        type: 'list-item',
        nesting: leadingSpaceParse(leading),
        inline: inlineParse(content).inline,
        style: {
          ordered: false,
          task: true,
          checked
        }
      } as ListItemBlock
    }

    const content = afterMarker

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
    // match[0] 包含前导空白 + 数字 + 点 + 空格
    // match[1] 是前导空白, match[2] 是数字
    // order 只保留 "数字. " 部分（不含前导空白，前导空白由 nesting 处理）
    const order = match[2] + '. '
    const content = raw.slice(match[0].length)

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

  if (/^(#{1,6}) (.*)$/.test(raw)) {
    const match = raw.match(/^(#{1,6}) (.*)$/)!
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

