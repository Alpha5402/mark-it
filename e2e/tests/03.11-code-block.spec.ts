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
 * 场景 3.11：代码块交互回归。
 *
 * 和公式块一样，代码块在展开态应当呈现完整 markdown 原文；
 * 用户在 DOM 上删除/补回 fence、回车、粘贴、替换选区后，映射回 markdown
 * 的结果应与纯文本编辑预期一致。
 */
test.describe('03.11 code block interactions', () => {
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

  async function expectSingleCodeBlock(page: Page, expectedMarkdown: string) {
    await expectMarkdownEquals(page, expectedMarkdown)
    const snap = await getEditorSnapshot(page)
    expect(snap.blockCount).toBe(1)
    expect(snap.blocks[0].type).toBe('code-block')
    expect(snap.blocks[0].raw).toBe(expectedMarkdown)
  }

  test('3.11.1 初始文档中的 ```...``` 应稳定解析为单个 code-block', async ({ page }) => {
    const md = '```js\nconst x = 1\n```'
    await resetEditor(page, md)
    await expectSingleCodeBlock(page, md)
    await expect(page.locator('.md-renderer-area .md-code-block')).toHaveCount(1)
  })

  test('3.11.2 文档中段落夹着 fenced code 时只合并代码块，不吞前后段落', async ({ page }) => {
    const md = 'before\n```ts\nlet x: number\n```\nafter'
    await resetEditor(page, md)
    await expectMarkdownEquals(page, md)
    await expectBlockTypes(page, ['paragraph', 'code-block', 'paragraph'])
    const codeId = await blockIdAt(page, 1)
    expect(await rawText(page, codeId)).toBe('```ts\nlet x: number\n```')
  })

  test('3.11.3 空代码块 ```\\n``` 也应保持 code-block，不退化或丢失 fence', async ({ page }) => {
    const md = '```\n```'
    await resetEditor(page, md)
    await expectSingleCodeBlock(page, md)
  })

  test('3.11.4 未闭合或非独占的 fence 不应误解析为 code-block', async ({ page }) => {
    await resetEditor(page, '```js\nfoo')
    let snap = await getEditorSnapshot(page)
    expect(snap.blocks.map(b => b.type)).toEqual(['paragraph', 'paragraph'])
    await expectMarkdownEquals(page, '```js\nfoo')

    await resetEditor(page, '```js foo ```')
    snap = await getEditorSnapshot(page)
    expect(snap.blocks[0].type).toBe('paragraph')
    await expectMarkdownEquals(page, '```js foo ```')
  })

  test('3.11.5 点击展开 code-block 后 DOM 文本应等于完整 markdown 原文', async ({ page }) => {
    const md = '```js\nfoo()\nbar()\n```'
    await resetEditor(page, md)
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, '```js\n'.length)
    await expectExpanded(page, id)
    await expect(blockLocator(page, id)).toHaveClass(/md-block-expanded/)
    expect(await blockLocator(page, id).textContent()).toBe(md)
    expect(await rawText(page, id)).toBe(md)
  })

  test('3.11.6 code-block 收起后不应泄漏原始 fence，再展开才显示原文', async ({ page }) => {
    const md = '```js\nfoo\n```\nplain'
    await resetEditor(page, md)
    const codeId = await blockIdAt(page, 0)
    const plainId = await blockIdAt(page, 1)

    expect(await blockLocator(page, codeId).locator('.md-code-fence-marker').count()).toBe(0)
    expect(await blockLocator(page, codeId).textContent()).not.toContain('```')

    await placeCaret(page, codeId, '```js\n'.length)
    expect(await blockLocator(page, codeId).locator('.md-code-fence-marker').count()).toBe(2)
    expect(await blockLocator(page, codeId).textContent()).toBe('```js\nfoo\n```')

    await placeCaret(page, plainId, 0)
    await expectExpanded(page, plainId)
    expect(await blockLocator(page, codeId).locator('.md-code-fence-marker').count()).toBe(0)
    expect(await blockLocator(page, codeId).textContent()).not.toContain('```')
  })

  test('3.11.7 语言标识应参与原文 round-trip，并允许在展开态编辑', async ({ page }) => {
    await resetEditor(page, '```js\nfoo\n```')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, '```j'.length)
    await page.keyboard.type('t')
    await expectSingleCodeBlock(page, '```jts\nfoo\n```')
  })

  test('3.11.8 从空段落键入 ```js 后回车应自动补全 code-block 并把光标放在内容行', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await page.keyboard.type('```js')
    await page.keyboard.press('Enter')
    await expectSingleCodeBlock(page, '```js\n\n```')
    const codeId = await blockIdAt(page, 0)
    await page.keyboard.type('const x = 1')
    await expectSingleCodeBlock(page, '```js\nconst x = 1\n```')
    await expectExpanded(page, codeId)
  })

  test('3.11.9 在 code-block 内容中回车只插入代码内容换行，不拆分 block', async ({ page }) => {
    await resetEditor(page, '```js\nfoo\n```')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, '```js\nfoo'.length)
    await page.keyboard.press('Enter')
    await expectSingleCodeBlock(page, '```js\nfoo\n\n```')
  })

  test('3.11.10 在 code-block 内容中粘贴多行只更新 code，不拆出额外 block', async ({ page }) => {
    await resetEditor(page, '```js\nfoo\n```')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, '```js\n'.length)
    await simulatePaste(page, 'x\ny')
    await expectSingleCodeBlock(page, '```js\nx\nyfoo\n```')
  })

  test('3.11.11 删除结尾 fence 后应退化为普通多行，再补回 fence 应恢复为单个 code-block', async ({ page }) => {
    await resetEditor(page, '```js\nfoo\n```')
    const id = await blockIdAt(page, 0)
    const raw = await rawText(page, id)

    await placeCaret(page, id, raw.length)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, '```js\nfoo\n')
    await expectBlockTypes(page, ['paragraph', 'paragraph', 'blank'])

    const lastId = await blockIdAt(page, 2)
    await placeCaret(page, lastId, 0)
    await page.keyboard.type('```')
    await expectSingleCodeBlock(page, '```js\nfoo\n```')
  })

  test('3.11.12 删除开头 fence 后应退化，重新补回开头 fence 应恢复为单个 code-block', async ({ page }) => {
    await resetEditor(page, '```js\nfoo\n```')
    const id = await blockIdAt(page, 0)

    await placeCaret(page, id, 3)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await expectMarkdownEquals(page, 'js\nfoo\n```')
    await expectBlockTypes(page, ['paragraph', 'paragraph', 'paragraph'])

    const firstId = await blockIdAt(page, 0)
    await placeCaret(page, firstId, 0)
    await page.keyboard.type('```')
    await expectSingleCodeBlock(page, '```js\nfoo\n```')
  })

  test('3.11.13 选中 code-block 内容替换时应保留外层 fence 和 language', async ({ page }) => {
    await resetEditor(page, '```js\nfoo\nbar\n```')
    const id = await blockIdAt(page, 0)
    await setSelection(
      page,
      { blockId: id, offset: '```js\n'.length },
      { blockId: id, offset: '```js\nfoo\nbar'.length },
    )
    await page.keyboard.type('baz')
    await expectSingleCodeBlock(page, '```js\nbaz\n```')
  })

  test('3.11.14 选中整个 code-block 粘贴段落文本时应完全退化为 paragraph', async ({ page }) => {
    await resetEditor(page, '```js\nfoo\n```')
    const id = await blockIdAt(page, 0)
    await setSelection(
      page,
      { blockId: id, offset: 0 },
      { blockId: id, offset: '```js\nfoo\n```'.length },
    )
    await simulatePaste(page, 'plain')
    await expectMarkdownEquals(page, 'plain')
    await expectBlockTypes(page, ['paragraph'])
  })

  test('3.11.15 粘贴包含完整 fenced code 的多行文本应按 markdown 结构重建 code-block', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    await simulatePaste(page, 'alpha\n```ts\nlet x = 1\n```\nomega')
    await expectMarkdownEquals(page, 'alpha\n```ts\nlet x = 1\n```\nomega')
    await expectBlockTypes(page, ['paragraph', 'code-block', 'paragraph'])
  })

  test('3.11.16 ~~~ 围栏代码块应保留原始 fence 类型，不应被重写成 ```', async ({ page }) => {
    const md = '~~~python\nprint(1)\n~~~'
    await resetEditor(page, md)
    await expectMarkdownEquals(page, md)
    const snap = await getEditorSnapshot(page)
    expect(snap.blockCount).toBe(1)
    expect(snap.blocks[0].type).toBe('code-block')
    expect(snap.blocks[0].raw).toBe(md)
  })
})
