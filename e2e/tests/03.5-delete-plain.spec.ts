import { test, expect } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  placeCaret,
  blockIdAt,
  getEditorSnapshot,
  expectMarkdownEquals,
  setSelection,
} from './helpers/editor'

/**
 * 场景 3.5：在 Block 内执行非特殊字符的删除
 */
test.describe('03.5 delete plain chars', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  test('3.5.1 paragraph 中间 Backspace → 长度-1', async ({ page }) => {
    await resetEditor(page, 'hello')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 3) // hel|lo
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, 'helo')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('paragraph')
  })

  test('3.5.3 连续 Backspace 删到空 → 转 blank/空 paragraph', async ({ page }) => {
    await resetEditor(page, 'abc')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 3)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, '')
  })

  test('3.5.4 Delete 在行中 → 只删 1 字，光标不动', async ({ page }) => {
    await resetEditor(page, 'hello')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 2)
    await page.keyboard.press('Delete')
    await expectMarkdownEquals(page, 'helo')
  })

  test('3.5.6 跨 block 选区下 Backspace → 合并为一 block', async ({ page }) => {
    await resetEditor(page, 'foo\nbar\nbaz')
    const id0 = await blockIdAt(page, 0)
    const id2 = await blockIdAt(page, 2)
    await setSelection(
      page,
      { blockId: id0, offset: 2 },
      { blockId: id2, offset: 1 },
    )
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, 'foaz')
  })
})
