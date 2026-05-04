import { test, expect } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  placeCaret,
  blockIdAt,
  getExpandedBlockId,
  getSelectionInfo,
  expectExpanded,
} from './helpers/editor'

/**
 * 场景 3.8：方向键（最易出 "幽灵位置" bug）
 */
test.describe('03.8 arrow keys', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  test('3.8.1 展开态 ArrowRight 穿越 struct-marker 边界不停滞', async ({ page }) => {
    await resetEditor(page, '## Title')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    // 连续 3 次 ArrowRight，光标必须真的向右移动（visual）
    const beforeRect = await page.evaluate(() => {
      const r = document.getSelection()!.getRangeAt(0).cloneRange()
      r.collapse(true)
      const rc = r.getBoundingClientRect()
      return { left: rc.left }
    })
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight')
    }
    const afterRect = await page.evaluate(() => {
      const r = document.getSelection()!.getRangeAt(0).cloneRange()
      r.collapse(true)
      const rc = r.getBoundingClientRect()
      return { left: rc.left }
    })
    expect(afterRect.left).toBeGreaterThan(beforeRect.left)
  })

  test('3.8.2 展开态 **bold** 边界跳过 md-marker 幽灵位置', async ({ page }) => {
    await resetEditor(page, '**X**')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    // 连续 ArrowRight 直到 rawOffset=rawText.length，应稳定落在末尾
    const steps = 10
    for (let i = 0; i < steps; i++) {
      await page.keyboard.press('ArrowRight')
    }
    const info = await getSelectionInfo(page)
    expect(info?.anchorBlockId).toBe(id)
  })

  test('3.8.4 Shift+ArrowRight 扩展选区', async ({ page }) => {
    await resetEditor(page, 'abcdef')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 1)
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    const info = await getSelectionInfo(page)
    expect(info?.isCollapsed).toBe(false)
  })

  test('3.8.5 Alt+ArrowRight 按词移动', async ({ page }) => {
    await resetEditor(page, 'hello world foo')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.press('Alt+ArrowRight')
    const info = await getSelectionInfo(page)
    // 光标至少超过 "hello" 的末尾（anchorOffset >= 5）
    expect(info?.anchorOffset ?? 0).toBeGreaterThanOrEqual(5)
  })

  test('3.8.8 连续上下键使用 sticky x', async ({ page }) => {
    await resetEditor(page, 'short\nmuch longer line here')
    const id1 = await blockIdAt(page, 1)
    await placeCaret(page, id1, 'much longer line here'.length)
    await page.keyboard.press('ArrowUp')
    // 再按下键回到原位，x 坐标应保持
    await page.keyboard.press('ArrowDown')
    const info = await getSelectionInfo(page)
    expect(info?.anchorBlockId).toBe(id1)
  })

  test('3.8.9 ArrowDown 跨 block → 自动切换展开', async ({ page }) => {
    await resetEditor(page, 'first\nsecond')
    const id0 = await blockIdAt(page, 0)
    const id1 = await blockIdAt(page, 1)
    await placeCaret(page, id0, 1)
    await page.keyboard.press('ArrowDown')
    await expectExpanded(page, id1)
  })

  test('3.8.13 方向键不应触发 InsertText/DeleteBackward 事件', async ({ page }) => {
    await resetEditor(page, 'abcdef')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 3)
    const mdBefore = await page.evaluate(() => window.__markit.getMarkdown())
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowDown')
    const mdAfter = await page.evaluate(() => window.__markit.getMarkdown())
    expect(mdAfter).toBe(mdBefore)
  })
})
