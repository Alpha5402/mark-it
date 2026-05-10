import { test, expect, Page } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  placeCaret,
  blockIdAt,
  blockLocator,
  setSelection,
  simulatePaste,
  expectExpanded,
  expectMarkdownEquals,
  getEditorSnapshot,
} from './helpers/editor'

/**
 * 场景 3.10：公式块 / 行内公式交互回归。
 *
 * 这些用例刻意从“DOM 展开态看到的文本应等价于 markdown 原文”出发，
 * 覆盖 $$ 块级公式、$ 行内公式、marker 删除/补回、多行编辑、粘贴和选区替换。
 */
test.describe('03.10 math block interactions', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  async function rawText(page: Page, blockId: string): Promise<string> {
    return await page.evaluate(
      (id) => window.__markit.editor.doc.getRawText(id),
      blockId,
    )
  }

  async function expectBlockTypes(page: Page, expected: string[]) {
    const snap = await getEditorSnapshot(page)
    expect(snap.blocks.map(b => b.type)).toEqual(expected)
  }

  async function expectSingleMathBlock(page: Page, expectedMarkdown: string) {
    await expectMarkdownEquals(page, expectedMarkdown)
    const snap = await getEditorSnapshot(page)
    expect(snap.blockCount).toBe(1)
    expect(snap.blocks[0].type).toBe('math-block')
    expect(snap.blocks[0].raw).toBe(expectedMarkdown)
  }

  test('3.10.1 初始文档中的 $$...$$ 独占行应稳定解析为单个 math-block', async ({ page }) => {
    const md = '$$\nE=mc^2\n$$'
    await resetEditor(page, md)
    await expectSingleMathBlock(page, md)
    await expect(page.locator('.md-renderer-area .md-math-display')).toHaveCount(1)
  })

  test('3.10.2 文档中段落夹着 $$...$$ 时只合并公式块，不吞前后段落', async ({ page }) => {
    const md = 'before\n$$\na+b=c\n$$\nafter'
    await resetEditor(page, md)
    await expectMarkdownEquals(page, md)
    await expectBlockTypes(page, ['paragraph', 'math-block', 'paragraph'])
    const mathId = await blockIdAt(page, 1)
    expect(await rawText(page, mathId)).toBe('$$\na+b=c\n$$')
  })

  test('3.10.3 空公式块 $$\\n$$ 也应保持 math-block，不退化或丢失 marker', async ({ page }) => {
    const md = '$$\n$$'
    await resetEditor(page, md)
    await expectSingleMathBlock(page, md)
  })

  test('3.10.4 未闭合或非独占的 $$ 不应误解析为 math-block', async ({ page }) => {
    await resetEditor(page, '$$\naa')
    let snap = await getEditorSnapshot(page)
    expect(snap.blocks.map(b => b.type)).toEqual(['paragraph', 'paragraph'])
    await expectMarkdownEquals(page, '$$\naa')

    await resetEditor(page, '$$aa$$')
    snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('paragraph')
    await expectMarkdownEquals(page, '$$aa$$')
  })

  test('3.10.5 点击展开 math-block 后 DOM 文本应等于完整 markdown 原文', async ({ page }) => {
    const md = '$$\naa\nbb\n$$'
    await resetEditor(page, md)
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 3)
    await expectExpanded(page, id)
    await expect(blockLocator(page, id)).toHaveClass(/md-block-expanded/)
    expect(await blockLocator(page, id).textContent()).toBe(md)
    expect(await rawText(page, id)).toBe(md)
  })

  test('3.10.6 math-block 收起后不应泄漏原始 $$ marker，再展开才显示原文', async ({ page }) => {
    const md = '$$\nx^2\n$$\nplain'
    await resetEditor(page, md)
    const mathId = await blockIdAt(page, 0)
    const plainId = await blockIdAt(page, 1)

    expect(await blockLocator(page, mathId).locator('.md-math-display').count()).toBe(1)
    expect(await blockLocator(page, mathId).textContent()).not.toContain('$$')

    await placeCaret(page, mathId, 3)
    expect(await blockLocator(page, mathId).textContent()).toBe('$$\nx^2\n$$')

    await placeCaret(page, plainId, 0)
    await expectExpanded(page, plainId)
    expect(await blockLocator(page, mathId).locator('.md-math-display').count()).toBe(1)
    expect(await blockLocator(page, mathId).textContent()).not.toContain('$$')
  })

  test('3.10.7 行内 $x$ 收起态不显示 markdown marker，展开态显示完整 $x$', async ({ page }) => {
    await resetEditor(page, 'before $x+1$ after\nnext')
    const inlineId = await blockIdAt(page, 0)
    const nextId = await blockIdAt(page, 1)

    const collapsedMath = blockLocator(page, inlineId).locator('.md-math-inline')
    await expect(collapsedMath).toHaveCount(1)
    await expect(collapsedMath.locator('.md-marker')).toHaveCount(0)
    expect(await blockLocator(page, inlineId).textContent()).not.toContain('$')

    await placeCaret(page, inlineId, 'before '.length)
    await expect(blockLocator(page, inlineId).locator('.md-math-inline .md-marker')).toHaveCount(2)
    expect(await blockLocator(page, inlineId).textContent()).toContain('$x+1$')

    await placeCaret(page, nextId, 0)
    await expect(blockLocator(page, inlineId).locator('.md-math-inline .md-marker')).toHaveCount(0)
    expect(await blockLocator(page, inlineId).textContent()).not.toContain('$')
  })

  test('3.10.8 从空段落键入 $$ 应自动补全为空 math-block 并把光标放在内容行', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.type('$$')
    await expectSingleMathBlock(page, '$$\n\n$$')
    const mathId = await blockIdAt(page, 0)
    await page.keyboard.type('E=mc^2')
    await expectSingleMathBlock(page, '$$\nE=mc^2\n$$')
    await expectExpanded(page, mathId)
  })

  test('3.10.9 从空段落键入 $x$ 应保持行内公式原文，不生成 math-block', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.type('$')
    await page.keyboard.type('x')
    await page.keyboard.type('$')
    await expectMarkdownEquals(page, '$x$')
    await expectBlockTypes(page, ['paragraph'])
  })

  test('3.10.10 在 math-block 内容中回车只插入公式内容换行，不拆分 block', async ({ page }) => {
    const md = '$$\naa\n$$'
    await resetEditor(page, md)
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, '$$\naa'.length)
    await page.keyboard.press('Enter')
    await expectSingleMathBlock(page, '$$\naa\n\n$$')
  })

  test('3.10.11 在 math-block 内容中粘贴多行只更新 tex，不拆出额外 block', async ({ page }) => {
    await resetEditor(page, '$$\naa\n$$')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, '$$\n'.length)
    await simulatePaste(page, 'x\ny')
    await expectSingleMathBlock(page, '$$\nx\nyaa\n$$')
  })

  test('3.10.12 删除结尾 $$ 后应退化为普通多行，再补回 $$ 应恢复为单个 math-block', async ({ page }) => {
    await resetEditor(page, '$$\naa\n$$')
    const id = await blockIdAt(page, 0)
    const raw = await rawText(page, id)

    await placeCaret(page, id, raw.length)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, '$$\naa\n')
    await expectBlockTypes(page, ['paragraph', 'paragraph', 'blank'])

    const lastId = await blockIdAt(page, 2)
    await placeCaret(page, lastId, 0)
    await page.keyboard.type('$$')
    await expectSingleMathBlock(page, '$$\naa\n$$')
  })

  test('3.10.13 删除开头 $$ 后应退化，重新补回开头 $$ 应恢复为单个 math-block', async ({ page }) => {
    await resetEditor(page, '$$\naa\n$$')
    const id = await blockIdAt(page, 0)

    await placeCaret(page, id, 2)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, '\naa\n$$')
    await expectBlockTypes(page, ['blank', 'paragraph', 'paragraph'])

    const firstId = await blockIdAt(page, 0)
    await placeCaret(page, firstId, 0)
    await page.keyboard.type('$$')
    await expectSingleMathBlock(page, '$$\naa\n$$')
  })

  test('3.10.14 选中 math-block 内容替换时应保留外层 $$ marker', async ({ page }) => {
    await resetEditor(page, '$$\naa\nbb\n$$')
    const id = await blockIdAt(page, 0)
    await setSelection(
      page,
      { blockId: id, offset: '$$\n'.length },
      { blockId: id, offset: '$$\naa\nbb'.length },
    )
    await page.keyboard.type('cc')
    await expectSingleMathBlock(page, '$$\ncc\n$$')
  })

  test('3.10.15 选中整个 math-block 粘贴段落文本时应完全退化为 paragraph', async ({ page }) => {
    await resetEditor(page, '$$\naa\n$$')
    const id = await blockIdAt(page, 0)
    await setSelection(
      page,
      { blockId: id, offset: 0 },
      { blockId: id, offset: '$$\naa\n$$'.length },
    )
    await simulatePaste(page, 'plain')
    await expectMarkdownEquals(page, 'plain')
    await expectBlockTypes(page, ['paragraph'])
  })

  test('3.10.16 粘贴包含完整 $$...$$ 的多行文本应按 markdown 结构重建 math-block', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await simulatePaste(page, 'alpha\n$$\na+b\nc+d\n$$\nomega')
    await expectMarkdownEquals(page, 'alpha\n$$\na+b\nc+d\n$$\nomega')
    await expectBlockTypes(page, ['paragraph', 'math-block', 'paragraph'])
  })
})
