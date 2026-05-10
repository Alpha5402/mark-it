import { test, expect } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  placeCaret,
  blockIdAt,
  setSelection,
  simulateCopy,
  simulateCut,
  simulateDrop,
  expectMarkdownEquals,
} from './helpers/editor'

/**
 * 场景 4：事件接管专项
 * 这些 case 大多只能在真实浏览器里验证（jsdom/happy-dom 不支持）：
 *   - beforeinput.preventDefault
 *   - copy/cut/paste clipboard
 *   - Undo/Redo 快捷键
 *   - drag & drop 文件
 */
test.describe('04 event-interception', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  test('4.1.1 键入后 DOM 变化由 Editor 自己处理（不抛 DomMutated action）', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)

    // 安装一个 spy，监听 controller 的所有 action
    await page.evaluate(() => {
      const ed = window.__markit.editor
      const original = ed.handleEditorAction.bind(ed)
      ;(window as any).__actions = []
      ed.handleEditorAction = (ctx: any) => {
        ;(window as any).__actions.push(ctx.type)
        return original(ctx)
      }
    })

    await page.keyboard.type('hi')

    const actions = await page.evaluate(() => (window as any).__actions as string[])
    // 应出现 insert-text，不应出现 dom-mutated（因为 beforeinput 被 preventDefault）
    expect(actions).toContain('insert-text')
    expect(actions).not.toContain('dom-mutated')
  })

  test('4.3.1 Copy：preventDefault 且 clipboardData 有 text/plain', async ({ page }) => {
    await resetEditor(page, 'hello world')
    const id = await blockIdAt(page, 0)
    await setSelection(
      page,
      { blockId: id, offset: 0 },
      { blockId: id, offset: 5 }, // "hello"
    )
    const copied = await simulateCopy(page)
    expect(copied).toBe('hello')
  })

  test('4.3.2 跨 block 选区 Copy → 拼接多 block raw text', async ({ page }) => {
    await resetEditor(page, 'aaa\nbbb\nccc')
    const id0 = await blockIdAt(page, 0)
    const id2 = await blockIdAt(page, 2)
    await setSelection(
      page,
      { blockId: id0, offset: 1 },
      { blockId: id2, offset: 2 },
    )
    const copied = await simulateCopy(page)
    expect(copied.length).toBeGreaterThan(0)
    expect(copied).toContain('bbb')
  })

  test('4.4.1 Cmd+Z Undo → 回滚上一次编辑', async ({ page }) => {
    await resetEditor(page, 'abc')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 3)
    await page.keyboard.type('X')
    await expectMarkdownEquals(page, 'abcX')
    await page.keyboard.press('Meta+z')
    const md = await page.evaluate(() => window.__markit.getMarkdown())
    expect(md).toBe('abc')
  })

  test('4.4.2 Cmd+Shift+Z Redo → 重做', async ({ page }) => {
    await resetEditor(page, 'abc')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 3)
    await page.keyboard.type('X')
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+Shift+z')
    const md = await page.evaluate(() => window.__markit.getMarkdown())
    expect(md).toBe('abcX')
  })

  test('4.6.2 拖入图片文件 → 生成 ![alt](data:image/...) 插入', async ({ page }) => {
    await resetEditor(page, '')
    const id = await blockIdAt(page, 0)
    await placeCaret(page, id, 0)
    // 构造一张 1x1 PNG
    const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    await simulateDrop(page, [{ name: 'pixel.png', type: 'image/png', data: png1x1 }])
    // 读取一次就好（Editor 用 FileReader 异步读取）
    await page.waitForFunction(
      () => window.__markit.getMarkdown().includes('!['),
      null,
      { timeout: 3000 },
    )
    const md = await page.evaluate(() => window.__markit.getMarkdown())
    expect(md).toMatch(/^!\[pixel\.png\]\(data:image\/png;base64,/)
  })
})
