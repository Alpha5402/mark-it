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
} from './helpers/editor'

/**
 * 场景 3.3：在 Block 内部通过粘贴新增大串字符（不拆分 block）
 */
test.describe('03.3 paste single-line', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  test('3.3.1 单行长字符串粘贴合并到当前 block', async ({ page }) => {
    await resetEditor(page, 'pre')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 'pre'.length)
    const long = 'X'.repeat(500)
    await simulatePaste(page, long)
    await expectMarkdownEquals(page, 'pre' + long)
    await expectBlockCount(page, 1)
  })

  test('3.3.2 粘贴 10k 字符不崩溃', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    const big = 'a'.repeat(10_000)
    await simulatePaste(page, big)
    const md = await page.evaluate(() => window.__markit.getMarkdown())
    expect(md.length).toBe(10_000)
  })

  test('3.3.3 粘贴含 ** 的文本 → 解析为 bold marker', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await simulatePaste(page, 'a **bold** b')
    await expectMarkdownEquals(page, 'a **bold** b')
  })

  test('3.3.4 在 code-block 内粘贴多行 → 不拆分 block', async ({ page }) => {
    await resetEditor(page, '```js\nfoo\n```')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 6) // 定位到代码开头
    await simulatePaste(page, 'bar\nbaz')
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('code-block')
    expect(snap.blockCount).toBe(1)
  })
})
