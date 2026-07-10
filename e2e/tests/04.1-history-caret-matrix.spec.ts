import { test, expect, type Page } from '@playwright/test'
import {
  blockIdAt,
  gotoPlayground,
  placeCaret,
  resetEditor,
} from './helpers/editor'

const historyCases = [
  { name: 'bold', markdown: 'a **bold** z' },
  { name: 'nested', markdown: 'a **bold *italic*** z' },
  { name: 'link', markdown: 'a [label](url) z' },
  { name: 'task', markdown: '* [X] task' },
  { name: 'blockquote', markdown: '>>> quote' },
]

async function markdown(page: Page) {
  return page.evaluate(() => window.__markit.getMarkdown())
}

test.describe('04.1 undo/redo caret matrix', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  for (const historyCase of historyCases) {
    test(`4.1 ${historyCase.name}: undo restores every insertion caret`, async ({ page }) => {
      const source = historyCase.markdown

      for (let offset = 0; offset <= source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await page.keyboard.type('X')
        await page.keyboard.press('Meta+z')
        expect(await markdown(page), `${historyCase.name} undo insertion at ${offset}`).toBe(source)

        // A new edit after undo proves the restored selection is at the original raw offset.
        await page.keyboard.type('Y')
        const expected = `${source.slice(0, offset)}Y${source.slice(offset)}`
        expect(await markdown(page), `${historyCase.name} restored caret at ${offset}`).toBe(expected)
      }
    })

    test(`4.1 ${historyCase.name}: deletion undo/redo round-trips every raw position`, async ({ page }) => {
      const source = historyCase.markdown

      for (let offset = 1; offset <= source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await page.keyboard.press('Backspace')
        const deleted = `${source.slice(0, offset - 1)}${source.slice(offset)}`
        expect(await markdown(page), `${historyCase.name} delete at ${offset}`).toBe(deleted)

        await page.keyboard.press('Meta+z')
        expect(await markdown(page), `${historyCase.name} undo delete at ${offset}`).toBe(source)
        await page.keyboard.press('Meta+Shift+z')
        expect(await markdown(page), `${historyCase.name} redo delete at ${offset}`).toBe(deleted)
      }
    })
  }
})
