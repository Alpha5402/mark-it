import { test, expect, Page } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  placeCaret,
  blockIdAt,
  blockLocator,
  setSelection,
  expectExpanded,
  expectMarkdownEquals,
  getEditorSnapshot,
} from './helpers/editor'

/**
 * 场景 3.13：富行内 markdown 结构回归。
 *
 * 这里覆盖真实写作里最常见的 inline 结构：格式标记、链接、图片、脚注引用。
 * 重点仍是展开态 DOM 文本等价于 markdown 原文，收起态不泄漏 marker。
 */
test.describe('03.13 rich inline markdown interactions', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  async function rawText(page: Page, blockId: string): Promise<string> {
    return await page.evaluate(
      (id) => window.__markit.editor.doc.getRawText(id),
      blockId,
    )
  }

  test('3.13.1 常见格式 inline 在收起态隐藏 marker，展开态显示完整原文', async ({ page }) => {
    const md = 'a **bold** *em* `code` ~~del~~ ==mark=='
    await resetEditor(page, md)
    const id = await blockIdAt(page, 0)

    await expectMarkdownEquals(page, md)
    await expect(blockLocator(page, id).locator('.md-marker')).toHaveCount(0)
    await expect(blockLocator(page, id).locator('.md-bold')).toHaveCount(1)
    await expect(blockLocator(page, id).locator('.md-italic')).toHaveCount(1)
    await expect(blockLocator(page, id).locator('.md-code')).toHaveCount(1)
    await expect(blockLocator(page, id).locator('.md-strike')).toHaveCount(1)
    await expect(blockLocator(page, id).locator('.md-highlight')).toHaveCount(1)

    await placeCaret(page, id, 0)
    await expectExpanded(page, id)
    expect(await blockLocator(page, id).textContent()).toBe(md)
    expect(await rawText(page, id)).toBe(md)
  })

  test('3.13.2 链接收起态显示可点击文本，展开态显示 [text](href) 原文', async ({ page }) => {
    const md = 'open [docs](https://example.com/docs) now'
    await resetEditor(page, md)
    const id = await blockIdAt(page, 0)

    const link = blockLocator(page, id).locator('a.md-link')
    await expect(link).toHaveText('docs')
    await expect(blockLocator(page, id).locator('.md-marker')).toHaveCount(0)

    await placeCaret(page, id, 'open '.length)
    expect(await blockLocator(page, id).textContent()).toBe(md)
    await expect(blockLocator(page, id).locator('.md-marker')).toHaveCount(3)
  })

  test('3.13.3 展开态编辑链接 href 应只更新链接原文，不丢失前后文本', async ({ page }) => {
    const md = 'open [docs](https://a.test) now'
    await resetEditor(page, md)
    const id = await blockIdAt(page, 0)
    const start = md.indexOf('https://a.test')
    const end = start + 'https://a.test'.length

    await setSelection(
      page,
      { blockId: id, offset: start },
      { blockId: id, offset: end },
    )
    await page.keyboard.type('https://b.test')
    await expectMarkdownEquals(page, 'open [docs](https://b.test) now')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('paragraph')
  })

  test('3.13.4 删除链接 "[" 后应降级为纯文本，再补回应恢复链接结构', async ({ page }) => {
    await resetEditor(page, 'a [b](c) d')
    const id = await blockIdAt(page, 0)

    await placeCaret(page, id, 'a ['.length)
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, 'a b](c) d')
    await expect(blockLocator(page, id).locator('a.md-link')).toHaveCount(0)

    await placeCaret(page, id, 'a '.length)
    await page.keyboard.type('[')
    await expectMarkdownEquals(page, 'a [b](c) d')
    await expect(blockLocator(page, id).locator('a.md-link')).toHaveCount(1)
  })

  test('3.13.5 图片收起态渲染 img，展开态显示 ![alt](src) 原文', async ({ page }) => {
    const md = 'logo ![alt text](https://example.com/logo.png) end'
    await resetEditor(page, md)
    const id = await blockIdAt(page, 0)

    const img = blockLocator(page, id).locator('img.md-image')
    await expect(img).toHaveAttribute('alt', 'alt text')
    await expect(blockLocator(page, id).locator('.md-marker')).toHaveCount(0)

    await placeCaret(page, id, 'logo '.length)
    expect(await blockLocator(page, id).textContent()).toBe(md)
  })

  test('3.13.6 脚注引用和脚注定义应 round-trip，展开态显示原始 marker', async ({ page }) => {
    const md = 'See [^note]\n\n[^note]: footnote text'
    await resetEditor(page, md)
    await expectMarkdownEquals(page, md)

    const refId = await blockIdAt(page, 0)
    const defId = await blockIdAt(page, 2)
    await expect(blockLocator(page, refId).locator('.md-footnote-ref')).toHaveCount(1)
    await expect(blockLocator(page, defId).locator('.md-footnote-marker')).toHaveText('note')

    await placeCaret(page, refId, 'See '.length)
    expect(await blockLocator(page, refId).textContent()).toBe('See [^note]')

    await placeCaret(page, defId, '[^note]: '.length)
    expect(await blockLocator(page, defId).textContent()).toBe('[^note]: footnote text')
  })
})
