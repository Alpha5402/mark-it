import { test, expect, type Page } from '@playwright/test'
import {
  blockIdAt,
  blockLocator,
  gotoPlayground,
  placeCaret,
  resetEditor,
} from './helpers/editor'

type InlineCase = {
  name: string
  markdown: string
}

const inlineCases: InlineCase[] = [
  { name: 'bold', markdown: 'a **bold** z' },
  { name: 'italic', markdown: 'a *italic* z' },
  { name: 'strikethrough', markdown: 'a ~~strike~~ z' },
  { name: 'highlight', markdown: 'a ==highlight== z' },
  { name: 'inline-code', markdown: 'a `const x = 1` z' },
  { name: 'link', markdown: 'a [label](https://example.test/a) z' },
]

async function currentRawText(page: Page, blockId: string) {
  return page.evaluate(
    (id) => window.__markit.editor.doc.getRawText(id),
    blockId,
  )
}

/**
 * Exhaustively verifies the mapping from every visible expanded-text boundary
 * back to its Markdown raw offset. This catches marker-span and nested-node
 * off-by-one errors that a few representative caret positions cannot expose.
 */
test.describe('03.14 inline caret position matrix', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  for (const inlineCase of inlineCases) {
    test(`3.14 ${inlineCase.name}: every raw offset inserts at the visible caret`, async ({ page }) => {
      const source = inlineCase.markdown

      for (let offset = 0; offset <= source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await page.keyboard.type('X')

        const expected = `${source.slice(0, offset)}X${source.slice(offset)}`
        expect(
          await currentRawText(page, blockId),
          `${inlineCase.name} insertion at raw offset ${offset}`,
        ).toBe(expected)
        expect(
          await blockLocator(page, blockId).textContent(),
          `${inlineCase.name} expanded DOM at raw offset ${offset}`,
        ).toBe(expected)
      }
    })

    test(`3.14 ${inlineCase.name}: Backspace deletes the raw character before every caret`, async ({ page }) => {
      const source = inlineCase.markdown

      for (let offset = 1; offset <= source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await page.keyboard.press('Backspace')

        const expected = `${source.slice(0, offset - 1)}${source.slice(offset)}`
        expect(
          await currentRawText(page, blockId),
          `${inlineCase.name} Backspace at raw offset ${offset}`,
        ).toBe(expected)
        expect(
          await blockLocator(page, blockId).textContent(),
          `${inlineCase.name} expanded DOM after Backspace at raw offset ${offset}`,
        ).toBe(expected)
      }
    })

    test(`3.14 ${inlineCase.name}: Delete removes the raw character at every caret`, async ({ page }) => {
      const source = inlineCase.markdown

      for (let offset = 0; offset < source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await page.keyboard.press('Delete')

        const expected = `${source.slice(0, offset)}${source.slice(offset + 1)}`
        expect(
          await currentRawText(page, blockId),
          `${inlineCase.name} Delete at raw offset ${offset}`,
        ).toBe(expected)
        expect(
          await blockLocator(page, blockId).textContent(),
          `${inlineCase.name} expanded DOM after Delete at raw offset ${offset}`,
        ).toBe(expected)
      }
    })
  }
})
