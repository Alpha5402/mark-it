import { test, expect, type Page } from '@playwright/test'
import {
  blockIdAt,
  gotoPlayground,
  placeCaret,
  resetEditor,
  setSelection,
  simulateIME,
} from './helpers/editor'

const imeCases = [
  { name: 'nested', markdown: 'a **bold *italic*** z', boundaries: [0, 2, 4, 9, 10, 16, 19, 21] },
  { name: 'link', markdown: 'a [label](url) z', boundaries: [0, 2, 3, 8, 10, 13, 14, 16] },
  { name: 'task', markdown: '* [X] task', boundaries: [0, 2, 3, 4, 5, 6, 10] },
]

async function markdown(page: Page) {
  return page.evaluate(() => window.__markit.getMarkdown())
}

test.describe('04.3 IME across Markdown boundaries', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  for (const imeCase of imeCases) {
    test(`4.3 ${imeCase.name}: composition commits once at every raw offset`, async ({ page }) => {
      for (let offset = 0; offset <= imeCase.markdown.length; offset += 1) {
        await resetEditor(page, imeCase.markdown)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await simulateIME(page, '你好', ['你', '你好'])

        const expected = `${imeCase.markdown.slice(0, offset)}你好${imeCase.markdown.slice(offset)}`
        expect(await markdown(page), `${imeCase.name} IME at ${offset}`).toBe(expected)
      }
    })

    test(`4.3 ${imeCase.name}: composition replaces selections across marker boundaries`, async ({ page }) => {
      for (let index = 0; index < imeCase.boundaries.length - 1; index += 1) {
        const start = imeCase.boundaries[index]
        const end = imeCase.boundaries[index + 1]
        await resetEditor(page, imeCase.markdown)
        const blockId = await blockIdAt(page, 0)
        await setSelection(page, { blockId, offset: start }, { blockId, offset: end })
        await simulateIME(page, '界', ['世', '世界'])

        const expected = `${imeCase.markdown.slice(0, start)}界${imeCase.markdown.slice(end)}`
        expect(await markdown(page), `${imeCase.name} IME selection [${start}, ${end})`).toBe(expected)
      }
    })
  }
})
