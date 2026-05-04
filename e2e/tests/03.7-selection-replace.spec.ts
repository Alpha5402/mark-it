import { test, expect } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  placeCaret,
  blockIdAt,
  setSelection,
  simulatePaste,
  expectMarkdownEquals,
  expectBlockCount,
} from './helpers/editor'

/**
 * 场景 3.7：选区替换（选中 → 粘贴 / 输入 / 回车）
 */
test.describe('03.7 selection replace', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  test('3.7.1 单 block 内选中 [start,end) → 键入字符替换', async ({ page }) => {
    await resetEditor(page, 'abcdef')
    const id = await blockIdAt(page, 0)
    await setSelection(
      page,
      { blockId: id, offset: 1 },
      { blockId: id, offset: 4 }, // 选中 "bcd"
    )
    await page.keyboard.type('X')
    await expectMarkdownEquals(page, 'aXef')
  })

  test('3.7.2 选中整段 → 键入 1 字 → 变单字符 paragraph', async ({ page }) => {
    await resetEditor(page, 'whole text')
    const id = await blockIdAt(page, 0)
    await setSelection(
      page,
      { blockId: id, offset: 0 },
      { blockId: id, offset: 'whole text'.length },
    )
    await page.keyboard.type('y')
    await expectMarkdownEquals(page, 'y')
  })

  test('3.7.3 选中整段 → 粘贴单行 → 替换', async ({ page }) => {
    await resetEditor(page, 'hello')
    const id = await blockIdAt(page, 0)
    await setSelection(
      page,
      { blockId: id, offset: 0 },
      { blockId: id, offset: 5 },
    )
    await simulatePaste(page, 'WORLD')
    await expectMarkdownEquals(page, 'WORLD')
  })

  test('3.7.4 选中整段 → 粘贴多行 → 创建新 block', async ({ page }) => {
    await resetEditor(page, 'hello')
    const id = await blockIdAt(page, 0)
    await setSelection(
      page,
      { blockId: id, offset: 0 },
      { blockId: id, offset: 5 },
    )
    await simulatePaste(page, 'a\nb\nc')
    await expectMarkdownEquals(page, 'a\nb\nc')
    await expectBlockCount(page, 3)
  })

  test('3.7.6 选中文本后 Enter → 先删选区再拆 block', async ({ page }) => {
    await resetEditor(page, 'abcdef')
    const id = await blockIdAt(page, 0)
    await setSelection(
      page,
      { blockId: id, offset: 1 },
      { blockId: id, offset: 4 },
    )
    await page.keyboard.press('Enter')
    // 选区 "bcd" 被删，在 1 号位置换行：'a' / 'ef'
    await expectMarkdownEquals(page, 'a\nef')
    await expectBlockCount(page, 2)
  })

  test('3.7.7 跨 block 选中后键入字符 → 首尾合并', async ({ page }) => {
    await resetEditor(page, 'foo\nmiddle\nbar')
    const id0 = await blockIdAt(page, 0)
    const id2 = await blockIdAt(page, 2)
    await setSelection(
      page,
      { blockId: id0, offset: 2 }, // fo|o
      { blockId: id2, offset: 1 }, // b|ar
    )
    await page.keyboard.type('Z')
    await expectMarkdownEquals(page, 'foZar')
    await expectBlockCount(page, 1)
  })

  test('3.7.10 选中后 Delete 键 → 与 Backspace 行为一致', async ({ page }) => {
    await resetEditor(page, 'abcdef')
    const id = await blockIdAt(page, 0)
    await setSelection(
      page,
      { blockId: id, offset: 1 },
      { blockId: id, offset: 4 },
    )
    await page.keyboard.press('Delete')
    await expectMarkdownEquals(page, 'aef')
  })
})
