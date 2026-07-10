import { test, expect, type Page } from '@playwright/test'
import {
  blockIdAt,
  gotoPlayground,
  placeCaret,
  resetEditor,
  setSelection,
} from './helpers/editor'

type FormatCase = {
  name: string
  method: 'toggleBold' | 'toggleItalic' | 'toggleStrikethrough' | 'toggleHighlight' | 'toggleCode' | 'insertLink'
  prefix: string
  suffix: string
  toggles: boolean
}

const formatCases: FormatCase[] = [
  { name: 'bold', method: 'toggleBold', prefix: '**', suffix: '**', toggles: true },
  { name: 'italic', method: 'toggleItalic', prefix: '*', suffix: '*', toggles: true },
  { name: 'strikethrough', method: 'toggleStrikethrough', prefix: '~~', suffix: '~~', toggles: true },
  { name: 'highlight', method: 'toggleHighlight', prefix: '==', suffix: '==', toggles: true },
  { name: 'inline-code', method: 'toggleCode', prefix: '`', suffix: '`', toggles: true },
  { name: 'link', method: 'insertLink', prefix: '[', suffix: '](url)', toggles: false },
]

async function invokeFormat(page: Page, method: FormatCase['method']) {
  await page.evaluate((name) => {
    const editor = window.__markit.editor as unknown as Record<string, () => void>
    editor[name]()
  }, method)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))))
}

async function markdown(page: Page) {
  return page.evaluate(() => window.__markit.getMarkdown())
}

test.describe('04.4 public format command matrix', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  for (const formatCase of formatCases) {
    test(`4.4 ${formatCase.name}: collapsed command inserts a template at every raw offset`, async ({ page }) => {
      const source = 'a text z'
      for (let offset = 0; offset <= source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await invokeFormat(page, formatCase.method)
        await page.keyboard.type('X')

        const expected = `${source.slice(0, offset)}${formatCase.prefix}X${formatCase.suffix}${source.slice(offset)}`
        expect(await markdown(page), `${formatCase.name} collapsed at ${offset}`).toBe(expected)
      }
    })

    test(`4.4 ${formatCase.name}: forward and reverse selections wrap exact raw text`, async ({ page }) => {
      const source = 'a text z'
      for (const reversed of [false, true]) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await setSelection(
          page,
          { blockId, offset: reversed ? 6 : 2 },
          { blockId, offset: reversed ? 2 : 6 },
        )
        await invokeFormat(page, formatCase.method)
        const wrapped = `a ${formatCase.prefix}text${formatCase.suffix} z`
        expect(await markdown(page), `${formatCase.name} ${reversed ? 'reverse' : 'forward'} wrap`).toBe(wrapped)

        if (formatCase.toggles) {
          await invokeFormat(page, formatCase.method)
          expect(await markdown(page), `${formatCase.name} unwrap`).toBe(source)
        }
      }
    })
  }

  test('4.4 bold command respects every task-marker raw offset', async ({ page }) => {
    const source = '* [X] task'
    for (let offset = 0; offset <= source.length; offset += 1) {
      await resetEditor(page, source)
      const blockId = await blockIdAt(page, 0)
      await placeCaret(page, blockId, offset)
      await invokeFormat(page, 'toggleBold')
      await page.keyboard.type('Y')
      const expected = `${source.slice(0, offset)}**Y**${source.slice(offset)}`
      expect(await markdown(page), `bold task marker at ${offset}`).toBe(expected)
    }
  })
})
