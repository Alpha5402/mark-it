// @vitest-environment jsdom

import { afterEach, describe, expect, test } from 'vitest'
import { Editor } from './Editor'

function createEditor(markdown: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return new Editor(container, 'Test', markdown)
}

function snapshot(editor: Editor) {
  return Array.from(editor.doc.getBlocks().values()).map(block => ({
    id: block.id,
    type: block.type,
    raw: editor.doc.getRawText(block.id),
  }))
}

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
})

describe('Editor block commands', () => {
  test('inserts blank blocks before and after a target block', () => {
    const editor = createEditor('first\nsecond')
    const secondId = snapshot(editor)[1].id

    expect(editor.insertBlankBlockBefore(secondId)).toBe(true)
    let snap = snapshot(editor)
    expect(snap.map(block => block.raw)).toEqual(['first', '', 'second'])
    expect(editor.dom.getExpandedBlockId()).toBe(snap[1].id)

    expect(editor.insertBlankBlockAfter(secondId)).toBe(true)
    snap = snapshot(editor)
    expect(snap.map(block => block.raw)).toEqual(['first', '', 'second', ''])
    expect(editor.dom.getExpandedBlockId()).toBe(snap[3].id)

    editor.destroy()
  })

  test('converts text blocks while preserving inline markdown content', () => {
    const editor = createEditor('**bold** text')
    const id = snapshot(editor)[0].id

    expect(editor.convertTextBlock(id, 'heading-2')).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'heading', raw: '## **bold** text' },
    ])

    expect(editor.convertTextBlock(id, 'unordered-list')).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'list-item', raw: '- **bold** text' },
    ])

    expect(editor.convertTextBlock(id, 'blockquote')).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'blockquote', raw: '> **bold** text' },
    ])

    expect(editor.convertTextBlock(id, 'paragraph')).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'paragraph', raw: '**bold** text' },
    ])

    editor.destroy()
  })

  test('does not convert fenced structural blocks through text block commands', () => {
    const editor = createEditor('```js\nconst x = 1\n```')
    const id = snapshot(editor)[0].id

    expect(editor.convertTextBlock(id, 'heading-1')).toBe(false)
    expect(snapshot(editor)).toMatchObject([
      { type: 'code-block', raw: '```js\nconst x = 1\n```' },
    ])

    editor.destroy()
  })

  test('inserts common markdown module templates after a target block', () => {
    const editor = createEditor('anchor')
    const anchorId = snapshot(editor)[0].id

    expect(editor.insertTemplateBlockAfter(anchorId, 'task-list')).toBe(true)
    expect(editor.insertTemplateBlockAfter(anchorId, 'code-block')).toBe(true)
    expect(editor.insertTemplateBlockAfter(anchorId, 'math-block')).toBe(true)
    expect(editor.insertTemplateBlockAfter(anchorId, 'table')).toBe(true)

    expect(snapshot(editor)).toMatchObject([
      { type: 'paragraph', raw: 'anchor' },
      { type: 'table', raw: '|  |  |\n| --- | --- |\n|  |  |' },
      { type: 'math-block', raw: '$$\n\n$$' },
      { type: 'code-block', raw: '```\n\n```' },
      { type: 'list-item', raw: '- [ ] ' },
    ])

    editor.destroy()
  })
})
