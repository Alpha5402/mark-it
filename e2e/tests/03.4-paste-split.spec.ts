import { test, expect } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  placeCaret,
  blockIdAt,
  simulatePaste,
  expectMarkdownEquals,
  expectBlockCount,
  getEditorSnapshot,
  getMarkdown,
} from './helpers/editor'

/**
 * 场景 3.4：通过粘贴/回车等方式让 Block 被拆分或创建新 block
 */
test.describe('03.4 paste & enter split', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  test('3.4.1 段中间粘贴 "a\\nb" → 拆分为 2 block', async ({ page }) => {
    await resetEditor(page, 'hello')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 'hel'.length)
    await simulatePaste(page, 'a\nb')
    await expectMarkdownEquals(page, 'hela\nblo')
    await expectBlockCount(page, 2)
  })

  test('3.4.2 粘贴 "a\\nb\\nc" 三行 → 新增 2 block', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await simulatePaste(page, 'a\nb\nc')
    await expectBlockCount(page, 3)
    await expectMarkdownEquals(page, 'a\nb\nc')
  })

  test('3.4.3 粘贴含 ```js 围栏 → 识别为 code-block', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await simulatePaste(page, 'text\n```js\nfoo\n```\nend')
    await expectMarkdownEquals(page, 'text\n```js\nfoo\n```\nend')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks.map(b => b.type)).toEqual(['paragraph', 'code-block', 'paragraph'])
  })

  test('3.4.4 粘贴含 $$...$$ → 识别为 math-block', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await simulatePaste(page, 'x\n$$\nE=mc^2\n$$\ny')
    await expectMarkdownEquals(page, 'x\n$$\nE=mc^2\n$$\ny')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks.map(b => b.type)).toEqual(['paragraph', 'math-block', 'paragraph'])
  })

  test('3.4.7 在 list-item 尾部回车 → 新增下一条 list', async ({ page }) => {
    await resetEditor(page, '- item1')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, '- item1'.length)
    await page.keyboard.press('Enter')
    const snap = await getEditorSnapshot(page)
    expect(snap.blockCount).toBe(2)
    expect(snap.blocks[1].type).toBe('list-item')
  })

  test('3.4.8 空 list-item 回车 → 退出列表为 blank', async ({ page }) => {
    await resetEditor(page, '- ')
    const id = await blockIdAt(page, 0)
    // 光标放在 "- " 末尾（rawOffset=2）
    await placeCaret(page, id, 2)
    await page.keyboard.press('Enter')
    const snap = await getEditorSnapshot(page)
    // 退出列表后，最后一个 block 不应仍是 list-item
    const last = snap.blocks[snap.blocks.length - 1]
    expect(last.type).not.toBe('list-item')
  })

  test('3.4.9 code-block 内回车 → 不拆分，仅插入 \\n', async ({ page }) => {
    await resetEditor(page, '```js\nfoo\n```')
    const id = await blockIdAt(page, 0)
    // 光标定位到 "foo" 末尾
    const raw = await page.evaluate(
      (bid) => window.__markit.editor.doc.getRawText(bid),
      id,
    )
    const fooEnd = raw.indexOf('foo') + 3
    await placeCaret(page, id, fooEnd)
    await page.keyboard.press('Enter')
    const snap = await getEditorSnapshot(page)
    expect(snap.blockCount).toBe(1)
    expect(snap.blocks[0].type).toBe('code-block')
  })

  test('3.4.12 blank block 上回车 → 直接新增 blank', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.press('Enter')
    await expectBlockCount(page, 2)
  })

  test('3.4.13 paragraph 中间回车 → 拆成两 block，新 block 展开', async ({ page }) => {
    await resetEditor(page, 'hello world')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 'hello'.length)
    await page.keyboard.press('Enter')
    await expectBlockCount(page, 2)
    await expectMarkdownEquals(page, 'hello\n world')
  })
})
