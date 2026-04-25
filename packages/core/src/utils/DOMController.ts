import { BlockModel, InlineModel, TextInline, LinkInline, BlockVisualState, DivideUnit } from "../types"
import { renderBlock, renderInlineBlock } from "./render"

/**
 * 判断一个文本节点是否在 .md-marker 元素内部（inline 标记符如 **、~~）
 */
function isInsideMarker(node: Node): boolean {
  let el = node.parentElement
  while (el) {
    if (el.classList.contains('md-marker')) return true
    if (el.classList.contains('md-inline-content')) return false
    el = el.parentElement
  }
  return false
}

/**
 * 判断一个文本节点是否在 .md-struct-marker 元素内部（结构性标记符如 indent、list marker、heading marker）
 */
function isInsideStructMarker(node: Node): boolean {
  let el = node.parentElement
  while (el) {
    if (el.classList.contains('md-struct-marker')) return true
    if (el.classList.contains('md-line-block')) return false
    el = el.parentElement
  }
  return false
}

export class DOMController {
  private nodes = new Map<string, HTMLDivElement>()
  private highLightedBlocks = new Set<HTMLElement>()
  constructor(
    container: HTMLDivElement, 
    models: BlockModel[],
  ) {
    models.forEach(model => {
      const rendered = renderBlock(model)
      const wrapper = this.fragmentToElement(rendered)
      wrapper.dataset.blockId = model.id
      this.nodes.set(model.id, wrapper)
      container.appendChild(wrapper)
    })
  }

  fragmentToElement = (fragment: DocumentFragment): HTMLDivElement => {
    const wrapper = document.createElement('div')
    wrapper.classList.add('md-line-block')
    
    wrapper.appendChild(fragment)
    return wrapper
  }

  updateBlock(model: BlockModel) {
    const blockEl = this.nodes.get(model.id)
    if (!blockEl) return

    if (!model.inline) return

    this.syncInline(blockEl, model.inline)
  }

  private syncInline(
    blockEl: HTMLDivElement,
    inlines: InlineModel[]
  ) {
    const domInlines = this.collectInlineDOM(blockEl)

    let domIndex = 0

    for (const inline of inlines) {
      const dom = domInlines[domIndex]
      if (!dom) break

      if (inline.type === 'text') {
        this.syncTextInline(dom, inline)
        domIndex++
      }

      if (inline.type === 'link') {
        this.syncLinkInline(dom, inline)
        domIndex++
      }
    }
  }

  private collectInlineDOM(blockEl: HTMLElement): HTMLElement[] {
    const result: HTMLElement[] = []

    for (const node of blockEl.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        // 包一层虚拟 span 处理
        const span = document.createElement('span')
        span.appendChild(node)
        result.push(span)
      }

      if (node instanceof HTMLElement) {
        result.push(node)
      }
    }

    return result
  }

  private syncTextInline(
    el: HTMLElement,
    inline: TextInline
  ) {
    const textNode = this.getTextNode(el)
    if (!textNode) return

    if (textNode.data !== inline.text) {
      textNode.data = inline.text
    }

    // marks（bold / italic）❌ 输入态不处理
  }

  private syncLinkInline(
    el: HTMLElement,
    inline: LinkInline
  ) {
    if (!(el instanceof HTMLAnchorElement)) return

    // href 在 input 阶段不改
    const textNode = this.getTextNode(el)
    if (!textNode) return

    const text = inline.children
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('')

    if (textNode.data !== text) {
      textNode.data = text
    }
  }

  private getTextNode(el: HTMLElement): Text | null {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node as Text
      }
    }
    return null
  }

  updateInline(block: BlockModel) {
    const blockEl = this.nodes.get(block.id)
    if (!blockEl || !block.inline) return

    // 遍历 block.inline 对应的 DOM 节点
    const domInlines = Array.from(blockEl.childNodes)

    let inlineIndex = 0

    for (const inline of block.inline) {
      const dom = domInlines[inlineIndex]
      if (!dom) break

      if (!(dom instanceof HTMLElement)) {
        // 不是 HTMLElement 就跳过（通常是 TextNode，可以直接忽略）
        inlineIndex++
        continue
      }

      if (inline.type === 'text') {
        const textNode = this.getTextNode(dom)
        if (textNode && textNode.data !== inline.text) {
          textNode.data = inline.text
        }
        inlineIndex++
      } else if (inline.type === 'link') {
        if (!(dom instanceof HTMLAnchorElement)) continue
        const linkText = inline.children
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('')
        const textNode = this.getTextNode(dom)
        if (textNode && textNode.data !== linkText) {
          textNode.data = linkText
        }
        inlineIndex++
      }
    }
  }

  replaceBlock(from: BlockModel, to: BlockModel) {
    const oldEl = this.nodes.get(from.id)
    if (!oldEl) return

    // 保存光标信息
    const selection = window.getSelection()
    const cursorOffset = selection?.focusOffset ?? 0

    // 渲染新的 block
    const fragment = renderBlock(to)
    const newEl = this.fragmentToElement(fragment)

    oldEl.replaceChildren(...Array.from(newEl.childNodes))

    // 删除旧 id 的映射，将新 id 指向实际挂载在 DOM 中的 oldEl
    this.nodes.delete(from.id)
    oldEl.dataset.blockId = to.id
    this.nodes.set(to.id, oldEl)

    // 尝试恢复光标
    if (selection) {
      const range = document.createRange()
      range.setStart(oldEl, Math.min(cursorOffset, oldEl.childNodes.length))
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }
  }

  highlightBlock(BlockId: string, type: number) {
    const el = this.nodes.get(BlockId)
    console.log('highlightBlock', BlockId, type, el)
    if (!el) return

    this.highLightedBlocks.add(el)
    if (type & BlockVisualState.active) {
      el.classList.add('md-block-active')
    }
    if (type & BlockVisualState.dirty) {
      el.classList.add('md-block-dirty')
    }
  }

  clearHighlight() {
    this.highLightedBlocks.forEach(node => {
      node.classList.remove('md-block-active')
    })
    this.highLightedBlocks.clear()
  }

  purify() {
    this.highLightedBlocks.forEach(node => {
      if (node.classList.contains('md-block-dirty')) {
        node.classList.remove('md-block-dirty')
        node.classList.add('md-block-active')
      }
    })
  }

  getCurrentCursorVisualOffset(blockId: string, prefixOffset: number): number | null {
    const blockEl = this.nodes.get(blockId)
    if (!blockEl) return null
    const selection = window.getSelection()
    if (!selection) return null
    if (!selection.anchorNode) return null
    if (!blockEl.contains(selection.anchorNode)) return null

    // 如果光标在结构性标记符内（indent、list marker、heading marker），返回 prefixOffset
    if (isInsideStructMarker(selection.anchorNode)) {
      return prefixOffset
    }

    // 找到 md-inline-content 元素
    const inlineContent = blockEl.querySelector('.md-inline-content')
    if (!inlineContent) return null

    // 如果光标不在 inline-content 内，返回 prefixOffset（文本开头）
    if (!inlineContent.contains(selection.anchorNode)) {
      return prefixOffset
    }

    // 遍历 inline-content 中的所有文本节点，计算光标的字符偏移
    // 跳过 .md-marker 中的文本节点
    const walker = document.createTreeWalker(
      inlineContent,
      NodeFilter.SHOW_TEXT,
      null
    )

    let charOffset = 0
    let textNode: Text | null
    while ((textNode = walker.nextNode() as Text)) {
      if (isInsideMarker(textNode)) {
        if (textNode === selection.anchorNode) {
          // 光标在标记符内，返回当前累积偏移
          return prefixOffset + charOffset
        }
        continue
      }
      if (textNode === selection.anchorNode) {
        return prefixOffset + charOffset + selection.anchorOffset
      }
      charOffset += textNode.textContent?.length ?? 0
    }

    return null
  }

  setCursor(blockId: string, offset: number, prefixOffset: number, direction: 'up' | 'down' | 'current') {
    const block = this.nodes.get(blockId)
    if (!block) return
    if (direction === 'current') {
      const range = resolveRangeFromSemanticOffset(block, offset, prefixOffset)
      applyRange(range)
    } else {
      const nextBlock = direction === 'down' 
        ? findNextLineBlock(block.parentElement!, block) 
        : findPrevLineBlock(block.parentElement!, block)

      if (!nextBlock) return
      const range = resolveRangeFromSemanticOffset(nextBlock, offset, prefixOffset)
      applyRange(range)
    }
  }

  /**
   * 判断上下行移动的目标：是同 block 内移动还是跨 block 移动
   * 返回 { type: 'same-block' } 或 { type: 'cross-block', targetBlockId: string }
   * 用于在移动前先完成展开/收起操作
   */
  getVerticalMoveTarget(blockId: string, direction: 'up' | 'down'): 
    { type: 'same-block' } | { type: 'cross-block'; targetBlockId: string } | null {
    const block = this.nodes.get(blockId)
    if (!block || !block.parentElement) return null

    const LINE_TOLERANCE = 3

    // 检查当前 block 是否有多个视觉行
    const candidates = collectCandidates(block)
    const lines = groupByLine(candidates, LINE_TOLERANCE)

    if (lines.length > 1) {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        const caretRange = sel.getRangeAt(0).cloneRange()
        caretRange.collapse(true)
        const caretRects = caretRange.getClientRects()
        if (caretRects.length > 0) {
          const caretTop = caretRects[0].top
          let currentLineIdx = -1
          for (let i = 0; i < lines.length; i++) {
            if (Math.abs(lines[i][0].rect.top - caretTop) <= LINE_TOLERANCE) {
              currentLineIdx = i
              break
            }
          }
          if (currentLineIdx !== -1) {
            const targetLineIdx = direction === 'down' ? currentLineIdx + 1 : currentLineIdx - 1
            if (targetLineIdx >= 0 && targetLineIdx < lines.length) {
              return { type: 'same-block' }
            }
          }
        }
      }
    }

    // 需要跨 block
    const nextBlock = direction === 'down'
      ? findNextLineBlock(block.parentElement, block)
      : findPrevLineBlock(block.parentElement, block)

    if (!nextBlock) return null

    const targetBlockId = nextBlock.dataset.blockId
    if (!targetBlockId) return null

    return { type: 'cross-block', targetBlockId }
  }

  /**
   * 基于像素 x 坐标实现上下行光标移动
   * 
   * 策略：
   * 1. 先在当前 block 内收集所有可编辑位置，按视觉行分组
   * 2. 找到光标当前所在的视觉行
   * 3. 如果当前 block 内有上/下一个视觉行，就在同 block 内移动
   * 4. 如果已在 block 的第一行/最后一行，则跳到上/下一个 block
   */
  setCursorByPixel(blockId: string, targetX: number, direction: 'up' | 'down') {
    const block = this.nodes.get(blockId)
    if (!block || !block.parentElement) return

    const LINE_TOLERANCE = 3

    // ---- 第一步：尝试在当前 block 内移动 ----
    const currentCandidates = collectCandidates(block)
    const currentLines = groupByLine(currentCandidates, LINE_TOLERANCE)

    if (currentLines.length > 1) {
      // 当前 block 有多个视觉行，找到光标所在行
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        const caretRange = sel.getRangeAt(0).cloneRange()
        caretRange.collapse(true)
        const caretRects = caretRange.getClientRects()
        if (caretRects.length > 0) {
          const caretTop = caretRects[0].top
          // 找到光标所在的视觉行索引
          let currentLineIdx = -1
          for (let i = 0; i < currentLines.length; i++) {
            if (Math.abs(currentLines[i][0].rect.top - caretTop) <= LINE_TOLERANCE) {
              currentLineIdx = i
              break
            }
          }

          if (currentLineIdx !== -1) {
            const targetLineIdx = direction === 'down' ? currentLineIdx + 1 : currentLineIdx - 1
            if (targetLineIdx >= 0 && targetLineIdx < currentLines.length) {
              // 同 block 内有目标行，直接在同 block 内移动
              const bestRange = findClosestInLine(currentLines[targetLineIdx], targetX)
              if (bestRange) {
                applyRange(bestRange)
                return
              }
            }
          }
        }
      }
    }

    // ---- 第二步：需要跨 block 移动 ----
    const nextBlock = direction === 'down'
      ? findNextLineBlock(block.parentElement, block)
      : findPrevLineBlock(block.parentElement, block)

    if (!nextBlock) return

    const nextCandidates = collectCandidates(nextBlock)
    if (nextCandidates.length === 0) {
      // fallback：目标 block 没有可编辑位置
      const range = document.createRange()
      range.setStart(nextBlock, 0)
      range.collapse(true)
      applyRange(range)
      return
    }

    const nextLines = groupByLine(nextCandidates, LINE_TOLERANCE)
    if (nextLines.length === 0) return

    // 向下 → 取目标 block 的第一行；向上 → 取目标 block 的最后一行
    const targetLine = direction === 'down' ? nextLines[0] : nextLines[nextLines.length - 1]
    const bestRange = findClosestInLine(targetLine, targetX)

    if (bestRange) {
      applyRange(bestRange)
    }
  }

  updateDOM(block: BlockModel, prefixOffset: number, nextCursorOffset?: number) {
    if (!block || !block.inline) return
    const cursor = this.getCurrentCursorVisualOffset(block.id, prefixOffset)
    const blockEl = this.nodes.get(block.id)
    if (!blockEl) return

    const inlineRoot = blockEl.querySelector('.md-inline-content')
    if (!inlineRoot) return

    // 判断当前 block 是否处于展开状态
    const isExpanded = this.expandedBlockId === block.id

    // ⚠️ 假设 inlineRoot.childNodes 与 block.inline 一一对应
    // （这是你们当前架构下合理的前提）
    const domChildren = Array.from(inlineRoot.childNodes)

    block.inline.forEach((inline, index) => {
      if (!inline.dirty) return

      const oldNode = domChildren[index]
      if (!oldNode) return

      const newNode = renderInlineBlock(inline, isExpanded)

      inlineRoot.replaceChild(newNode, oldNode)

      inline.dirty = false
    })

    if (cursor && nextCursorOffset) {
      this.setCursor(block.id, nextCursorOffset, prefixOffset, 'current')
    }
  }

  getNodeById(BlockId: string): HTMLDivElement | null {
    const el = this.nodes.get(BlockId)
    return el || null
  }

  // private findDocumentRoot(el: HTMLElement | null): HTMLElement | null {
  //   while (el) {
  //     if (el.classList.contains('md-document')) return el
  //     el = el.parentNode as HTMLElement
  //   }
  //   return null
  // }

  insertBlock(origin: BlockModel, target: BlockModel) {
    const el = this.nodes.get(origin.id)
    if (!el) return

    const parent = el.parentNode
    if (!parent) return

    const rendered = renderBlock(target)
    const wrapper = this.fragmentToElement(rendered)
    wrapper.dataset.blockId = target.id
    this.nodes.set(target.id, wrapper)

    // 插入到 origin 后面
    if (el.nextSibling) {
      parent.insertBefore(wrapper, el.nextSibling)
    } else {
      parent.appendChild(wrapper)
    }
  }

  // ========== Block 级别标记符展开/收起 ==========

  // 当前展开的 block ID
  private expandedBlockId: string | null = null

  /**
   * 展开指定 block 的所有标记符
   * 用展开模式重新渲染整个 block 的 inline 内容
   */
  expandBlock(blockId: string, block: BlockModel): void {
    // 如果已经展开了同一个 block，不重复操作
    if (this.expandedBlockId === blockId) return

    // 先收起之前展开的 block
    this.collapseBlock()

    const blockEl = this.nodes.get(blockId)
    if (!blockEl || !block.inline) return

    // 保存光标位置（语义偏移，排除标记符）
    const cursorInfo = this.saveCursorInBlock(blockEl)

    // 用展开模式重新渲染整个 block
    const fragment = renderBlock(block, true)
    const tempWrapper = document.createElement('div')
    tempWrapper.appendChild(fragment)

    // 替换 blockEl 的子节点
    blockEl.replaceChildren(...Array.from(tempWrapper.childNodes))
    blockEl.classList.add('md-block-expanded')

    this.expandedBlockId = blockId

    // 恢复光标位置
    if (cursorInfo) {
      this.restoreCursorInBlock(blockEl, cursorInfo)
    }
  }

  /**
   * 收起当前展开的 block，恢复为正常渲染
   */
  collapseBlock(collapsingBlock?: BlockModel): void {
    if (!this.expandedBlockId) return

    const blockId = this.expandedBlockId
    const blockEl = this.nodes.get(blockId)
    if (!blockEl) {
      this.expandedBlockId = null
      return
    }

    // 保存光标位置（语义偏移，排除标记符）
    const cursorInfo = this.saveCursorInBlock(blockEl)

    // 用正常模式重新渲染
    // 如果调用方提供了 block model，使用它；否则不恢复（由调用方负责）
    if (collapsingBlock) {
      const fragment = renderBlock(collapsingBlock, false)
      const tempWrapper = document.createElement('div')
      tempWrapper.appendChild(fragment)
      blockEl.replaceChildren(...Array.from(tempWrapper.childNodes))
    }

    blockEl.classList.remove('md-block-expanded')
    this.expandedBlockId = null

    // 恢复光标位置
    if (cursorInfo && collapsingBlock) {
      this.restoreCursorInBlock(blockEl, cursorInfo)
    }
  }

  /**
   * 获取当前展开的 block ID
   */
  getExpandedBlockId(): string | null {
    return this.expandedBlockId
  }

  /**
   * 保存光标在 block 中的语义位置（排除标记符文本和结构性标记符文本）
   * 返回 { semanticOffset } 或 null
   */
  private saveCursorInBlock(blockEl: HTMLElement): { semanticOffset: number } | null {
    const selection = window.getSelection()
    if (!selection || !selection.anchorNode || !selection.isCollapsed) return null
    if (!blockEl.contains(selection.anchorNode)) return null

    // 检查光标是否在结构性标记符内（indent、list marker、heading marker）
    if (isInsideStructMarker(selection.anchorNode)) {
      // 光标在结构性标记符内，映射到语义偏移 0（文本开头）
      return { semanticOffset: 0 }
    }

    const inlineContent = blockEl.querySelector('.md-inline-content')
    if (!inlineContent) return null
    if (!inlineContent.contains(selection.anchorNode)) return null

    // 遍历 inline-content 中的所有文本节点，跳过 .md-marker 中的文本
    let charOffset = 0
    const walker = document.createTreeWalker(
      inlineContent,
      NodeFilter.SHOW_TEXT,
      null
    )

    let textNode: Text | null
    while ((textNode = walker.nextNode() as Text)) {
      const isMarker = isInsideMarker(textNode)
      if (textNode === selection.anchorNode) {
        if (isMarker) {
          // 光标在 inline 标记符内，映射到最近的语义位置
          const markerEl = textNode.parentElement!
          const expandedSpan = markerEl.parentElement!
          const markers = expandedSpan.querySelectorAll('.md-marker')
          if (markers[0] === markerEl) {
            return { semanticOffset: charOffset }
          } else {
            return { semanticOffset: charOffset }
          }
        }
        return { semanticOffset: charOffset + selection.anchorOffset }
      }
      if (!isMarker) {
        charOffset += textNode.textContent?.length ?? 0
      }
    }

    return null
  }

  /**
   * 在 block 中恢复光标到指定语义偏移位置（跳过标记符文本和结构性标记符文本）
   */
  private restoreCursorInBlock(blockEl: HTMLElement, cursorInfo: { semanticOffset: number }): void {
    const inlineContent = blockEl.querySelector('.md-inline-content')
    if (!inlineContent) return

    const walker = document.createTreeWalker(
      inlineContent,
      NodeFilter.SHOW_TEXT,
      null
    )

    let accumulated = 0
    let textNode: Text | null
    while ((textNode = walker.nextNode() as Text)) {
      if (isInsideMarker(textNode)) continue

      const len = textNode.textContent?.length ?? 0
      if (accumulated + len >= cursorInfo.semanticOffset) {
        const localOffset = cursorInfo.semanticOffset - accumulated
        const range = document.createRange()
        range.setStart(textNode, Math.min(localOffset, len))
        range.collapse(true)
        applyRange(range)
        return
      }
      accumulated += len
    }

    // fallback：放到最后一个非标记符文本节点的末尾
    const allTextNodes: Text[] = []
    const walker2 = document.createTreeWalker(inlineContent, NodeFilter.SHOW_TEXT, null)
    let tn: Text | null
    while ((tn = walker2.nextNode() as Text)) {
      if (!isInsideMarker(tn)) allTextNodes.push(tn)
    }
    if (allTextNodes.length > 0) {
      const last = allTextNodes[allTextNodes.length - 1]
      const range = document.createRange()
      range.setStart(last, last.textContent?.length ?? 0)
      range.collapse(true)
      applyRange(range)
    }
  }

}

export function findNextLineBlock(
  root: HTMLElement,
  current: HTMLElement
): HTMLElement | null {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (
          node instanceof HTMLElement &&
          isLineBlock(node)
        ) {
          return NodeFilter.FILTER_ACCEPT
        }
        return NodeFilter.FILTER_SKIP
      }
    }
  )

  let foundCurrent = false
  let node: Node | null

  while ((node = walker.nextNode())) {
    if (node === current) {
      foundCurrent = true
      continue
    }

    if (foundCurrent) {
      return node as HTMLElement
    }
  }

  return null
}

export function findPrevLineBlock(
  root: HTMLElement,
  current: HTMLElement
): HTMLElement | null {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (
          node instanceof HTMLElement &&
          isLineBlock(node)
        ) {
          return NodeFilter.FILTER_ACCEPT
        }
        return NodeFilter.FILTER_SKIP
      }
    }
  )

  let prev: HTMLElement | null = null
  let node: Node | null

  while ((node = walker.nextNode())) {
    if (node === current) {
      return prev
    }
    prev = node as HTMLElement
  }

  return null
}

function isLineBlock(el: Element): boolean {
  return el.classList.contains('md-line-block')
}

/**
 * 根据语义偏移量在 DOM 中定位光标
 * 语义偏移 = prefixOffset + 文本内字符偏移
 * 
 * 直接在 md-inline-content 中按字符偏移定位，不依赖 resolveDivideRange 的 unit 索引
 * 跳过 .md-marker 中的文本节点
 */
function resolveRangeFromSemanticOffset(
  blockEl: HTMLElement,
  semanticOffset: number,
  prefixOffset: number
): Range {
  const range = document.createRange()

  // 找到 md-inline-content
  const inlineContent = blockEl.querySelector('.md-inline-content')
  if (!inlineContent) {
    // fallback：没有 inline-content，设置到 block 开头
    range.setStart(blockEl, 0)
    range.collapse(true)
    return range
  }

  // 计算文本内偏移
  const textOffset = Math.max(0, semanticOffset - prefixOffset)

  // 遍历 inline-content 中的所有文本节点，找到目标位置
  // 跳过 .md-marker 中的文本节点
  const walker = document.createTreeWalker(
    inlineContent,
    NodeFilter.SHOW_TEXT,
    null
  )

  let accumulated = 0
  let textNode: Text | null
  let lastTextNode: Text | null = null

  while ((textNode = walker.nextNode() as Text)) {
    if (isInsideMarker(textNode)) continue

    lastTextNode = textNode
    const len = textNode.textContent?.length ?? 0

    if (accumulated + len >= textOffset) {
      // 目标位置在这个文本节点内
      const localOffset = textOffset - accumulated
      range.setStart(textNode, Math.min(localOffset, len))
      range.collapse(true)
      return range
    }

    accumulated += len
  }

  // 如果偏移超出了所有文本，放到最后一个文本节点的末尾
  if (lastTextNode) {
    range.setStart(lastTextNode, lastTextNode.textContent?.length ?? 0)
    range.collapse(true)
    return range
  }

  // 最终 fallback
  range.setStart(inlineContent, 0)
  range.collapse(true)
  return range
}

export function resolveDivideRange(
  blockEl: HTMLElement,
): DivideUnit[] {
  const units: DivideUnit[] = []
  let lastOffset = 0

  const pushTextSlots = (textNode: Text, skipLast: boolean = true) => {
    const len = textNode.textContent?.length ?? 0
    for (let i = 0; i < (skipLast ? len : len + 1); i++) {
      units.push({ node: textNode, offset: i })
    }
    if (skipLast) {
      lastOffset = len
    }
  }

  const children = Array.from(blockEl.children)
  children.forEach((el, index) => {
    // 展开模式下的结构性标记符（indent、list marker、heading marker）
    if (el.classList.contains('md-struct-marker')) {
      const textNode = el.firstChild as Text | null
      if (textNode) {
        pushTextSlots(textNode)
      }
      return
    }

    if (el.classList.contains('md-indent') || el.classList.contains('md-spacing')) {
      const textNode = el.firstChild as Text | null
      if (textNode) {
        pushTextSlots(textNode)
      } else {
        // 无子节点时只 push offset: 0，避免 Range.setStart 报 IndexSizeError
        units.push({ node: el, offset: 0, type: 'indent' })
      }
      return
    }

    if (el.classList.contains('md-list-marker') || el.classList.contains('md-list-number')) {
      const textNode = el.firstChild as Text | null
      if (textNode) {
        pushTextSlots(textNode, false)
      }
      return
    }

    if (el.classList.contains('md-list-item')) {
      let marker = el.querySelector('.md-list-marker')
      if (!marker) {
        marker = el.querySelector('.md-list-number')
      }
      const inline = el.querySelector('.md-inline-content')

      if (marker?.firstChild instanceof Text) {
        pushTextSlots(marker.firstChild, false)
      }

      if (inline) {
        const walker = document.createTreeWalker(
          inline,
          NodeFilter.SHOW_TEXT,
          null
        )
        const textNodes: Text[] = []
        let node: Text | null
        while ((node = walker.nextNode() as Text)) {
          textNodes.push(node)
        }

        const lastTextNode = textNodes[textNodes.length - 1]

        for (const textNode of textNodes) {
          const isNotLast = textNode !== lastTextNode
          pushTextSlots(textNode, isNotLast)
        }
      }
      return
    }

    if (el.classList.contains('md-inline-content')) {
      const walker = document.createTreeWalker(
        el,
        NodeFilter.SHOW_TEXT,
        null
      )
      let textNode: Text | null
      while ((textNode = walker.nextNode() as Text)) {
        console.log(index, children.length)
        pushTextSlots(textNode, index !== children.length - 1)
      }
      return
    }

    // 处理 heading（展开模式下包含 md-struct-marker + md-inline-content）
    if (el.className.startsWith('md-heading-')) {
      // 遍历 heading 内部的所有子元素
      for (const child of Array.from(el.children)) {
        if (child.classList.contains('md-struct-marker')) {
          const textNode = child.firstChild as Text | null
          if (textNode) {
            pushTextSlots(textNode)
          }
        } else if (child.classList.contains('md-inline-content')) {
          const walker = document.createTreeWalker(
            child,
            NodeFilter.SHOW_TEXT,
            null
          )
          const textNodes: Text[] = []
          let node: Text | null
          while ((node = walker.nextNode() as Text)) {
            textNodes.push(node)
          }
          const lastTextNode = textNodes[textNodes.length - 1]
          for (const textNode of textNodes) {
            const isNotLast = textNode !== lastTextNode
            pushTextSlots(textNode, isNotLast)
          }
        }
      }
      // 收起模式下 heading 没有 md-inline-content，直接遍历文本节点
      if (!el.querySelector('.md-inline-content')) {
        const walker = document.createTreeWalker(
          el,
          NodeFilter.SHOW_TEXT,
          null
        )
        const textNodes: Text[] = []
        let node: Text | null
        while ((node = walker.nextNode() as Text)) {
          textNodes.push(node)
        }
        const lastTextNode = textNodes[textNodes.length - 1]
        for (const textNode of textNodes) {
          const isNotLast = textNode !== lastTextNode
          pushTextSlots(textNode, isNotLast)
        }
      }
      return
    }

    if (el.classList.contains('md-paragraph')) {
      const inline = el.querySelector('.md-inline-content')

      if (inline) {
        const walker = document.createTreeWalker(
          inline,
          NodeFilter.SHOW_TEXT,
          null
        )
        const textNodes: Text[] = []
        let node: Text | null
        while ((node = walker.nextNode() as Text)) {
          textNodes.push(node)
        }

        const lastTextNode = textNodes[textNodes.length - 1]

        for (const textNode of textNodes) {
          const isNotLast = textNode !== lastTextNode
          pushTextSlots(textNode, isNotLast)
        }
      }
    }
  })
  return units
}

// ========== 上下行移动辅助函数 ==========

type Candidate = { range: Range; rect: DOMRect }

function collectCandidates(blockEl: HTMLElement): Candidate[] {
  const units = resolveDivideRange(blockEl)
  // 过滤掉 indent/spacing 等纯装饰性元素、.md-marker 内部的文本节点、以及 .md-struct-marker 内部的文本节点
  const editableUnits = units.filter(u => !u.type && !isInsideMarker(u.node) && !isInsideStructMarker(u.node))
  const result: Candidate[] = []
  for (const unit of editableUnits) {
    const range = document.createRange()
    range.setStart(unit.node, unit.offset)
    range.collapse(true)
    const rects = range.getClientRects()
    if (rects.length === 0) continue
    result.push({ range, rect: rects[0] })
  }
  return result
}

function groupByLine(candidates: Candidate[], tolerance: number): Candidate[][] {
  if (candidates.length === 0) return []
  const sorted = [...candidates].sort((a, b) => a.rect.top - b.rect.top)
  const lines: Candidate[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const lastLine = lines[lines.length - 1]
    if (Math.abs(sorted[i].rect.top - lastLine[0].rect.top) <= tolerance) {
      lastLine.push(sorted[i])
    } else {
      lines.push([sorted[i]])
    }
  }
  return lines
}

function findClosestInLine(line: Candidate[], targetX: number): Range | null {
  let best: Range | null = null
  let bestDist = Infinity
  for (const { range, rect } of line) {
    const dist = Math.abs(rect.left - targetX)
    if (dist < bestDist) {
      bestDist = dist
      best = range
    }
  }
  return best
}

function applyRange(range: Range) {
  const sel = window.getSelection()
  if (!sel) return

  sel.removeAllRanges()
  sel.addRange(range)
}
