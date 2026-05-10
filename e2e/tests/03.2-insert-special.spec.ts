import { test, expect } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  placeCaret,
  blockIdAt,
  getMarkdown,
  getEditorSnapshot,
  simulatePaste,
  expectMarkdownEquals,
  expectMarkdownContains,
} from './helpers/editor'

/**
 * 场景 3.2：在 Block 内部新增特殊字符（auto-pair / marker）
 */
test.describe('03.2 insert special chars', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  test('3.2.1 单键入 "*" → auto-pair 成 "**"（光标在中间）', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.type('*')
    await expectMarkdownEquals(page, '**')
  })

  test('3.2.1b 单键入 "`" → auto-pair 成 "``"（光标在中间）', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.type('`')
    await expectMarkdownEquals(page, '``')
  })

  test('3.2.4 键入 **text** → 保留为粗体源文本', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await simulatePaste(page, '**text**')
    await expectMarkdownContains(page, '**text**')
  })

  test('3.2.6 键入 ~~del~~ 与 ==hl== → 删除线 / 高亮', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.type('~~del~~')
    await expectMarkdownContains(page, '~~del~~')

    await resetEditor(page, '')
    const id2 = await blockIdAt(page, 0)
    await placeCaret(page, id2, 0)
    await page.keyboard.type('==hl==')
    await expectMarkdownContains(page, '==hl==')
  })

  test('3.2.7 键入 "$x$" → MathInline 源文本完整保留', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.type('$')
    await page.keyboard.type('x')
    await page.keyboard.type('$')
    await expectMarkdownEquals(page, '$x$')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('paragraph')
  })

  test('3.2.8 段首键入两个 "`"+ "`" → 触发 code-block 围栏', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.type('```')
    await page.keyboard.press('Enter')
    const snap2 = await getEditorSnapshot(page)
    expect(snap2.blocks[0].type).toBe('code-block')
    await expectMarkdownEquals(page, '```\n\n```')
  })

  test('3.2.9 在 code-block 内键入 "*" 不 auto-pair', async ({ page }) => {
    await resetEditor(page, '```js\nfoo\n```')
    const id = await blockIdAt(page, 0)
    // 定位到 code 内容区。rawOffset=6 大概是 "```js\n" 之后的第一个字符前
    await placeCaret(page, id, 6)
    await page.keyboard.type('*')
    const md = await getMarkdown(page)
    // 在代码内不应出现 "**"（auto-pair 抑制）
    expect(md.match(/\*\*/g) ?? []).toHaveLength(0)
  })

  test('3.2.10 键入 "[" 不 auto-pair', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.type('[')
    const md = await getMarkdown(page)
    expect(md).toBe('[')
  })
})
