// @vitest-environment jsdom

import { afterEach, describe, expect, test } from 'vitest'
import { Editor } from './Editor'
import { EditorActionType, type SelectionSnapshot } from './EditorEventController'

function snapshot(editor: Editor) {
  return Array.from(editor.doc.getBlocks().values()).map(block => ({
    id: block.id,
    type: block.type,
    raw: editor.doc.getRawText(block.id),
  }))
}

function currentSelection(): SelectionSnapshot {
  const selection = window.getSelection()
  if (!selection || !selection.anchorNode || !selection.focusNode) {
    throw new Error('Expected a DOM selection')
  }

  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
    isCollapsed: selection.isCollapsed,
  }
}

function createEditor(markdown: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return new Editor(container, 'Test', markdown)
}

function pressEnterAtRawOffset(editor: Editor, rawOffset: number) {
  const block = Array.from(editor.doc.getBlocks().values())[0]
  editor.dom.renderBlockExpanded(block)
  editor.dom.setCursorByRawOffset(block.id, rawOffset)
  editor.handleEditorAction({
    type: EditorActionType.InsertLineBreak,
    selection: currentSelection(),
    nativeEvent: null,
    timestamp: Date.now(),
  })
}

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
})

describe('Editor fenced block line breaks', () => {
  test('pressing Enter after a code block closing fence exits the block', () => {
    const source = '```js\naa\n```'
    const editor = createEditor(source)

    pressEnterAtRawOffset(editor, source.length)

    expect(snapshot(editor)).toMatchObject([
      { type: 'code-block', raw: source },
      { type: 'blank', raw: '' },
    ])
    expect(editor.dom.getExpandedBlockId()).toBe(snapshot(editor)[1].id)

    editor.destroy()
  })

  test('pressing Enter after a math block closing fence exits the block', () => {
    const source = '$$\naa\n$$'
    const editor = createEditor(source)

    pressEnterAtRawOffset(editor, source.length)

    expect(snapshot(editor)).toMatchObject([
      { type: 'math-block', raw: source },
      { type: 'blank', raw: '' },
    ])
    expect(editor.dom.getExpandedBlockId()).toBe(snapshot(editor)[1].id)

    editor.destroy()
  })

  test('pressing Enter before the closing fence keeps the line break inside the block', () => {
    const source = '```\naa\n```'
    const editor = createEditor(source)
    const beforeClosingFence = source.lastIndexOf('\n')

    pressEnterAtRawOffset(editor, beforeClosingFence)

    expect(snapshot(editor)).toMatchObject([
      { type: 'code-block', raw: '```\naa\n\n```' },
    ])

    editor.destroy()
  })

  test('clicking document trailing blank space moves the cursor to the last line end', () => {
    const editor = createEditor('first\nlast')
    const lastBlock = snapshot(editor)[1]

    editor.view.document.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      clientY: 100,
    }))

    const selection = window.getSelection()
    expect(editor.dom.getExpandedBlockId()).toBe(lastBlock.id)
    expect(selection?.anchorNode?.textContent).toBe('last')
    expect(selection?.anchorOffset).toBe('last'.length)

    editor.destroy()
  })

  test('clicking a collapsed empty code block expands it at the opening fence end', () => {
    const source = '```js\n```'
    const editor = createEditor(source)
    const codeBlock = editor.view.area.querySelector('.md-code-block')

    codeBlock?.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    }))

    const selection = window.getSelection()
    expect(editor.dom.getExpandedBlockId()).toBe(snapshot(editor)[0].id)
    expect(selection?.anchorNode?.textContent).toBe('```js')
    expect(selection?.anchorOffset).toBe('```js'.length)
    expect(editor.view.area.textContent).toBe(source)

    editor.destroy()
  })

  test('clicking an empty code block collapses the previously expanded code block', () => {
    const editor = createEditor('```js\naa\n```\n```ts\n```')
    const blocks = snapshot(editor)
    editor.dom.renderBlockExpanded(editor.doc.getBlock(blocks[0].id)!)

    const codeBlocks = editor.view.area.querySelectorAll('.md-code-block')
    codeBlocks[1]?.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    }))

    expect(editor.dom.getExpandedBlockId()).toBe(blocks[1].id)
    expect(editor.view.area.querySelectorAll('.md-block-expanded')).toHaveLength(1)

    editor.destroy()
  })

  test('clicking collapsed code content places the cursor at the opening fence end', () => {
    const source = '```js\nabc\n```'
    const editor = createEditor(source)

    editor.view.area.querySelector('.md-code-block')?.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    }))

    const selection = window.getSelection()
    expect(editor.dom.getExpandedBlockId()).toBe(snapshot(editor)[0].id)
    expect(selection?.anchorNode?.textContent).toBe('```js')
    expect(selection?.anchorOffset).toBe('```js'.length)

    editor.destroy()
  })

  test('clicking another block after an expanded empty code block collapses it', () => {
    const editor = createEditor('```ts\n```\n$$\nx\n$$')
    const blocks = snapshot(editor)
    editor.dom.renderBlockExpanded(editor.doc.getBlock(blocks[0].id)!)

    editor.view.area.querySelector('.md-math-block')?.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    }))

    expect(editor.dom.getExpandedBlockId()).toBeNull()
    expect(editor.view.area.querySelectorAll('.md-block-expanded')).toHaveLength(0)

    editor.destroy()
  })
})
