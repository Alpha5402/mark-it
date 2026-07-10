import { test, expect, type Page } from '@playwright/test'
import {
  blockIdAt,
  blockLocator,
  gotoPlayground,
  resetEditor,
  setSelection,
  simulatePaste,
} from './helpers/editor'

type SelectionCase = {
  name: string
  markdown: string
  boundaries: number[]
}

const selectionCases: SelectionCase[] = [
  { name: 'bold', markdown: 'a **bold** z', boundaries: [0, 2, 4, 8, 10, 12] },
  { name: 'nested-bold-italic', markdown: 'a **bold *italic*** z', boundaries: [0, 2, 4, 9, 10, 16, 19, 21] },
  { name: 'link', markdown: 'a [label](url) z', boundaries: [0, 2, 3, 8, 10, 13, 14, 16] },
  { name: 'image', markdown: 'a ![alt](src) z', boundaries: [0, 2, 4, 7, 9, 12, 13, 15] },
  { name: 'inline-math', markdown: 'a $x+y$ z', boundaries: [0, 2, 3, 6, 7, 9] },
  { name: 'task-list', markdown: '- [x] task', boundaries: [0, 2, 3, 4, 5, 6, 10] },
  { name: 'blockquote', markdown: '>>> quote', boundaries: [0, 1, 2, 3, 4, 9] },
  { name: 'footnote-definition', markdown: '[^note]: definition', boundaries: [0, 2, 6, 7, 8, 9, 19] },
]

function ranges(boundaries: number[]) {
  const result: Array<[number, number]> = []
  for (let startIndex = 0; startIndex < boundaries.length; startIndex += 1) {
    for (let endIndex = startIndex + 1; endIndex < boundaries.length; endIndex += 1) {
      result.push([boundaries[startIndex], boundaries[endIndex]])
    }
  }
  return result
}

async function currentRaw(page: Page, blockId: string) {
  return page.evaluate((id) => window.__markit.editor.doc.getRawText(id), blockId)
}

async function assertResult(page: Page, blockId: string, expected: string, context: string) {
  expect(await currentRaw(page, blockId), context).toBe(expected)
  const visibleDomText = (await blockLocator(page, blockId).textContent())?.replace(/\u200B/g, '')
  expect(visibleDomText, `${context} expanded DOM`).toBe(expected)
}

test.describe('03.16 selection across Markdown boundaries', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  for (const selectionCase of selectionCases) {
    test(`3.16 ${selectionCase.name}: forward and reverse selections replace exact raw ranges`, async ({ page }) => {
      for (const [start, end] of ranges(selectionCase.boundaries)) {
        for (const reversed of [false, true]) {
          await resetEditor(page, selectionCase.markdown)
          const blockId = await blockIdAt(page, 0)
          const anchor = reversed ? end : start
          const focus = reversed ? start : end
          await setSelection(page, { blockId, offset: anchor }, { blockId, offset: focus })
          await page.keyboard.type('X')

          const expected = `${selectionCase.markdown.slice(0, start)}X${selectionCase.markdown.slice(end)}`
          await assertResult(
            page,
            blockId,
            expected,
            `${selectionCase.name} ${reversed ? 'reverse' : 'forward'} replace [${start}, ${end})`,
          )
        }
      }
    })

    test(`3.16 ${selectionCase.name}: deletion and paste honor exact raw ranges`, async ({ page }) => {
      for (const [start, end] of ranges(selectionCase.boundaries)) {
        await resetEditor(page, selectionCase.markdown)
        let blockId = await blockIdAt(page, 0)
        await setSelection(page, { blockId, offset: start }, { blockId, offset: end })
        await page.keyboard.press('Backspace')
        const deleted = `${selectionCase.markdown.slice(0, start)}${selectionCase.markdown.slice(end)}`
        await assertResult(page, blockId, deleted, `${selectionCase.name} delete [${start}, ${end})`)

        await resetEditor(page, selectionCase.markdown)
        blockId = await blockIdAt(page, 0)
        await setSelection(page, { blockId, offset: start }, { blockId, offset: end })
        await simulatePaste(page, 'Y')
        const pasted = `${selectionCase.markdown.slice(0, start)}Y${selectionCase.markdown.slice(end)}`
        await assertResult(page, blockId, pasted, `${selectionCase.name} paste [${start}, ${end})`)
      }
    })
  }
})
