import { BlockModel, InlineModel, TextInline, LinkInline, BlockVisualState, DivideUnit } from "../types"
import { renderBlock, renderInlineBlock } from "./render"

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

  getCurrentCursorVisualOffset(blockId: string): number | null {
    const blockEl = this.nodes.get(blockId)
    if (!blockEl) return null
      const selection = window.getSelection()
      if (!selection) return null
      if (!selection.anchorNode) return null
      if (!blockEl.contains(selection.anchorNode)) return null
      const unit = resolveDivideRange(blockEl)
      const node = selection!.anchorNode!
      let lastMaxOffset = 0
      for(let i = 0; i < unit.length; i++) {
        if (node === unit[i].node) {
          lastMaxOffset = i
          break
        }
      }

      return lastMaxOffset + selection!.anchorOffset
  }

  setCursor(blockId: string, offset: number, direction: 'up' | 'down' | 'current') {
    const block = this.nodes.get(blockId)
    if (!block) return
    if (direction === 'current') {
      const range = resolveRangeFromVisualOffset(block, offset)
      applyRange(range)
    } else {
      const nextBlock = direction === 'down' 
        ? findNextLineBlock(block.parentElement!, block) 
        : findPrevLineBlock(block.parentElement!, block)

      if (!nextBlock) return
      const range = resolveRangeFromVisualOffset(nextBlock, offset)
      applyRange(range)
    }
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

    // ---- 辅助：收集一个 block 中所有可编辑位置的候选 ----
    type Candidate = { range: Range; rect: DOMRect }
    const collectCandidates = (blockEl: HTMLElement): Candidate[] => {
      const units = resolveDivideRange(blockEl)
      // 过滤掉 indent/spacing 等纯装饰性元素
      const editableUnits = units.filter(u => !u.type)
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

    // ---- 辅助：按视觉行分组（相同 top 值的归为一组）----
    const groupByLine = (candidates: Candidate[]): Candidate[][] => {
      if (candidates.length === 0) return []
      const sorted = [...candidates].sort((a, b) => a.rect.top - b.rect.top)
      const lines: Candidate[][] = [[sorted[0]]]
      for (let i = 1; i < sorted.length; i++) {
        const lastLine = lines[lines.length - 1]
        if (Math.abs(sorted[i].rect.top - lastLine[0].rect.top) <= LINE_TOLERANCE) {
          lastLine.push(sorted[i])
        } else {
          lines.push([sorted[i]])
        }
      }
      return lines
    }

    // ---- 辅助：在一组候选中找 x 最接近 targetX 的位置 ----
    const findClosestInLine = (line: Candidate[]): Range | null => {
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

    // ---- 第一步：尝试在当前 block 内移动 ----
    const currentCandidates = collectCandidates(block)
    const currentLines = groupByLine(currentCandidates)

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
              const bestRange = findClosestInLine(currentLines[targetLineIdx])
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

    const nextLines = groupByLine(nextCandidates)
    if (nextLines.length === 0) return

    // 向下 → 取目标 block 的第一行；向上 → 取目标 block 的最后一行
    const targetLine = direction === 'down' ? nextLines[0] : nextLines[nextLines.length - 1]
    const bestRange = findClosestInLine(targetLine)

    if (bestRange) {
      applyRange(bestRange)
    }
  }

  updateDOM(block: BlockModel, nextCursorOffset?: number) {
    if (!block || !block.inline) return
    const cursor = this.getCurrentCursorVisualOffset(block.id)
    const blockEl = this.nodes.get(block.id)
    if (!blockEl) return

    const inlineRoot = blockEl.querySelector('.md-inline-content')
    if (!inlineRoot) return

    // ⚠️ 假设 inlineRoot.childNodes 与 block.inline 一一对应
    // （这是你们当前架构下合理的前提）
    const domChildren = Array.from(inlineRoot.childNodes)

    block.inline.forEach((inline, index) => {
      if (!inline.dirty) return

      const oldNode = domChildren[index]
      if (!oldNode) return

      const newNode = renderInlineBlock(inline)

      inlineRoot.replaceChild(newNode, oldNode)

      inline.dirty = false
    })

    if (cursor && nextCursorOffset) {
      this.setCursor(block.id, nextCursorOffset, 'current')
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

function resolveRangeFromVisualOffset(
  blockEl: HTMLElement,
  targetOffset: number
): Range {
  // console.log('resolveRangeFromVisualOffset', blockEl, targetOffset)
  const range = document.createRange()
  const units = resolveDivideRange(blockEl)
  console.log('units', units)

  // 🧯 fallback
  if (units.length === 0) {
    range.setStart(blockEl, 0)
    range.collapse(true)
    return range
  }

  // 🎯 clamp visual offset
  const index = Math.max(0, Math.min(targetOffset, units.length - 1))
  console.log('targetOffset', targetOffset)
  console.log('units.length', units.length)
  console.log('clamped index:', index)
  const unit = units[index]
  console.log('resolved unit:', unit)

  range.setStart(unit.node, unit.offset)
  range.collapse(true)
  console.log('resolved range:', range)
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

function applyRange(range: Range) {
  const sel = window.getSelection()
  if (!sel) return

  sel.removeAllRanges()
  sel.addRange(range)
}
