import { test, expect } from '@playwright/test'
import {
  blockIdAt,
  expectBlockCount,
  expectMarkdownEquals,
  gotoPlayground,
  resetEditor,
  setSelection,
  simulateCut,
} from './helpers/editor'

test.describe('04.2 model-driven Cut behavior', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  test('4.2.1 cuts an exact raw range through inline markers', async ({ page }) => {
    await resetEditor(page, 'a **bold** z')
    const id = await blockIdAt(page, 0)
    await setSelection(page, { blockId: id, offset: 2 }, { blockId: id, offset: 10 })

    expect(await simulateCut(page)).toBe('**bold**')
    await expectMarkdownEquals(page, 'a  z')
  })

  test('4.2.2 reverse cross-block Cut copies exact slices and merges remaining Markdown', async ({ page }) => {
    await resetEditor(page, 'aaa\n**bbb**\nccc')
    const first = await blockIdAt(page, 0)
    const last = await blockIdAt(page, 2)
    await setSelection(page, { blockId: last, offset: 2 }, { blockId: first, offset: 1 })

    expect(await simulateCut(page)).toBe('aa\n**bbb**\ncc')
    await expectMarkdownEquals(page, 'ac')
    await expectBlockCount(page, 1)
  })

  test('4.2.3 cross-block Cut is undoable', async ({ page }) => {
    const source = 'first\n- [X] middle\n> last'
    await resetEditor(page, source)
    const first = await blockIdAt(page, 0)
    const last = await blockIdAt(page, 2)
    await setSelection(page, { blockId: first, offset: 2 }, { blockId: last, offset: 2 })

    await simulateCut(page)
    await page.keyboard.press('Meta+z')
    await expectMarkdownEquals(page, source)
    await expectBlockCount(page, 3)
  })
})
