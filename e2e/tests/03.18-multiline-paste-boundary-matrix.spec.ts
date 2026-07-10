import { test, expect, type Page } from '@playwright/test'
import {
  blockIdAt,
  getEditorSnapshot,
  gotoPlayground,
  placeCaret,
  resetEditor,
  simulatePaste,
} from './helpers/editor'

const pasteCases = [
  { name: 'bold', markdown: 'a **bold** z' },
  { name: 'nested', markdown: 'a **bold *italic*** z' },
  { name: 'link', markdown: 'a [label](url) z' },
  { name: 'image', markdown: 'a ![alt](src) z' },
  { name: 'inline-math', markdown: 'a $x+y$ z' },
  { name: 'task', markdown: '* [X] task' },
  { name: 'blockquote', markdown: '>>> quote' },
]

test.describe('03.18 multiline paste across Markdown boundaries', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  for (const pasteCase of pasteCases) {
    test(`3.18 ${pasteCase.name}: multiline paste splits at every raw offset`, async ({ page }) => {
      const source = pasteCase.markdown

      for (let offset = 0; offset <= source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await simulatePaste(page, 'X\nY')

        const expected = `${source.slice(0, offset)}X\nY${source.slice(offset)}`
        const actual = await page.evaluate(() => window.__markit.getMarkdown())
        expect(actual, `${pasteCase.name} multiline paste at ${offset}`).toBe(expected)

        const snapshot = await getEditorSnapshot(page)
        expect(snapshot.blocks.map(block => block.raw)).toEqual([
          `${source.slice(0, offset)}X`,
          `Y${source.slice(offset)}`,
        ])
        expect(snapshot.expandedBlockId).toBe(snapshot.blocks[1].id)
      }
    })
  }
})
