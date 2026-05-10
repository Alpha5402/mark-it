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
 * 场景 3.12：表格块交互回归。
 *
 * 表格和 code/math 一样是多行结构块；展开态应等价于 markdown 原文，
 * 编辑单元格、破坏/恢复分隔行、粘贴完整表格时都应保持 Model 与 DOM 同步。
 */
test.describe('03.12 table block interactions', () => {
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

  async function expectSingleTableBlock(page: Page, expectedMarkdown: string) {
    await expectMarkdownEquals(page, expectedMarkdown)
    const snap = await getEditorSnapshot(page)
    expect(snap.blockCount).toBe(1)
    expect(snap.blocks[0].type).toBe('table')
    expect(snap.blocks[0].raw).toBe(expectedMarkdown)
  }

  test('3.12.1 初始文档中的表格应稳定解析为单个 table block', async ({ page }) => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    await resetEditor(page, md)
    await expectSingleTableBlock(page, md)
    await expect(page.locator('.md-renderer-area .md-table')).toHaveCount(1)
  })

  test('3.12.2 文档中段落夹着表格时只合并表格，不吞前后段落', async ({ page }) => {
    const md = 'before\n| a | b |\n| --- | --- |\n| 1 | 2 |\nafter'
    await resetEditor(page, md)
    await expectMarkdownEquals(page, md)
    await expectBlockTypes(page, ['paragraph', 'table', 'paragraph'])
    const tableId = await blockIdAt(page, 1)
    expect(await rawText(page, tableId)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  test('3.12.3 点击展开 table 后 DOM 文本应等于完整 markdown 原文', async ({ page }) => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    await resetEditor(page, md)
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await expectExpanded(page, id)
    await expect(blockLocator(page, id)).toHaveClass(/md-block-expanded/)
    expect(await blockLocator(page, id).textContent()).toBe(md)
  })

  test('3.12.4 table 收起后不应泄漏 markdown pipe 分隔语法，再展开才显示原文', async ({ page }) => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\nplain'
    await resetEditor(page, md)
    const tableId = await blockIdAt(page, 0)
    const plainId = await blockIdAt(page, 1)

    expect(await blockLocator(page, tableId).locator('.md-table').count()).toBe(1)
    expect(await blockLocator(page, tableId).textContent()).not.toContain('| --- |')

    await placeCaret(page, tableId, 0)
    expect(await blockLocator(page, tableId).textContent()).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')

    await placeCaret(page, plainId, 0)
    await expectExpanded(page, plainId)
    expect(await blockLocator(page, tableId).locator('.md-table').count()).toBe(1)
    expect(await blockLocator(page, tableId).textContent()).not.toContain('| --- |')
  })

  test('3.12.5 在展开态编辑单元格内容应只更新当前 table block', async ({ page }) => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    await resetEditor(page, md)
    const id = await blockIdAt(page, 0)
    const offset = md.indexOf('2')
    await placeCaret(page, id, offset)
    await page.keyboard.type('0')
    await expectSingleTableBlock(page, '| a | b |\n| --- | --- |\n| 1 | 02 |')
  })

  test('3.12.6 选中表格单元格文本替换时应保留表格结构', async ({ page }) => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    await resetEditor(page, md)
    const id = await blockIdAt(page, 0)
    const start = md.indexOf('1')
    await setSelection(
      page,
      { blockId: id, offset: start },
      { blockId: id, offset: start + 1 },
    )
    await page.keyboard.type('left')
    await expectSingleTableBlock(page, '| a | b |\n| --- | --- |\n| left | 2 |')
  })

  test('3.12.7 删除分隔行开头 pipe 后应退化，再补回 pipe 应恢复为单个 table block', async ({ page }) => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    await resetEditor(page, md)
    const id = await blockIdAt(page, 0)
    const separatorPipeOffset = md.indexOf('\n| ---') + 2

    await placeCaret(page, id, separatorPipeOffset)
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, '| a | b |\n --- | --- |\n| 1 | 2 |')
    await expectBlockTypes(page, ['paragraph', 'paragraph', 'paragraph'])

    const separatorId = await blockIdAt(page, 1)
    await placeCaret(page, separatorId, 0)
    await page.keyboard.type('|')
    await expectSingleTableBlock(page, '| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  test('3.12.8 粘贴包含完整表格的多行文本应按 markdown 结构重建 table block', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await simulatePaste(page, 'alpha\n| a | b |\n| --- | --- |\n| 1 | 2 |\nomega')
    await expectMarkdownEquals(page, 'alpha\n| a | b |\n| --- | --- |\n| 1 | 2 |\nomega')
    await expectBlockTypes(page, ['paragraph', 'table', 'paragraph'])
  })
})
