// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import type { BlockModel, InlineModel } from '../types'
import { INLINE_FLAG } from '../types'
import { parseLine } from './parse'
import { renderBlock, renderInlineBlock } from './render'
import { tokenizeByLine } from './tokenize'

function render(block: BlockModel, expanded = false) {
  const host = document.createElement('div')
  host.appendChild(renderBlock(block, expanded))
  return host
}

function parse(raw: string) {
  return parseLine(tokenizeByLine(raw))
}

describe('renderBlock', () => {
  test('renders code-block collapsed as highlighted code and expanded as markdown source', () => {
    const block = parse('~~~ts\nconst x = 1\n~~~')

    const collapsed = render(block)
    expect(collapsed.querySelector('.md-code-block')).not.toBeNull()
    expect(collapsed.querySelector('.md-code-fence-marker')).toBeNull()
    expect(collapsed.textContent).toBe('const x = 1')

    const expanded = render(block, true)
    expect(expanded.querySelectorAll('.md-code-fence-marker')).toHaveLength(2)
    expect(expanded.textContent).toBe('~~~ts\nconst x = 1\n~~~')
  })

  test('renders empty code-block expanded without an extra blank code line', () => {
    const block = parse('```\n```')

    const collapsed = render(block)
    const expanded = render(block, true)

    expect(collapsed.querySelector('[data-raw-placeholder="code-empty"]')).toBeNull()
    expect(collapsed.textContent).toBe('')
    expect(expanded.textContent).toBe('```\n```')
  })

  test('renders math-block collapsed as display math and expanded as markdown source', () => {
    const block = parse('$$\nx+1\n$$')

    const collapsed = render(block)
    expect(collapsed.querySelector('.md-math-display')).not.toBeNull()
    expect(collapsed.textContent).not.toContain('$$')

    const expanded = render(block, true)
    expect(expanded.querySelector('.md-math-block-content')).not.toBeNull()
    expect(expanded.textContent).toBe('$$\nx+1\n$$')
  })

  test('renders table collapsed as table DOM and expanded as markdown source', () => {
    const block = parse('| a | b |\n| --- | :---: |\n| 1 | 2 |')

    const collapsed = render(block)
    expect(collapsed.querySelectorAll('th')).toHaveLength(2)
    expect(collapsed.querySelectorAll('td')).toHaveLength(2)
    expect(collapsed.textContent).not.toContain('| --- |')

    const expanded = render(block, true)
    expect(expanded.querySelector('.md-table-content')).not.toBeNull()
    expect(expanded.textContent).toBe('| a | b |\n| --- | :---: |\n| 1 | 2 |')
  })

  test('renders structural markdown markers only in expanded mode', () => {
    const heading = parse('## Title')
    const list = parse('- item')
    const quote = parse('> quote')

    expect(render(heading).querySelector('.md-struct-marker')).toBeNull()
    expect(render(list).textContent).not.toContain('- ')
    expect(render(quote).querySelector('.md-struct-marker')).toBeNull()

    expect(render(heading, true).textContent).toBe('## Title')
    expect(render(list, true).textContent).toBe('- item')
    expect(render(quote, true).textContent).toBe('> quote')
  })
})

describe('renderInlineBlock', () => {
  test('renders formatted text markers only in expanded mode', () => {
    const inline: InlineModel = {
      type: 'text',
      text: 'bold',
      marks: INLINE_FLAG.BOLD,
      offset: 0,
      dirty: false,
      markers: { prefix: '**', suffix: '**' },
    }

    const collapsed = document.createElement('div')
    collapsed.appendChild(renderInlineBlock(inline, false))
    expect(collapsed.textContent).toBe('bold')
    expect(collapsed.querySelector('.md-marker')).toBeNull()

    const expanded = document.createElement('div')
    expanded.appendChild(renderInlineBlock(inline, true))
    expect(expanded.textContent).toBe('**bold**')
    expect(expanded.querySelectorAll('.md-marker')).toHaveLength(2)
  })

  test('renders inline math without dollar markers when collapsed and with source markers when expanded', () => {
    const inline: InlineModel = {
      type: 'math',
      tex: 'x+1',
      marks: 0,
      offset: 0,
      dirty: false,
    }

    const collapsed = document.createElement('div')
    collapsed.appendChild(renderInlineBlock(inline, false))
    expect(collapsed.querySelector('.md-math-inline')).not.toBeNull()
    expect(collapsed.querySelector('.md-marker')).toBeNull()
    expect(collapsed.textContent).not.toContain('$')

    const expanded = document.createElement('div')
    expanded.appendChild(renderInlineBlock(inline, true))
    expect(expanded.textContent).toBe('$x+1$')
    expect(expanded.querySelectorAll('.md-marker')).toHaveLength(2)
  })

  test('renders links and images as markdown source only in expanded mode', () => {
    const link: InlineModel = {
      type: 'link',
      children: [{ type: 'text', text: 'docs', marks: 0, offset: 0, dirty: false }],
      href: 'https://example.com',
      marks: 0,
      offset: 0,
      dirty: false,
    }
    const image: InlineModel = {
      type: 'image',
      alt: 'logo',
      src: 'logo.png',
      marks: 0,
      offset: 0,
      dirty: false,
    }

    const collapsed = document.createElement('div')
    collapsed.appendChild(renderInlineBlock(link, false))
    collapsed.appendChild(renderInlineBlock(image, false))
    expect(collapsed.querySelector('a')?.textContent).toBe('docs')
    expect(collapsed.querySelector('img')?.getAttribute('alt')).toBe('logo')
    expect(collapsed.textContent).toBe('docs')

    const expanded = document.createElement('div')
    expanded.appendChild(renderInlineBlock(link, true))
    expanded.appendChild(renderInlineBlock(image, true))
    expect(expanded.textContent).toBe('[docs](https://example.com)![logo](logo.png)')
  })
})
