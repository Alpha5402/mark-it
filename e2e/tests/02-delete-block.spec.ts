import { test, expect } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  placeCaret,
  blockIdAt,
  getEditorSnapshot,
  getMarkdown,
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
    // blank 在 index 1 或 2（取决于 parser）；取最后一个
    const snap0 = await getEditorSnapshot(page)
    const lastId = snap0.blocks[snap0.blocks.length - 1].id
    await placeCaret(page, lastId, 0)
    await page.keyboard.press('Backspace')
    const after = await getEditorSnapshot(page)
    expect(after.blockCount).toBeLessThan(snap0.blockCount)
  })

  test('2.3 首个 blank block 上 Backspace 不应崩溃', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.press('Backspace')
    // 仍能获取状态，editor 未死
    const md = await getMarkdown(page)
    expect(typeof md).toBe('string')
  })

  test('2.4 行尾 Delete 不会吞掉当前行最后一个字符', async ({ page }) => {
    await resetEditor(page, 'abc\ndef')
    const id0 = await blockIdAt(page, 0)
    await placeCaret(page, id0, 'abc'.length)
    await page.keyboard.press('Delete')
    const md = await getMarkdown(page)
    // 不应变成 'ab\ndef'，最少要保证 'abc' 被保留
    expect(md.startsWith('abc')).toBe(true)
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

  test('2.6 heading marker 区 Backspace → 降级 paragraph', async ({ page }) => {
    await resetEditor(page, '## Title')
    const id = await blockIdAt(page, 0)
    // 展开态下在 "# " 后面（rawOffset=1，即第一个 # 之后）按 Backspace
    await placeCaret(page, id, 1)
    await page.keyboard.press('Backspace')
    const snap = await getEditorSnapshot(page)
    // 从 h2 要么变 h1，要么变 paragraph
    expect(['heading', 'paragraph']).toContain(snap.blocks[0].type)
  })

  test('2.7 list-item marker 区 Backspace → 退出 list', async ({ page }) => {
    await resetEditor(page, '- item')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 1) // 在 "- " 之间
    await page.keyboard.press('Backspace')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).not.toBe('list-item')
  })

  test('2.8 blockquote marker 区 Backspace → 变 paragraph', async ({ page }) => {
    await resetEditor(page, '> quoted')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 1)
    await page.keyboard.press('Backspace')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).not.toBe('blockquote')
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
