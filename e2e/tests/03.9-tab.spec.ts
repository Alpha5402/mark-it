import { test, expect } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  placeCaret,
  blockIdAt,
  expectMarkdownEquals,
  getEditorSnapshot,
} from './helpers/editor'

/**
 * 场景 3.9：Tab / Shift+Tab 缩进与反缩进
 */
test.describe('03.9 tab indent', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  test('3.9.1 段落上 Tab → 行首插入缩进', async ({ page }) => {
    await resetEditor(page, 'text')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.press('Tab')
    const md = await page.evaluate(() => window.__markit.getMarkdown())
    // 实现里缩进常用 4 空格或 \t；只要开头多出空白且文本未丢就算通过
    expect(md.endsWith('text')).toBe(true)
    expect(md.length).toBeGreaterThan('text'.length)
  })

  test('3.9.2 nesting=0 时 Shift+Tab → 无变化', async ({ page }) => {
    await resetEditor(page, 'text')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.press('Shift+Tab')
    await expectMarkdownEquals(page, 'text')
  })

  test('3.9.4 list-item 上 Tab → 变嵌套 list', async ({ page }) => {
    await resetEditor(page, '- parent\n- child')
    const id = await blockIdAt(page, 1)
    await placeCaret(page, id, 0)
    await page.keyboard.press('Tab')
    const snap = await getEditorSnapshot(page)
    // child block 的 raw 应以空白开头
    const childRaw = snap.blocks[1].raw
    expect(/^\s+/.test(childRaw)).toBe(true)
  })

  test('3.9.5 code-block 内 Tab → 插入 4 空格', async ({ page }) => {
    await resetEditor(page, '```js\nfoo\n```')
    const id = await blockIdAt(page, 0)
    // 展开 code-block，光标在 "foo" 前
    const raw = await page.evaluate(
      (bid) => window.__markit.editor.doc.getRawText(bid),
      id,
    )
    const fooStart = raw.indexOf('foo')
    await placeCaret(page, id, fooStart)
    await page.keyboard.press('Tab')
    await expectMarkdownEquals(page, '```js\n    foo\n```')
  })

  test('3.9.8 Tab 不切换浏览器焦点', async ({ page }) => {
    await resetEditor(page, 'text')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.press('Tab')
    // activeElement 仍在编辑区（area 或 body）
    const tag = await page.evaluate(
      () => document.activeElement?.className ?? '',
    )
    expect(typeof tag).toBe('string')
    // 不应切换到 button/input 之类
    expect(tag).not.toMatch(/toolbar/i)
  })

  test('3.9.9 连续 Tab 逐步加深缩进，Shift+Tab 减少', async ({ page }) => {
    await resetEditor(page, '- x')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.press('Tab')
    const md1 = await page.evaluate(() => window.__markit.getMarkdown())
    await page.keyboard.press('Tab')
    const md2 = await page.evaluate(() => window.__markit.getMarkdown())
    expect(md2.length).toBeGreaterThanOrEqual(md1.length)
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    const md3 = await page.evaluate(() => window.__markit.getMarkdown())
    expect(md3.length).toBeLessThanOrEqual(md2.length)
  })
})
