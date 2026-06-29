// @vitest-environment jsdom

import { afterEach, describe, expect, test } from 'vitest'
import { Editor } from './Editor'

function createEditor(markdown: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return new Editor(container, 'Test', markdown)
}

function firstBlock(editor: Editor) {
  const block = Array.from(editor.doc.getBlocks().values())[0]
  if (!block) throw new Error('Expected a block')
  return block
}

function selectRawRange(editor: Editor, start: number, end: number) {
  const block = firstBlock(editor)
  editor.dom.renderBlockExpanded(block)
  editor.dom.setSelectionByRawOffsets(block.id, start, block.id, end)
}

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
})

describe('Editor inline format state', () => {
  test('reports active when the selection is wholly inside one format', () => {
    const editor = createEditor('**aaa**')

    selectRawRange(editor, 2, 5)

    expect(editor.getSelectionInlineFormatState()).toMatchObject({
      bold: 'active',
      italic: 'inactive'
    })

    editor.destroy()
  })

  test('reports mixed for related formats when selection crosses nested syntax segments', () => {
    const editor = createEditor('**abc_def_ghi**')

    selectRawRange(editor, 2, 9)

    expect(editor.getSelectionInlineFormatState()).toMatchObject({
      bold: 'mixed',
      italic: 'mixed',
      strikethrough: 'inactive'
    })

    editor.destroy()
  })

  test('ignores surrounding markers when selection is inside one nested segment', () => {
    const editor = createEditor('**abc_def_ghi**')

    selectRawRange(editor, 6, 9)

    expect(editor.getSelectionInlineFormatState()).toMatchObject({
      bold: 'active',
      italic: 'active',
      strikethrough: 'inactive'
    })

    editor.destroy()
  })
})
