import { test, expect } from '@playwright/test'
import {
  gotoPlayground,
  resetEditor,
  getEditorSnapshot,
  editorArea,
  getMarkdown,
} from './helpers/editor'

/**
 * 场景 0：基础渲染与事件接管前置检查
 * 这里验证 playground 能正常挂载、window.__markit 注入成功、
 * 且 .md-renderer-area 为唯一 contenteditable 入口。
 */
test.describe('00 bootstrap', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  test('0.1 空文档初始化：block 列表为空或为单个 blank', async ({ page }) => {
    await resetEditor(page, '')
    const snap = await getEditorSnapshot(page)
    // 空初始化至少不 crash，getMarkdown 为空串或 blank 占位
    expect(snap.blockCount).toBeLessThanOrEqual(1)
    expect(snap.markdown).toMatch(/^\s*$/)
  })

  test('0.2 用示例 markdown 初始化：block 数正确且顺序稳定', async ({ page }) => {
    const md = [
      '# Heading',
      '',
      'paragraph text',
      '',
      '- list item',
    ].join('\n')
    await resetEditor(page, md)
    const snap = await getEditorSnapshot(page)
    expect(snap.blockCount).toBeGreaterThanOrEqual(3)
    expect(await getMarkdown(page)).toBe(md)
    // 顺序：heading → blank → paragraph → blank → list
    expect(snap.blocks[0].type).toBe('heading')
    expect(snap.blocks[snap.blocks.length - 1].type).toBe('list-item')
  })

  test('0.3 初次渲染不应出现任何 md-block-expanded', async ({ page }) => {
    await resetEditor(page, '# h1\n\npara\n')
    const expanded = await page.locator('.md-block-expanded').count()
    expect(expanded).toBe(0)
  })

  test('0.4 .md-renderer-area 是唯一的编辑入口且 contentEditable=true', async ({ page }) => {
    await resetEditor(page, '# h1\n')
    const area = editorArea(page)
    await expect(area).toHaveAttribute('contenteditable', 'true')
    // 其他节点不应是 contentEditable=true（除了 title）
    const editableCount = await page.locator('[contenteditable="true"]').count()
    expect(editableCount).toBeLessThanOrEqual(2) // title + area
  })

  test('0.5 window.__markit 注入成功，Editor 公开 API 可用', async ({ page }) => {
    await resetEditor(page, '# hello\n')
    const api = await page.evaluate(() => {
      const ed = window.__markit.editor
      return {
        hasGetMarkdown: typeof ed.getMarkdownSource === 'function',
        hasToggleBold: typeof ed.toggleBold === 'function',
        hasToggleItalic: typeof ed.toggleItalic === 'function',
        hasDoc: !!ed.doc,
        hasDom: !!ed.dom,
      }
    })
    expect(api.hasGetMarkdown).toBe(true)
    expect(api.hasToggleBold).toBe(true)
    expect(api.hasToggleItalic).toBe(true)
    expect(api.hasDoc).toBe(true)
    expect(api.hasDom).toBe(true)
  })
})
