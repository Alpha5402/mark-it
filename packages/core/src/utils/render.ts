import { BlockModel, InlineModel, INLINE_FLAG, HeadingBlock, ListItemBlock } from "../types"

export const renderBlock = (block: BlockModel): DocumentFragment => {
  const frag = document.createDocumentFragment();

  if (block.nesting && block.nesting > 0) {
    const fullLevels = Math.floor(block.nesting / 4)
    const remainder = block.nesting % 4

    for (let j = 0; j < fullLevels; j++) {
      const indent = document.createElement('div')
      indent.classList.add('md-indent')
      if (j % 2 !== 0) indent.classList.add('md-indent-odd')
      else indent.classList.add('md-indent-even')
      frag.append(indent)
    }

    if (remainder > 0) {
      const spacing = document.createElement('div')
      spacing.classList.add('md-spacing')
      frag.append(spacing)
    }
  }

  // console.log(block.inline)
  switch(block.type) {
    case 'blank':
      frag.appendChild(document.createElement('br'))
      break
    case 'heading': {
      const div = document.createElement('div');
      div.className = `md-heading-${(block as HeadingBlock).headingDepth}`;
      block.inline?.forEach((inline) => {
        div.appendChild(renderInlineBlock(inline))
      })
      frag.appendChild(div);
      break
    }
    case 'list-item': {
      const div = document.createElement('div')
      div.className = `md-list-item`;

      const prefix = document.createElement('span')
      const style = (block as ListItemBlock).style
      if (style.ordered) {
        prefix.classList.add('md-list-number')
        prefix.textContent = style.order
      } else {
        prefix.classList.add('md-list-marker')
        prefix.textContent = '•'
      }

      const content = document.createElement('div')
      content.className = `md-inline-content`
      block.inline?.forEach((inline) => {
        content.appendChild(renderInlineBlock(inline))
      })
      div.append(prefix, content)

      frag.appendChild(div);
      break
    }
    case 'paragraph': {
      const div = document.createElement('div')
      div.className = `md-paragraph`
      const content = document.createElement('div')
      content.className = `md-inline-content`
      block.inline?.forEach((inline) => {
        content.appendChild(renderInlineBlock(inline))
      })
      div.append(content)

      frag.appendChild(div);
      break
    }
  }

  return frag;
}

export const renderInlineBlock = (block: InlineModel): Node => {
  const frag = document.createDocumentFragment();

  if (block.type === 'link') {
    const link = document.createElement('a')
    link.href = block.href
    link.classList.add('md-link')
    block.children.forEach(child => {
      link.append(renderInlineBlock(child))
    })
    frag.appendChild(link)
  } else if (block.type === 'text') {
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
  return frag
}