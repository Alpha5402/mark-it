import { expect, Page, Locator } from '@playwright/test'

/**
 * 打开 playground 并等待 Editor 挂载完毕。
 * 使用 ?e2e=1 让 App 使用空文档启动（避免默认示例干扰断言）。
 */
export async function gotoPlayground(page: Page) {
  await page.goto('/?e2e=1')
  await page.waitForFunction(() => (window as any).__markitReady === true)
  // 再等一帧，让 Editor 构造器里的初始渲染完成
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(null))))
}

/**
 * 用指定 markdown 重置 editor 实例（销毁旧的、重建新的）。
 */
export async function resetEditor(page: Page, markdown: string = '') {
  await page.evaluate((md) => {
    window.__markit.reset(md)
  }, markdown)
  // 等待 React 把新 editor 实例写入
  await page.waitForFunction(() => (window as any).__markit && (window as any).__markit.editor !== null)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(null))))
}

export interface BlockSnapshot {
  id: string
  type: string
  raw: string
  nesting?: number
}

export interface EditorSnapshot {
  markdown: string
  expandedBlockId: string | null
  blocks: BlockSnapshot[]
  blockCount: number
}

/**
 * 从 editor 实例拉取完整状态（纯数据，便于在 expect 中断言）。
 * 注意：这里依赖 Editor 的内部字段 doc / dom，它们不是公开 API 但被 Editor 自己使用；
 * e2e 层读取它们用于白盒断言是可接受的妥协。
 */
export async function getEditorSnapshot(page: Page): Promise<EditorSnapshot> {
  return await page.evaluate<EditorSnapshot>(() => {
    const ed = window.__markit.editor
    if (!ed) return { markdown: '', expandedBlockId: null, blocks: [], blockCount: 0 }
    const blocks: BlockSnapshot[] = []
    for (const [id] of ed.doc.getBlocks()) {
      const block = ed.doc.getBlock(id)
      blocks.push({
        id,
        type: block?.type ?? 'unknown',
        raw: ed.doc.getRawText(id),
        nesting: block?.nesting,
      })
    }
    return {
      markdown: ed.getMarkdownSource(),
      expandedBlockId: ed.dom.getExpandedBlockId(),
      blocks,
      blockCount: blocks.length,
    }
  })
}

/** 仅取 markdown 源（快捷方法） */
export async function getMarkdown(page: Page): Promise<string> {
  return await page.evaluate(() => window.__markit.getMarkdown())
}

/** 仅取 block 列表（快捷方法） */
export async function getBlockIds(page: Page): Promise<string[]> {
  return await page.evaluate(() =>
    Array.from(window.__markit.editor.doc.getBlocks().keys()) as string[]
  )
}

/** 获取展开中的 block id（没有则 null） */
export async function getExpandedBlockId(page: Page): Promise<string | null> {
  return await page.evaluate(() => window.__markit.editor.dom.getExpandedBlockId())
}

/** 获取 editor area locator（事件目标） */
export function editorArea(page: Page): Locator {
  return page.locator('.md-renderer-area')
}

/** 获取某个 block 的 locator（按 data-block-id 精确匹配） */
export function blockLocator(page: Page, blockId: string): Locator {
  return page.locator(`.md-renderer-area [data-block-id="${blockId}"]`)
}

/** 按索引获取 block id（从 0 开始） */
export async function blockIdAt(page: Page, index: number): Promise<string> {
  const ids = await getBlockIds(page)
  if (index < 0 || index >= ids.length) {
    throw new Error(`blockIdAt: index ${index} out of range [0, ${ids.length})`)
  }
  return ids[index]
}

// =============================================================================
// 光标与选区
// =============================================================================

/**
 * 在指定 block 的指定 rawOffset（展开态 / 非展开态自适应）处放置光标。
 * - 若 block 未展开，会先通过点击 block 触发展开（与用户交互路径一致）。
 * - rawOffset 的语义与 Editor 内部一致：包含 leading + marker + 内容
 */
export async function placeCaret(
  page: Page,
  blockId: string,
  rawOffset: number,
) {
  // 先点击 block 内任意位置，使其成为展开的那一个
  const block = blockLocator(page, blockId)
  await block.waitFor()
  await block.click()
  // 等到 editor 确认展开
  await page.waitForFunction(
    (id) => window.__markit.editor?.dom.getExpandedBlockId() === id,
    blockId,
  )
  // 用 editor 内置的 setCursorByRawOffset 精确落点
  await page.evaluate(
    ({ id, off }) => {
      const ed = window.__markit.editor
      ed.dom.setCursorByRawOffset(id, off)
      // 触发一次 selectionchange，让 editor 记录 expandedBlockId 等状态
      document.dispatchEvent(new Event('selectionchange'))
    },
    { id: blockId, off: rawOffset },
  )
}

/**
 * 创建一个跨 block / 同 block 选区。offset 语义同 placeCaret。
 */
export async function setSelection(
  page: Page,
  anchor: { blockId: string; offset: number },
  focus: { blockId: string; offset: number },
) {
  // 至少让光标先落到 anchor 所在 block 完成一次展开，避免奇怪中间态
  await placeCaret(page, anchor.blockId, anchor.offset)
  await page.evaluate(
    (args) => {
      const ed = window.__markit.editor
      const dom = ed.dom
      const findNodeAndOffset = (blockId: string, rawOff: number) => {
        // 复用 DOMController 的 rawOffsetToNodeOffset（私有 API）
        // 如果没有暴露，就用 setCursorByRawOffset 的逻辑：先把光标设好再读 selection
        dom.setCursorByRawOffset(blockId, rawOff)
        const sel = document.getSelection()!
        return { node: sel.anchorNode, offset: sel.anchorOffset }
      }
      const a = findNodeAndOffset(args.anchor.blockId, args.anchor.offset)
      const f = findNodeAndOffset(args.focus.blockId, args.focus.offset)
      const sel = document.getSelection()!
      sel.removeAllRanges()
      const range = document.createRange()
      // setBaseAndExtent 支持反向选区
      // @ts-ignore
      sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset)
      document.dispatchEvent(new Event('selectionchange'))
    },
    { anchor, focus },
  )
  // 跨 block 展开是 rAF 异步的，等一帧
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(null))))
}

/** 读取当前 selection 的简要信息（用于断言） */
export async function getSelectionInfo(page: Page) {
  return await page.evaluate(() => {
    const sel = document.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const r = sel.getRangeAt(0)
    const anchorBlock = (sel.anchorNode as any)?.parentElement?.closest('.md-line-block') as HTMLElement | null
    const focusBlock = (sel.focusNode as any)?.parentElement?.closest('.md-line-block') as HTMLElement | null
    return {
      isCollapsed: sel.isCollapsed,
      anchorBlockId: anchorBlock?.dataset.blockId ?? null,
      focusBlockId: focusBlock?.dataset.blockId ?? null,
      anchorOffset: sel.anchorOffset,
      focusOffset: sel.focusOffset,
      text: r.toString(),
    }
  })
}

// =============================================================================
// 输入模拟
// =============================================================================

/**
 * 模拟一次 "paste" 事件。
 * Playwright 没有 clipboard write 的跨浏览器 API，我们直接构造
 * ClipboardEvent + DataTransfer 并派发到当前 active 元素。
 */
export async function simulatePaste(page: Page, text: string) {
  await page.evaluate((t) => {
    const target = document.querySelector('.md-renderer-area') as HTMLElement
    if (!target) throw new Error('simulatePaste: .md-renderer-area not found')
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    const ev = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    })
    // 保险：若构造器未能注入 clipboardData，补一个只读属性
    // @ts-ignore
    if (!ev.clipboardData) {
      Object.defineProperty(ev, 'clipboardData', { value: dt })
    }
    target.dispatchEvent(ev)
  }, text)
  // 粘贴后 editor 会同步修改 DOM，但 selectionchange / rAF 可能异步
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(null))))
}

/**
 * 模拟 "copy" 事件并返回被写入 clipboard 的纯文本。
 */
export async function simulateCopy(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const target = document.querySelector('.md-renderer-area') as HTMLElement
    if (!target) throw new Error('simulateCopy: .md-renderer-area not found')
    const dt = new DataTransfer()
    const ev = new ClipboardEvent('copy', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    })
    // @ts-ignore
    if (!ev.clipboardData) Object.defineProperty(ev, 'clipboardData', { value: dt })
    target.dispatchEvent(ev)
    return dt.getData('text/plain')
  })
}

/**
 * 模拟 "cut" 事件并返回被写入 clipboard 的纯文本。
 */
export async function simulateCut(page: Page): Promise<string> {
  const text = await page.evaluate(() => {
    const target = document.querySelector('.md-renderer-area') as HTMLElement
    if (!target) throw new Error('simulateCut: .md-renderer-area not found')
    const dt = new DataTransfer()
    const ev = new ClipboardEvent('cut', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    })
    // @ts-ignore
    if (!ev.clipboardData) Object.defineProperty(ev, 'clipboardData', { value: dt })
    target.dispatchEvent(ev)
    return dt.getData('text/plain')
  })
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(null))))
  return text
}

/**
 * 模拟 IME 输入：compositionstart → multiple update → compositionend
 */
export async function simulateIME(
  page: Page,
  finalText: string,
  steps: string[] = [],
) {
  await page.evaluate(
    (args) => {
      const target = document.querySelector('.md-renderer-area') as HTMLElement
      if (!target) throw new Error('simulateIME: .md-renderer-area not found')
      const start = new CompositionEvent('compositionstart', { data: '', bubbles: true })
      target.dispatchEvent(start)
      for (const s of args.steps) {
        const upd = new CompositionEvent('compositionupdate', { data: s, bubbles: true })
        target.dispatchEvent(upd)
      }
      const end = new CompositionEvent('compositionend', { data: args.finalText, bubbles: true })
      target.dispatchEvent(end)
      // Editor 会在 compositionend 后重建内容，触发一次 input 让 MutationObserver 清理
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: args.finalText }))
    },
    { finalText, steps },
  )
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(null))))
}

/**
 * 模拟拖放文件（目前 editor 用到 file drop 生成图片 markdown）
 */
export async function simulateDrop(
  page: Page,
  files: { name: string; type: string; data: string /* dataURL 或 base64 */ }[],
) {
  await page.evaluate((fs) => {
    const target = document.querySelector('.md-renderer-area') as HTMLElement
    if (!target) throw new Error('simulateDrop: .md-renderer-area not found')
    const dt = new DataTransfer()
    for (const f of fs) {
      // 构造一个最小 File，data 允许传 dataURL，这里只需要 name/type 即可被 Editor 里 FileReader 读到
      const byteStr = atob(f.data.split(',').pop() ?? '')
      const bytes = new Uint8Array(byteStr.length)
      for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i)
      const file = new File([bytes], f.name, { type: f.type })
      dt.items.add(file)
    }
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })
    target.dispatchEvent(over)
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
    target.dispatchEvent(drop)
  }, files)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(null))))
}

// =============================================================================
// 断言辅助
// =============================================================================

/** 等待展开 block 切换到指定 id（带超时） */
export async function expectExpanded(page: Page, blockId: string | null, timeout = 2000) {
  await page.waitForFunction(
    (id) => window.__markit.editor?.dom.getExpandedBlockId() === id,
    blockId,
    { timeout },
  )
}

/** 等待 block 数量为期望值 */
export async function expectBlockCount(page: Page, n: number, timeout = 2000) {
  await page.waitForFunction(
    (c) => window.__markit.editor?.doc.getBlocks().size === c,
    n,
    { timeout },
  )
}

/** 等待 markdown 与给定字符串完全相等 */
export async function expectMarkdownEquals(page: Page, expected: string, timeout = 2000) {
  try {
    await page.waitForFunction(
      (exp) => window.__markit.getMarkdown() === exp,
      expected,
      { timeout },
    )
  } catch (e) {
    const cur = await getMarkdown(page)
    throw new Error(
      `expectMarkdownEquals failed.\nexpected=${JSON.stringify(expected)}\nactual=  ${JSON.stringify(cur)}`,
    )
  }
}

/** 等待 markdown 包含给定片段 */
export async function expectMarkdownContains(page: Page, fragment: string, timeout = 2000) {
  try {
    await page.waitForFunction(
      (f) => window.__markit.getMarkdown().includes(f),
      fragment,
      { timeout },
    )
  } catch (e) {
    const cur = await getMarkdown(page)
    throw new Error(
      `expectMarkdownContains failed.\nexpected to contain ${JSON.stringify(fragment)}\nactual=${JSON.stringify(cur)}`,
    )
  }
}

/** 断言 DOM 中包含指定 class 的 block */
export async function expectBlockClass(page: Page, blockId: string, className: string) {
  const locator = blockLocator(page, blockId)
  await expect(locator).toBeVisible()
  const hasClass = await locator.evaluate((el, c) => {
    // 自身或后代含有该 class
    if (el.classList.contains(c)) return true
    return !!el.querySelector(`.${c}`)
  }, className)
  expect(hasClass, `block ${blockId} should contain .${className}`).toBe(true)
}
