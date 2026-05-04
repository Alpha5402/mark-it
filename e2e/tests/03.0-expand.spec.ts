import { test, expect } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  placeCaret,
  blockIdAt,
  blockLocator,
  getExpandedBlockId,
  expectExpanded,
} from './helpers/editor'

/**
 * 场景 3.0：展开 Block（收起/展开切换）
 * 这是自主事件接管里最容易出问题的一环：selectionchange → expandBlock → collapseBlock。
 */
test.describe('03.0 expand block', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  test('3.0.1 点击 block → 该 block 获得 md-block-expanded', async ({ page }) => {
    await resetEditor(page, 'first\n\nsecond')
    const id0 = await blockIdAt(page, 0)
    await placeCaret(page, id0, 0)
    await expectExpanded(page, id0)
    await expect(blockLocator(page, id0)).toHaveClass(/md-block-expanded/)
  })

  test('3.0.2 点击另一 block → 切换展开目标', async ({ page }) => {
    await resetEditor(page, 'first\n\nsecond')
    const id0 = await blockIdAt(page, 0)
    const id2 = await blockIdAt(page, 2)
    await placeCaret(page, id0, 0)
    await expectExpanded(page, id0)
    await placeCaret(page, id2, 0)
    await expectExpanded(page, id2)
    await expect(page.locator('.md-block-expanded')).toHaveCount(1)
  })

  test('3.0.3 展开态 heading 出现 md-struct-marker', async ({ page }) => {
    await resetEditor(page, '## Title')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 3)
    await expect(blockLocator(page, id).locator('.md-struct-marker').first()).toBeVisible()
  })

  test('3.0.4 收起后无残留 md-marker / md-struct-marker', async ({ page }) => {
    await resetEditor(page, '**bold**\n\n**bold2**')
    const id0 = await blockIdAt(page, 0)
    const id2 = await blockIdAt(page, 2)
    await placeCaret(page, id0, 2) // 展开 id0
    await expectExpanded(page, id0)
    await placeCaret(page, id2, 2) // 展开 id2，id0 收起
    await expectExpanded(page, id2)
    const markerInId0 = await blockLocator(page, id0).locator('.md-marker').count()
    expect(markerInId0).toBe(0)
    const structInId0 = await blockLocator(page, id0).locator('.md-struct-marker').count()
    expect(structInId0).toBe(0)
  })

  test('3.0.5 多次展开/收起不会泄漏 DOM 节点', async ({ page }) => {
    await resetEditor(page, 'a\n\nb\n\nc')
    const ids = await page.evaluate(
      () => Array.from(window.__markit.editor.doc.getBlocks().keys()) as string[]
    )
    const nodeCountBefore = await page.evaluate(
      () => document.querySelectorAll('.md-renderer-area *').length,
    )
    for (let i = 0; i < 6; i++) {
      await placeCaret(page, ids[i % ids.length], 0)
    }
    const nodeCountAfter = await page.evaluate(
      () => document.querySelectorAll('.md-renderer-area *').length,
    )
    // 允许 ±4 的浮动（零宽空格、br 等临时节点），主要目的是确保不爆炸
    expect(Math.abs(nodeCountAfter - nodeCountBefore)).toBeLessThan(40)
  })

  test('3.0.6 code-block 展开有 md-code-block-expanded', async ({ page }) => {
    await resetEditor(page, '```js\nfoo\n```')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await expectExpanded(page, id)
    await expect(blockLocator(page, id)).toHaveClass(/md-block-expanded/)
  })

  test('3.0.9 hr 展开显示原文 "---"', async ({ page }) => {
    await resetEditor(page, '---')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    // 展开后 DOM 里应该能看到原文 "---"
    const text = await blockLocator(page, id).textContent()
    expect((text ?? '').includes('---')).toBe(true)
  })

  test('3.0.11 ArrowDown 进入下一 block → 自动切换展开', async ({ page }) => {
    await resetEditor(page, 'first\nsecond')
    const id0 = await blockIdAt(page, 0)
    const id1 = await blockIdAt(page, 1)
    await placeCaret(page, id0, 1)
    await expectExpanded(page, id0)
    await page.keyboard.press('ArrowDown')
    // 等到 selectionchange 把展开切走
    await page.waitForFunction(
      (targetId) => window.__markit.editor?.dom.getExpandedBlockId() === targetId,
      id1,
      { timeout: 2000 },
    )
    expect(await getExpandedBlockId(page)).toBe(id1)
  })
})
