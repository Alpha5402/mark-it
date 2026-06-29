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

  test('duplicates blocks by preserving their raw markdown', () => {
    const editor = createEditor('intro\n```ts\nconst x = 1\n```\n| a | b |\n| --- | --- |\n| 1 | 2 |')
    const [paragraph, code, table] = snapshot(editor)

    expect(editor.duplicateBlockAfter(paragraph.id)).toBe(true)
    expect(snapshot(editor).slice(0, 2)).toMatchObject([
      { type: 'paragraph', raw: 'intro' },
      { type: 'paragraph', raw: 'intro' },
    ])

    expect(editor.duplicateBlockAfter(code.id)).toBe(true)
    expect(snapshot(editor).slice(2, 4)).toMatchObject([
      { type: 'code-block', raw: '```ts\nconst x = 1\n```' },
      { type: 'code-block', raw: '```ts\nconst x = 1\n```' },
    ])

    expect(editor.duplicateBlockAfter(table.id)).toBe(true)
    expect(snapshot(editor).slice(4, 6)).toMatchObject([
      { type: 'table', raw: '| a | b |\n| --- | --- |\n| 1 | 2 |' },
      { type: 'table', raw: '| a | b |\n| --- | --- |\n| 1 | 2 |' },
    ])

    expect(editor.duplicateBlockAfter('missing')).toBe(false)

    editor.destroy()
  })

  test('converts text blocks while preserving inline markdown content', () => {
    const editor = createEditor('**bold** text')
    const id = snapshot(editor)[0].id

    expect(editor.convertTextBlock(id, 'heading-2')).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'heading', raw: '## **bold** text' },
    ])

    expect(editor.convertTextBlock(id, 'heading-3')).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'heading', raw: '### **bold** text' },
    ])

    expect(editor.convertTextBlock(id, 'unordered-list')).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'list-item', raw: '- **bold** text' },
    ])

    expect(editor.convertTextBlock(id, 'ordered-list')).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'list-item', raw: '1. **bold** text' },
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

  test('inserts common markdown module templates before a target block', () => {
    const editor = createEditor('anchor')
    const anchorId = snapshot(editor)[0].id

    expect(editor.insertTemplateBlockBefore(anchorId, 'code-block')).toBe(true)
    expect(editor.insertTemplateBlockBefore(anchorId, 'table')).toBe(true)

    expect(snapshot(editor)).toMatchObject([
      { type: 'code-block', raw: '```\n\n```' },
      { type: 'table', raw: '|  |  |\n| --- | --- |\n|  |  |' },
      { type: 'paragraph', raw: 'anchor' },
    ])

    editor.destroy()
  })

  test('runs module-specific commands through markdown raw text', () => {
    const editor = createEditor('- [ ] todo\n```js\nconst x = 1\n```\n| a | b |\n| --- | --- |\n| 1 | 2 |')
    const [task, code, table] = snapshot(editor)

    expect(editor.toggleTaskListItem(task.id)).toBe(true)
    expect(snapshot(editor)[0]).toMatchObject({
      type: 'list-item',
      raw: '- [x] todo',
    })

    expect(editor.indentListItem(task.id)).toBe(true)
    expect(snapshot(editor)[0]).toMatchObject({
      type: 'list-item',
      raw: '    - [x] todo',
    })

    expect(editor.outdentListItem(task.id)).toBe(true)
    expect(snapshot(editor)[0]).toMatchObject({
      type: 'list-item',
      raw: '- [x] todo',
    })

    expect(editor.setCodeBlockLanguage(code.id, 'ts')).toBe(true)
    expect(snapshot(editor)[1]).toMatchObject({
      type: 'code-block',
      raw: '```ts\nconst x = 1\n```',
    })

    expect(editor.insertTableRowAfter(table.id)).toBe(true)
    expect(snapshot(editor)[2]).toMatchObject({
      type: 'table',
      raw: '| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |',
    })

    expect(editor.insertTableColumnAfter(table.id)).toBe(true)
    expect(snapshot(editor)[2]).toMatchObject({
      type: 'table',
      raw: '| a | b |  |\n| --- | --- | --- |\n| 1 | 2 |  |\n|  |  |  |',
    })

    expect(editor.deleteTableLastRow(table.id)).toBe(true)
    expect(snapshot(editor)[2]).toMatchObject({
      type: 'table',
      raw: '| a | b |  |\n| --- | --- | --- |\n| 1 | 2 |  |',
    })

    expect(editor.deleteTableLastColumn(table.id)).toBe(true)
    expect(snapshot(editor)[2]).toMatchObject({
      type: 'table',
      raw: '| a | b |\n| --- | --- |\n| 1 | 2 |',
    })

    editor.destroy()
  })

  test('rejects module-specific commands on incompatible blocks', () => {
    const editor = createEditor('paragraph')
    const id = snapshot(editor)[0].id

    expect(editor.toggleTaskListItem(id)).toBe(false)
    expect(editor.indentListItem(id)).toBe(false)
    expect(editor.outdentListItem(id)).toBe(false)
    expect(editor.increaseBlockquoteLevel(id)).toBe(false)
    expect(editor.decreaseBlockquoteLevel(id)).toBe(false)
    expect(editor.promoteHeadingLevel(id)).toBe(false)
    expect(editor.demoteHeadingLevel(id)).toBe(false)
    expect(editor.setCodeBlockLanguage(id, 'ts')).toBe(false)
    expect(editor.setCodeBlockFence(id, '~~~')).toBe(false)
    expect(editor.insertTableRowAfter(id)).toBe(false)
    expect(editor.insertTableColumnAfter(id)).toBe(false)
    expect(editor.deleteTableLastRow(id)).toBe(false)
    expect(editor.deleteTableLastColumn(id)).toBe(false)
    expect(snapshot(editor)).toMatchObject([
      { type: 'paragraph', raw: 'paragraph' },
    ])

    editor.destroy()
  })

  test('indents and outdents ordered list items without changing list markers', () => {
    const editor = createEditor('7. numbered')
    const item = snapshot(editor)[0]

    expect(editor.indentListItem(item.id)).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'list-item', raw: '    7. numbered' },
    ])

    expect(editor.outdentListItem(item.id)).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'list-item', raw: '7. numbered' },
    ])

    expect(editor.outdentListItem(item.id)).toBe(false)
    expect(snapshot(editor)).toMatchObject([
      { type: 'list-item', raw: '7. numbered' },
    ])

    editor.destroy()
  })

  test('switches code block fence type while preserving language and content', () => {
    const editor = createEditor('```ts\nconst x = 1\n```')
    const code = snapshot(editor)[0]

    expect(editor.setCodeBlockFence(code.id, '~~~')).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'code-block', raw: '~~~ts\nconst x = 1\n~~~' },
    ])

    expect(editor.setCodeBlockFence(code.id, '~~~')).toBe(false)
    expect(snapshot(editor)).toMatchObject([
      { type: 'code-block', raw: '~~~ts\nconst x = 1\n~~~' },
    ])

    expect(editor.setCodeBlockFence(code.id, '```')).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'code-block', raw: '```ts\nconst x = 1\n```' },
    ])

    editor.destroy()
  })

  test('promotes and demotes heading levels within h1-h6 bounds', () => {
    const editor = createEditor('### title')
    const heading = snapshot(editor)[0]

    expect(editor.promoteHeadingLevel(heading.id)).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'heading', raw: '## title' },
    ])

    expect(editor.promoteHeadingLevel(heading.id)).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'heading', raw: '# title' },
    ])

    expect(editor.promoteHeadingLevel(heading.id)).toBe(false)
    expect(snapshot(editor)).toMatchObject([
      { type: 'heading', raw: '# title' },
    ])

    for (let i = 0; i < 5; i += 1) {
      expect(editor.demoteHeadingLevel(heading.id)).toBe(true)
    }
    expect(snapshot(editor)).toMatchObject([
      { type: 'heading', raw: '###### title' },
    ])

    expect(editor.demoteHeadingLevel(heading.id)).toBe(false)
    expect(snapshot(editor)).toMatchObject([
      { type: 'heading', raw: '###### title' },
    ])

    editor.destroy()
  })

  test('increases and decreases blockquote depth through markdown markers', () => {
    const editor = createEditor('> quoted **text**')
    const quote = snapshot(editor)[0]

    expect(editor.increaseBlockquoteLevel(quote.id)).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'blockquote', raw: '>> quoted **text**' },
    ])

    expect(editor.decreaseBlockquoteLevel(quote.id)).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'blockquote', raw: '> quoted **text**' },
    ])

    expect(editor.decreaseBlockquoteLevel(quote.id)).toBe(true)
    expect(snapshot(editor)).toMatchObject([
      { type: 'paragraph', raw: 'quoted **text**' },
    ])

    expect(editor.increaseBlockquoteLevel(quote.id)).toBe(false)
    expect(editor.decreaseBlockquoteLevel(quote.id)).toBe(false)

    editor.destroy()
  })

  test('preserves minimum table shape for destructive table commands', () => {
    const editor = createEditor('| only |\n| --- |')
    const table = snapshot(editor)[0]

    expect(editor.deleteTableLastRow(table.id)).toBe(false)
    expect(editor.deleteTableLastColumn(table.id)).toBe(false)
    expect(snapshot(editor)).toMatchObject([
      { type: 'table', raw: '| only |\n| --- |' },
    ])

    editor.destroy()
  })
})
