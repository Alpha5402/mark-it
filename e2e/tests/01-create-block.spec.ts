import { test, expect } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  getEditorSnapshot,
  editorArea,
  placeCaret,
  blockIdAt,
  expectBlockCount,
  expectMarkdownEquals,
  expectMarkdownContains,
  simulatePaste,
} from './helpers/editor'

/**
 * 场景 1：新建 Block（所有类型）
 * 每种块类型都从 "空段落键入前缀" / "粘贴" / "回车拆分" 三个路径触发。
 */
test.describe('01 create block', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
    // 每个用例从单个空 paragraph 开始，便于聚焦
    await resetEditor(page, '')
  })

  async function focusFirstBlock(page) {
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    return id
  }

  test('1.1 键入 "# " → heading-1', async ({ page }) => {
    await focusFirstBlock(page)
    await page.keyboard.type('# ')
    await expectMarkdownEquals(page, '# ')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('heading')
    // 注意：document title 也使用 md-heading-1 class，需将查询限定在 .md-renderer-area 内
    await expect(page.locator('.md-renderer-area .md-heading-1')).toHaveCount(1)
    await expect(page.locator('.md-renderer-area .md-struct-marker').first()).toBeVisible()
  })

  test('1.2 依次键入 # ## ### #### ##### ###### 生成对应 heading', async ({ page }) => {
    for (let level = 1; level <= 6; level++) {
      await resetEditor(page, '')
      await focusFirstBlock(page)
      const prefix = '#'.repeat(level) + ' '
      await page.keyboard.type(prefix + 'T')
      await expectMarkdownEquals(page, prefix + 'T')
      const snap = await getEditorSnapshot(page)
      expect(snap.blocks[0].type).toBe('heading')
      await expect(page.locator(`.md-renderer-area .md-heading-${level}`)).toHaveCount(1)
    }
  })

  test('1.3 键入 "- " → 无序 list-item', async ({ page }) => {
    await focusFirstBlock(page)
    await page.keyboard.type('- item1')
    await expectMarkdownEquals(page, '- item1')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('list-item')
    await expect(page.locator('.md-list-item')).toHaveCount(1)
  })

  test('1.4 键入 "1. " / "3. " → 有序 list-item', async ({ page }) => {
    await focusFirstBlock(page)
    await page.keyboard.type('1. first')
    await expectMarkdownEquals(page, '1. first')
    let snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('list-item')

    await resetEditor(page, '')
    await focusFirstBlock(page)
    await page.keyboard.type('3. third')
    await expectMarkdownEquals(page, '3. third')
    snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('list-item')
  })

  test('1.5 键入 "- [ ] " / "- [x] " → task list', async ({ page }) => {
    await focusFirstBlock(page)
    await page.keyboard.type('- [ ] todo')
    await expectMarkdownEquals(page, '- [ ] todo')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('list-item')
    expect((snap.blocks[0] as any).raw).toBe('- [ ] todo')

    await resetEditor(page, '')
    await focusFirstBlock(page)
    await page.keyboard.type('- [x] done')
    await expectMarkdownEquals(page, '- [x] done')
    const snap2 = await getEditorSnapshot(page)
    expect(snap2.blocks[0].type).toBe('list-item')
    expect((snap2.blocks[0] as any).raw).toBe('- [x] done')
  })

  test('1.6 键入 "> " → blockquote', async ({ page }) => {
    await focusFirstBlock(page)
    await page.keyboard.type('> quoted')
    const md = await page.evaluate(() => window.__markit.getMarkdown())
    // 展开态下的 blockquote 可能尾随一个空格/零宽空格，trim 后对齐
    expect(md.trimEnd()).toBe('> quoted')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('blockquote')
  })

  test('1.7 键入 "---" + Enter → hr', async ({ page }) => {
    await focusFirstBlock(page)
    await page.keyboard.type('---')
    await page.keyboard.press('Enter')
    await expectMarkdownContains(page, '---')
    // 回车后应形成 hr block + 新空段落
    await expectBlockCount(page, 2)
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('hr')
  })

  test('1.8 键入 "```js" + Enter → code-block 自动补闭合围栏', async ({ page }) => {
    await focusFirstBlock(page)
    await page.keyboard.type('```js')
    await page.keyboard.press('Enter')
    // tryCompleteCodeBlockFromOpeningFence 会插入 "\n```" 并把光标落在中间
    await expectMarkdownContains(page, '```js')
    await expectMarkdownContains(page, '```')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('code-block')
  })

  test('1.9 键入 "$$" → auto-pair 成 $$$$；再 Enter → math-block', async ({ page }) => {
    await focusFirstBlock(page)
    await page.keyboard.type('$$')
    await expectMarkdownEquals(page, '$$\n\n$$')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('math-block')
  })

  test('1.10 键入表头 + 分隔行 + 数据行 → table', async ({ page }) => {
    await focusFirstBlock(page)
    await page.keyboard.type('| a | b |')
    await page.keyboard.press('Enter')
    await page.keyboard.type('| --- | --- |')
    await page.keyboard.press('Enter')
    // 部分实现下需要至少一行数据才能稳定识别为 table
    await page.keyboard.type('| 1 | 2 |')
    await page.keyboard.press('Enter')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('table')
    await expectMarkdownEquals(page, '| a | b |\n| --- | --- |\n| 1 | 2 |\n')
  })

  test('1.11 空段落上按 Enter → 新建 blank', async ({ page }) => {
    await focusFirstBlock(page)
    await page.keyboard.press('Enter')
    await expectBlockCount(page, 2)
    const snap = await getEditorSnapshot(page)
    expect(['blank', 'paragraph']).toContain(snap.blocks[0].type)
    expect(['blank', 'paragraph']).toContain(snap.blocks[1].type)
  })

  test('1.12 段落末尾 Enter → 新 paragraph，block 数+1', async ({ page }) => {
    await resetEditor(page, 'hello')
    const id = await blockIdAt(page, 0)
    // 光标放在行尾
    await placeCaret(page, id, 'hello'.length)
    await page.keyboard.press('Enter')
    await expectBlockCount(page, 2)
    await expectMarkdownEquals(page, 'hello\n')
  })

  test('1.13 粘贴多行纯文本 → 一次创建多个 block', async ({ page }) => {
    await focusFirstBlock(page)
    await simulatePaste(page, 'line1\nline2\nline3')
    await expectBlockCount(page, 3)
    await expectMarkdownEquals(page, 'line1\nline2\nline3')
  })

  test('1.14 切换 block 时，.md-block-expanded 只存在于当前 block', async ({ page }) => {
    await resetEditor(page, 'first\n\nsecond')
    const id0 = await blockIdAt(page, 0)
    const id2 = await blockIdAt(page, 2)
    await placeCaret(page, id0, 1)
    await expect(page.locator('.md-block-expanded')).toHaveCount(1)
    await placeCaret(page, id2, 1)
    await expect(page.locator('.md-block-expanded')).toHaveCount(1)
    const expandedId = await page.evaluate(
      () => document.querySelector('.md-block-expanded')?.getAttribute('data-block-id') ?? null
    )
    expect(expandedId).toBe(id2)
  })
})
