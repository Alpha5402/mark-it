import { test, expect } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  placeCaret,
  blockIdAt,
  getEditorSnapshot,
  expectBlockCount,
  expectMarkdownEquals,
  setSelection,
} from './helpers/editor'

/**
 * 场景 2：删除 Block（整个删除 / 类型退化 / 合并）
 * 覆盖 Backspace/Delete/选区删除 三种路径。
 */
test.describe('02 delete block', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  test('2.1 段首 Backspace 与前一 block 合并', async ({ page }) => {
    await resetEditor(page, 'hello\nworld')
    await expectBlockCount(page, 2)
    const id1 = await blockIdAt(page, 1)
    await placeCaret(page, id1, 0) // 第二个 block 行首
    await page.keyboard.press('Backspace')
    await expectBlockCount(page, 1)
    await expectMarkdownEquals(page, 'helloworld')
  })

  test('2.2 blank block 上 Backspace 合并到上一 block', async ({ page }) => {
    await resetEditor(page, 'hello\n\n')
    const snap0 = await getEditorSnapshot(page)
    const lastId = snap0.blocks[snap0.blocks.length - 1].id
    await placeCaret(page, lastId, 0)
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, 'hello\n')
  })

  test('2.3 首个 blank block 上 Backspace → 保持空文档', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, '')
  })

  test('2.4 行尾 Delete → 删除换行并与下一 block 合并', async ({ page }) => {
    await resetEditor(page, 'abc\ndef')
    const id0 = await blockIdAt(page, 0)
    await placeCaret(page, id0, 'abc'.length)
    await page.keyboard.press('Delete')
    await expectMarkdownEquals(page, 'abcdef')
  })

  test('2.5 删空全部内容 → block 退化为 blank/空 paragraph', async ({ page }) => {
    await resetEditor(page, 'hi')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 'hi'.length)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, '')
    const snap = await getEditorSnapshot(page)
    expect(snap.blockCount).toBeGreaterThanOrEqual(1)
    expect(['blank', 'paragraph']).toContain(snap.blocks[0].type)
  })

  test('2.6 heading marker 区 Backspace → h2 降为 h1', async ({ page }) => {
    await resetEditor(page, '## Title')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 1)
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, '# Title')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('heading')
  })

  test('2.7 list-item marker 区 Backspace → 退出 list', async ({ page }) => {
    await resetEditor(page, '- item')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 1) // 在 "- " 之间
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, ' item')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('paragraph')
  })

  test('2.8 blockquote marker 区 Backspace → 变 paragraph', async ({ page }) => {
    await resetEditor(page, '> quoted')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 1)
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, 'quoted')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('paragraph')
  })

  test('2.10 跨 block 选区后 Backspace → 中间 block 被删除并合并', async ({ page }) => {
    await resetEditor(page, 'first\nmiddle\nlast')
    const id0 = await blockIdAt(page, 0)
    const id2 = await blockIdAt(page, 2)
    await setSelection(
      page,
      { blockId: id0, offset: 'first'.length - 2 }, // 'fir|st'
      { blockId: id2, offset: 2 },                  // 'la|st'
    )
    await page.keyboard.press('Backspace')
    await expectBlockCount(page, 1)
    await expectMarkdownEquals(page, 'first')
  })

  test('2.11 删除 block 后，block id 顺序稳定且无泄漏', async ({ page }) => {
    await resetEditor(page, 'a\nb\nc')
    const idsBefore = await page.evaluate(
      () => Array.from(window.__markit.editor.doc.getBlocks().keys()) as string[]
    )
    const middleId = idsBefore[1]
    await placeCaret(page, middleId, 0)
    await page.keyboard.press('Backspace') // 合并到上一行
    const idsAfter = await page.evaluate(
      () => Array.from(window.__markit.editor.doc.getBlocks().keys()) as string[]
    )
    expect(idsAfter).not.toContain(middleId)
    expect(idsAfter.length).toBe(idsBefore.length - 1)
  })
})
