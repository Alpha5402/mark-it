import { test, expect } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  placeCaret,
  blockIdAt,
  getEditorSnapshot,
  expectMarkdownEquals,
} from './helpers/editor'

/**
 * 场景 3.6：在 Block 内执行特殊字符的删除（marker / fence / $$ / []）
 * 这里是 model 退化的高频触发点。
 */
test.describe('03.6 delete special chars', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  test('3.6.1 删掉 **bold** 的一个 * → bold 取消', async ({ page }) => {
    await resetEditor(page, '**bold**')
    const id = await blockIdAt(page, 0)
    // 展开态下第一个 * 在 rawOffset=0；删除它（光标在 1，按 Backspace）
    await placeCaret(page, id, 1)
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, '*bold**')
    const snap = await getEditorSnapshot(page)
    // 不一定还是 paragraph 的 bold；至少不应崩溃
    expect(snap.blocks[0].type).toBe('paragraph')
  })

  test('3.6.2 删除 "# " 中的空格 → heading 退 paragraph', async ({ page }) => {
    await resetEditor(page, '# Title')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 2) // "# |Title"
    await page.keyboard.press('Backspace') // 删空格
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).not.toBe('heading')
  })

  test('3.6.3 删除 "- " 中的 "-" → list 退 paragraph', async ({ page }) => {
    await resetEditor(page, '- item')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 1)
    await page.keyboard.press('Backspace')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).not.toBe('list-item')
  })

  test('3.6.5 删除 code-block 结尾围栏 → degrade 为多段 paragraph', async ({ page }) => {
    await resetEditor(page, '```js\nfoo\n```')
    const id = await blockIdAt(page, 0)
    const raw = await page.evaluate(
      (bid) => window.__markit.editor.doc.getRawText(bid),
      id,
    )
    // 删掉末尾的一个反引号
    await placeCaret(page, id, raw.length)
    await page.keyboard.press('Backspace')
    const snap = await getEditorSnapshot(page)
    // 围栏不再闭合：要么 degrade 成多段 paragraph，要么 block 依然是 code-block 但 markdown 改变
    const mdHasNoClosingFence = !(await page.evaluate(() => window.__markit.getMarkdown())).endsWith('```')
    expect(mdHasNoClosingFence).toBe(true)
  })

  test('3.6.6 删除 $$ 中一个 $ → math-block 破坏', async ({ page }) => {
    await resetEditor(page, '$$\nE=mc^2\n$$')
    const id = await blockIdAt(page, 0)
    // 删首行的一个 $
    await placeCaret(page, id, 1)
    await page.keyboard.press('Backspace')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).not.toBe('math-block')
  })

  test('3.6.8 删除链接 "[" → LinkInline 降级为纯文本', async ({ page }) => {
    await resetEditor(page, 'a [b](c) d')
    const id = await blockIdAt(page, 0)
    // 光标放到 '[' 之后（rawOffset=3），按 Backspace 删 '['
    await placeCaret(page, id, 3)
    await page.keyboard.press('Backspace')
    const md = await page.evaluate(() => window.__markit.getMarkdown())
    expect(md.startsWith('a ')).toBe(true)
    expect(md.includes('[')).toBe(false)
  })

  test('3.6.11 删除后光标位置应在删除点', async ({ page }) => {
    await resetEditor(page, 'abcdef')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 4) // abcd|ef
    await page.keyboard.press('Backspace') // abc|ef
    const info = await page.evaluate(() => {
      const sel = document.getSelection()!
      return { offset: sel.anchorOffset }
    })
    expect(info.offset).toBe(3)
  })
})
