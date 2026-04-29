import { BlockModel, InlineModel, INLINE_FLAG, HeadingBlock, ListItemBlock, BlockquoteBlock, CodeBlock, TableBlock } from "../types"
import Prism from 'prismjs'

/**
 * 使用 Prism.js 对代码进行语法高亮
 * 如果语言不被支持则回退为纯文本
 */
const highlightCode = (code: string, language: string): string => {
  if (!language) return escapeHtml(code)
  const grammar = Prism.languages[language]
  if (!grammar) return escapeHtml(code)
  return Prism.highlight(code, grammar, language)
}

const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export const renderBlock = (block: BlockModel, expanded: boolean = false): DocumentFragment => {
  const frag = document.createDocumentFragment();

  // 展开模式下，indent / spacing 前缀需要插入 md-inline-content 内部
  // 以保证所有前缀标记和正文处于同一个 inline 流中（避免复制时多余换行）。
  // 非展开模式下，它们仍然作为 block 的直接子元素（视觉占位 div）。
  const indentPrefixes: Node[] = []

  if (block.nesting && block.nesting > 0) {
    const fullLevels = Math.floor(block.nesting / 4)
    const remainder = block.nesting % 4

    for (let j = 0; j < fullLevels; j++) {
      if (expanded) {
        const indent = document.createElement('span')
        indent.classList.add('md-indent', 'md-struct-marker')
        if (j % 2 !== 0) indent.classList.add('md-indent-odd')
        else indent.classList.add('md-indent-even')
        indent.textContent = '    ' // 4 个空格
        indentPrefixes.push(indent)
      } else {
        const indent = document.createElement('div')
        indent.classList.add('md-indent')
        if (j % 2 !== 0) indent.classList.add('md-indent-odd')
        else indent.classList.add('md-indent-even')
        indent.textContent = '    ' // 4 个空格（不可见，仅用于撑宽度）
        frag.append(indent)
      }
    }

    if (remainder > 0) {
      if (expanded) {
        const spacing = document.createElement('span')
        spacing.classList.add('md-spacing', 'md-struct-marker')
        spacing.textContent = ' '.repeat(remainder)
        indentPrefixes.push(spacing)
      } else {
        const spacing = document.createElement('div')
        spacing.classList.add('md-spacing')
        spacing.textContent = ' '.repeat(remainder) // 不可见，仅用于撑宽度
        frag.append(spacing)
      }
    }
  }

  switch(block.type) {
    case 'blank': {
      const div = document.createElement('div')
      div.className = 'md-paragraph md-blank'
      const content = document.createElement('div')
      content.className = 'md-inline-content'
      if (expanded) {
        // 展开模式：放一个零宽空格文本节点，使光标可以定位
        content.appendChild(document.createTextNode('\u200B'))
      } else {
        // 非展开模式：零宽空格 + br
        // 零宽空格确保浏览器 selection 能正确落在此 block 上（支持跨行选中高亮）
        // br 保持原有的换行视觉效果
        content.appendChild(document.createTextNode('\u200B'))
        content.appendChild(document.createElement('br'))
      }
      div.appendChild(content)
      frag.appendChild(div)
      break
    }
    case 'heading': {
      const depth = (block as HeadingBlock).headingDepth
      const div = document.createElement('div')
      div.className = `md-heading-${depth}`

      // md-inline-content 容纳所有 inline 内容；
      // 展开模式时，heading marker 也放入 md-inline-content 内
      const content = document.createElement('div')
      content.className = `md-inline-content`

      if (expanded) {
        indentPrefixes.forEach(n => content.appendChild(n))
        const markerSpan = document.createElement('span')
        markerSpan.classList.add('md-struct-marker')
        markerSpan.textContent = '#'.repeat(depth) + ' '
        content.appendChild(markerSpan)
      }

      block.inline?.forEach((inline) => {
        content.appendChild(renderInlineBlock(inline, expanded))
      })
      div.appendChild(content)

      frag.appendChild(div)
      break
    }
    case 'list-item': {
      const div = document.createElement('div')
      const listStyle = (block as ListItemBlock).style
      div.className = `md-list-item`
      if (!expanded && 'task' in listStyle && listStyle.task && listStyle.checked) {
        div.classList.add('md-task-done')
      }

      // list marker：展开与非展开用同一个 span，仅内容和样式类不同
      const prefix = document.createElement('span')
      const style = (block as ListItemBlock).style

      if (expanded) {
        prefix.classList.add('md-list-marker', 'md-struct-marker')
        if (style.ordered) {
          prefix.textContent = style.order
        } else if ('task' in style && style.task) {
          prefix.textContent = '- [' + (style.checked ? 'x' : ' ') + '] '
        } else {
          prefix.textContent = '- '
        }
      } else {
        if (style.ordered) {
          prefix.classList.add('md-list-number')
          prefix.textContent = style.order
        } else if ('task' in style && style.task) {
          prefix.classList.add('md-task-checkbox')
          // 渲染 checkbox
          const checkbox = document.createElement('input')
          checkbox.type = 'checkbox'
          checkbox.checked = style.checked
          checkbox.classList.add('md-task-input')
          checkbox.setAttribute('data-block-id', block.id)
          prefix.appendChild(checkbox)
        } else {
          prefix.classList.add('md-list-marker')
          prefix.textContent = '•'
        }
      }

      // md-inline-content 容纳 list marker + 正文，保证同处一个 inline 流
      const content = document.createElement('div')
      content.className = `md-inline-content`
      if (expanded) {
        indentPrefixes.forEach(n => content.appendChild(n))
      }
      content.append(prefix)
      block.inline?.forEach((inline) => {
        content.appendChild(renderInlineBlock(inline, expanded))
      })

      div.append(content)
      frag.appendChild(div);
      break
    }
    case 'hr': {
      const div = document.createElement('div')
      div.className = 'md-hr-wrapper'

      if (expanded) {
        // 展开模式：显示原始 --- 文本，可编辑，保持与非展开相同的容器结构
        const content = document.createElement('div')
        content.className = 'md-inline-content md-hr-content'
        content.appendChild(document.createTextNode('---'))
        div.appendChild(content)
      } else {
        // 非展开模式：显示 hr 元素
        const hr = document.createElement('hr')
        hr.className = 'md-hr'
        div.appendChild(hr)
        // 零宽空格确保浏览器 selection 能正确落在此 block 上（支持跨行选中高亮）
        const anchor = document.createElement('span')
        anchor.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
        anchor.appendChild(document.createTextNode('\u200B'))
        div.appendChild(anchor)
      }

      frag.appendChild(div)
      break
    }
    case 'blockquote': {
      const depth = (block as BlockquoteBlock).quoteDepth
      const div = document.createElement('div')
      div.className = 'md-blockquote'
      // 嵌套引用：通过 data 属性传递深度
      div.dataset.depth = String(depth)

      const content = document.createElement('div')
      content.className = 'md-inline-content'

      if (expanded) {
        indentPrefixes.forEach(n => content.appendChild(n))
        const markerSpan = document.createElement('span')
        markerSpan.classList.add('md-struct-marker')
        markerSpan.textContent = '>'.repeat(depth) + ' '
        content.appendChild(markerSpan)
      }

      block.inline?.forEach((inline) => {
        content.appendChild(renderInlineBlock(inline, expanded))
      })
      div.appendChild(content)
      frag.appendChild(div)
      break
    }
    case 'code-block': {
      const codeBlock = block as CodeBlock
      const wrapper = document.createElement('div')
      wrapper.className = 'md-code-block'

      // 始终使用 pre 结构保持代码块视觉样式一致
      const pre = document.createElement('pre')

      if (expanded) {
        // 展开模式：保留 pre 样式，对代码部分应用语法高亮
        const content = document.createElement('div')
        content.className = 'md-inline-content md-code-block-content'

        // 开头的 ```language
        const openFence = document.createElement('span')
        openFence.className = 'md-code-fence-marker'
        openFence.textContent = '```' + codeBlock.language
        content.appendChild(openFence)

        // 换行
        content.appendChild(document.createTextNode('\n'))

        // 代码内容：使用 Prism.js 高亮
        if (codeBlock.language && Prism.languages[codeBlock.language]) {
          const codeSpan = document.createElement('span')
          codeSpan.className = 'md-code-block-highlighted'
          codeSpan.innerHTML = Prism.highlight(codeBlock.code, Prism.languages[codeBlock.language], codeBlock.language)
          content.appendChild(codeSpan)
        } else {
          content.appendChild(document.createTextNode(codeBlock.code))
        }

        // 换行 + 结尾的 ```
        content.appendChild(document.createTextNode('\n'))
        const closeFence = document.createElement('span')
        closeFence.className = 'md-code-fence-marker'
        closeFence.textContent = '```'
        content.appendChild(closeFence)

        pre.appendChild(content)
      } else {
        // 非展开模式：渲染为 <pre><code> 结构，带语法高亮和行号
        const code = document.createElement('code')
        if (codeBlock.language) {
          code.className = `language-${codeBlock.language}`
        }
        // 使用 Prism.js 做语法高亮后按行分割并包裹
        const highlighted = highlightCode(codeBlock.code, codeBlock.language)
        const lines = highlighted.split('\n')
        lines.forEach((lineHtml, idx) => {
          const lineSpan = document.createElement('span')
          lineSpan.className = 'md-code-line'
          lineSpan.innerHTML = lineHtml || '\u200B' // 空行用零宽空格占位
          code.appendChild(lineSpan)
        })
        pre.appendChild(code)
      }

      wrapper.appendChild(pre)
      frag.appendChild(wrapper)
      break
    }
    case 'table': {
      const tableBlock = block as TableBlock
      const wrapper = document.createElement('div')
      wrapper.className = 'md-table-wrapper'

      if (expanded) {
        // 展开模式：显示原始 Markdown 表格文本
        const content = document.createElement('div')
        content.className = 'md-inline-content md-table-content'
        // 重建 raw text
        const headerRow = '| ' + tableBlock.headers.join(' | ') + ' |'
        const sepRow = '| ' + tableBlock.aligns.map(a => {
          if (a === 'center') return ':---:'
          if (a === 'right') return '---:'
          if (a === 'left') return ':---'
          return '---'
        }).join(' | ') + ' |'
        const dataRows = tableBlock.rows.map(row => '| ' + row.join(' | ') + ' |')
        const fullText = [headerRow, sepRow, ...dataRows].join('\n')
        content.appendChild(document.createTextNode(fullText))
        wrapper.appendChild(content)
      } else {
        // 非展开模式：渲染为 HTML <table>
        const table = document.createElement('table')
        table.className = 'md-table'

        // 表头
        const thead = document.createElement('thead')
        const headerTr = document.createElement('tr')
        tableBlock.headers.forEach((header, idx) => {
          const th = document.createElement('th')
          th.textContent = header
          const align = tableBlock.aligns[idx]
          if (align && align !== 'default') th.style.textAlign = align
          headerTr.appendChild(th)
        })
        thead.appendChild(headerTr)
        table.appendChild(thead)

        // 表体
        const tbody = document.createElement('tbody')
        tableBlock.rows.forEach(row => {
          const tr = document.createElement('tr')
          row.forEach((cell, idx) => {
            const td = document.createElement('td')
            td.textContent = cell
            const align = tableBlock.aligns[idx]
            if (align && align !== 'default') td.style.textAlign = align
            tr.appendChild(td)
          })
          tbody.appendChild(tr)
        })
        table.appendChild(tbody)

        wrapper.appendChild(table)
        // 零宽空格确保浏览器 selection 能正确落在此 block 上
        const anchor = document.createElement('span')
        anchor.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
        anchor.appendChild(document.createTextNode('\u200B'))
        wrapper.appendChild(anchor)
      }

      frag.appendChild(wrapper)
      break
    }
    case 'paragraph': {
      const div = document.createElement('div')
      div.className = `md-paragraph`
      const content = document.createElement('div')
      content.className = `md-inline-content`
      if (expanded) {
        indentPrefixes.forEach(n => content.appendChild(n))
      }
      block.inline?.forEach((inline) => {
        content.appendChild(renderInlineBlock(inline, expanded))
      })
      div.append(content)

      frag.appendChild(div);
      break
    }
  }

  return frag;
}

export const renderInlineBlock = (block: InlineModel, expanded: boolean = false): Node => {
  const frag = document.createDocumentFragment();

  if (block.type === 'link') {
    if (expanded) {
      // 展开模式：显示完整的 Markdown 链接语法 [text](url)
      // 这确保 DOM 文本与 getRawText() 返回的文本一致
      const wrapper = document.createElement('span')
      wrapper.classList.add('md-marker-expanded', 'md-link')

      // 前缀标记符 [
      const prefixSpan = document.createElement('span')
      prefixSpan.classList.add('md-marker')
      prefixSpan.textContent = '['
      wrapper.appendChild(prefixSpan)

      // 链接文本内容
      block.children.forEach(child => {
        wrapper.append(renderInlineBlock(child, expanded))
      })

      // 中间标记符 ](
      const midSpan = document.createElement('span')
      midSpan.classList.add('md-marker')
      midSpan.textContent = ']('
      wrapper.appendChild(midSpan)

      // href 部分
      const hrefNode = document.createTextNode(block.href)
      wrapper.appendChild(hrefNode)

      // 后缀标记符 )
      const suffixSpan = document.createElement('span')
      suffixSpan.classList.add('md-marker')
      suffixSpan.textContent = ')'
      wrapper.appendChild(suffixSpan)

      frag.appendChild(wrapper)
    } else {
      // 非展开模式：正常渲染为 <a> 标签
      const link = document.createElement('a')
      link.href = block.href
      link.classList.add('md-link')
      block.children.forEach(child => {
        link.append(renderInlineBlock(child, expanded))
      })
      frag.appendChild(link)
    }
  } else if (block.type === 'image') {
    if (expanded) {
      // 展开模式：显示完整的 Markdown 图片语法 ![alt](src)
      const wrapper = document.createElement('span')
      wrapper.classList.add('md-marker-expanded', 'md-image')

      // 前缀标记符 ![
      const prefixSpan = document.createElement('span')
      prefixSpan.classList.add('md-marker')
      prefixSpan.textContent = '!['
      wrapper.appendChild(prefixSpan)

      // alt 文本内容
      const altNode = document.createTextNode(block.alt)
      wrapper.appendChild(altNode)

      // 中间标记符 ](
      const midSpan = document.createElement('span')
      midSpan.classList.add('md-marker')
      midSpan.textContent = ']('
      wrapper.appendChild(midSpan)

      // src 部分
      const srcNode = document.createTextNode(block.src)
      wrapper.appendChild(srcNode)

      // 后缀标记符 )
      const suffixSpan = document.createElement('span')
      suffixSpan.classList.add('md-marker')
      suffixSpan.textContent = ')'
      wrapper.appendChild(suffixSpan)

      frag.appendChild(wrapper)
    } else {
      // 非展开模式：渲染为 <img> 标签
      const img = document.createElement('img')
      img.src = block.src
      img.alt = block.alt
      img.classList.add('md-image')
      img.style.maxWidth = '100%'
      frag.appendChild(img)
    }
  } else if (block.type === 'text') {
    // 如果是展开模式且有标记符，渲染带标记符的展开形式
    if (expanded && block.markers && block.marks !== 0) {
      const wrapper = document.createElement('span')
      wrapper.classList.add('md-marker-expanded')

      // 添加格式化样式类
      if (block.marks & INLINE_FLAG.CODE) {
        wrapper.classList.add('md-code')
      } else {
        if (block.marks & INLINE_FLAG.BOLD)
          wrapper.classList.add('md-bold')
        if (block.marks & INLINE_FLAG.ITALIC)
          wrapper.classList.add('md-italic')
        if (block.marks & INLINE_FLAG.HIGHLIGHT)
          wrapper.classList.add('md-highlight')
        if (block.marks & INLINE_FLAG.STRIKE)
          wrapper.classList.add('md-strike')
      }

      // 前缀标记符
      const prefixSpan = document.createElement('span')
      prefixSpan.classList.add('md-marker')
      prefixSpan.textContent = block.markers.prefix
      wrapper.appendChild(prefixSpan)

      // 文本内容
      const textNode = document.createTextNode(block.text)
      wrapper.appendChild(textNode)

      // 后缀标记符
      const suffixSpan = document.createElement('span')
      suffixSpan.classList.add('md-marker')
      suffixSpan.textContent = block.markers.suffix
      wrapper.appendChild(suffixSpan)

      frag.appendChild(wrapper)
    } else {
      const text = document.createElement('span') 
      text.textContent = block.text

      if (block.marks & INLINE_FLAG.CODE) {
        text.classList.add('md-code')
      } else {
        if (block.marks & INLINE_FLAG.BOLD)
          text.classList.add('md-bold')
        if (block.marks & INLINE_FLAG.ITALIC)
          text.classList.add('md-italic')
        if (block.marks & INLINE_FLAG.HIGHLIGHT)
          text.classList.add('md-highlight')
        if (block.marks & INLINE_FLAG.STRIKE)
          text.classList.add('md-strike')
      }
      frag.appendChild(text)
    }
  }
  return frag
}