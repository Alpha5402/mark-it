import { test, expect, type Page } from '@playwright/test'
import {
  blockIdAt,
  blockLocator,
  gotoPlayground,
  placeCaret,
  resetEditor,
} from './helpers/editor'

const structuralCases = [
  { name: 'heading-1', markdown: '# heading' },
  { name: 'heading-6', markdown: '###### heading' },
  { name: 'unordered-list', markdown: '- item' },
  { name: 'star-list', markdown: '* item' },
  { name: 'plus-list', markdown: '+ item' },
  { name: 'ordered-list', markdown: '12. item' },
  { name: 'unchecked-task', markdown: '- [ ] task' },
  { name: 'checked-task', markdown: '- [x] done' },
  { name: 'nested-list', markdown: '    - nested' },
  { name: 'blockquote', markdown: '> quote' },
  { name: 'nested-blockquote', markdown: '>>> quote' },
  { name: 'footnote-definition', markdown: '[^note]: definition' },
  { name: 'horizontal-rule', markdown: '---' },
]

async function currentRawText(page: Page, blockId: string) {
  return page.evaluate(
    (id) => window.__markit.editor.doc.getRawText(id),
    blockId,
  )
}

async function expectRawAndExpandedDom(
  page: Page,
  blockId: string,
  expected: string,
  context: string,
) {
  expect(await currentRawText(page, blockId), context).toBe(expected)
  expect(await blockLocator(page, blockId).textContent(), `${context} expanded DOM`).toBe(expected)
}

test.describe('03.15 structural marker caret position matrix', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  for (const structuralCase of structuralCases) {
    test(`3.15 ${structuralCase.name}: every marker/content boundary is editable`, async ({ page }) => {
      const source = structuralCase.markdown

      for (let offset = 0; offset <= source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await page.keyboard.type('X')
        const expected = `${source.slice(0, offset)}X${source.slice(offset)}`
        await expectRawAndExpandedDom(page, blockId, expected, `${structuralCase.name} insert at ${offset}`)
      }
    })

    test(`3.15 ${structuralCase.name}: Backspace/Delete target the adjacent raw character`, async ({ page }) => {
      const source = structuralCase.markdown

      for (let offset = 1; offset <= source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await page.keyboard.press('Backspace')
        const expected = `${source.slice(0, offset - 1)}${source.slice(offset)}`
        await expectRawAndExpandedDom(page, blockId, expected, `${structuralCase.name} Backspace at ${offset}`)
      }

      for (let offset = 0; offset < source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await page.keyboard.press('Delete')
        const expected = `${source.slice(0, offset)}${source.slice(offset + 1)}`
        await expectRawAndExpandedDom(page, blockId, expected, `${structuralCase.name} Delete at ${offset}`)
      }
    })

    test(`3.15 ${structuralCase.name}: arrows move one visible raw character`, async ({ page }) => {
      const source = structuralCase.markdown

      for (let offset = 0; offset < source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await page.keyboard.press('ArrowRight')
        await page.keyboard.type('X')
        const target = offset + 1
        const expected = `${source.slice(0, target)}X${source.slice(target)}`
        expect(await currentRawText(page, blockId), `${structuralCase.name} ArrowRight at ${offset}`).toBe(expected)
      }

      for (let offset = 1; offset <= source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.type('X')
        const target = offset - 1
        const expected = `${source.slice(0, target)}X${source.slice(target)}`
        expect(await currentRawText(page, blockId), `${structuralCase.name} ArrowLeft at ${offset}`).toBe(expected)
      }
    })
  }
})
