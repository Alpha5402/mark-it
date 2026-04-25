import { DocumentController } from '../utils/DocumentController';
import { DOMController } from '../utils/DOMController';
import { DOMScheduler } from '../utils/DOMScheduler';
import { EditorView } from './EditorView';
import { EditorActionType, EventController, type EditorActionContext } from './EditorEventController';
import { BlockModel, BlockVisualState } from '../types';
import { transform } from '../utils/transformer';

export class Editor {
  view: EditorView
  doc: DocumentController
  dom: DOMController
  scheduler: DOMScheduler
  private onChange?: (content: string) => void;
  isHandlingDelete: boolean = false
  controller: EventController
  private compositionContext: { blockId: string, startOffset: number, isInMarker: boolean } | null = null

  constructor(
    previewContainer: HTMLDivElement,
    documentTitle: string = '未命名',
    initialContent: string = ''
  ) {
    this.view = new EditorView(previewContainer, documentTitle)

    this.doc = new DocumentController(initialContent)

    const blocks = Array.from(this.doc.getBlocks().values())
    this.dom = new DOMController(this.view.area, blocks)
    this.scheduler = new DOMScheduler(this.dom, this.doc)
    this.controller = new EventController(this.view.area, action => 
    // 这里只做分发，不直接改 DOM
      this.handleEditorAction(action)
    )
  }

  handleEditorAction(action: EditorActionContext) {
    const {
      type,
      data,
      inputType,
      selection,
      nativeEvent,
      timestamp
    } = action

    if (type === EditorActionType.MoveCursorDown) {
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      if (!block) return

      const caretX = parseFloat(data ?? '0')
      
      // 先判断目标是同 block 还是跨 block
      const moveTarget = this.dom.getVerticalMoveTarget(block.id, 'down')
      if (moveTarget && moveTarget.type === 'cross-block') {
        // 跨 block 移动：先展开目标 block，收起当前 block
        const expandedBlockId = this.dom.getExpandedBlockId()
        if (expandedBlockId) {
          const oldBlock = this.doc.getBlock(expandedBlockId)
          if (oldBlock) this.dom.collapseBlock(oldBlock)
        }
        const targetBlock = this.doc.getBlock(moveTarget.targetBlockId)
        if (targetBlock) {
          this.dom.expandBlock(moveTarget.targetBlockId, targetBlock)
        }
      }
      
      // 在展开后的 DOM 上执行像素定位
      this.dom.setCursorByPixel(block.id, caretX, 'down')
      // 上下键移动已处理完展开/收起，直接返回，避免末尾逻辑用旧 selection 重复操作
      return

    } else if (type === EditorActionType.MoveCursorUp) {
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      if (!block) return

      const caretX = parseFloat(data ?? '0')
      
      // 先判断目标是同 block 还是跨 block
      const moveTarget = this.dom.getVerticalMoveTarget(block.id, 'up')
      if (moveTarget && moveTarget.type === 'cross-block') {
        // 跨 block 移动：先展开目标 block，收起当前 block
        const expandedBlockId = this.dom.getExpandedBlockId()
        if (expandedBlockId) {
          const oldBlock = this.doc.getBlock(expandedBlockId)
          if (oldBlock) this.dom.collapseBlock(oldBlock)
        }
        const targetBlock = this.doc.getBlock(moveTarget.targetBlockId)
        if (targetBlock) {
          this.dom.expandBlock(moveTarget.targetBlockId, targetBlock)
        }
      }
      
      // 在展开后的 DOM 上执行像素定位
      this.dom.setCursorByPixel(block.id, caretX, 'up')
      // 上下键移动已处理完展开/收起，直接返回，避免末尾逻辑用旧 selection 重复操作
      return
    }

    if (type === EditorActionType.InsertText || type === EditorActionType.Paste) {
      console.log('Received input request')
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      if (!block || !root) return

      // 检测光标是否在标识符内部（inline 标记符或结构性标记符）
      const markerInfo = detectMarkerContext(selection!.anchorNode!, selection!.anchorOffset)
      
      if (markerInfo) {
        // 光标在标识符内部，走全行 reconcile 路径
        this.handleInsertInMarker(block, root, markerInfo, data!)
      } else {
        // 正常路径：字符级 insertText
        const offset = computeSemanticOffset(root, selection!.anchorNode!, selection!.anchorOffset, this.doc.prefixOffset(block.id))
        if (offset === null) return
        this.scheduler.insertText(block.id, offset, data!, offset + data!.length)
      }
    }

    if (type === EditorActionType.CompositionStart) {
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      if (!block || !root) return

      // 检测是否在标识符内部
      const markerInfo = detectMarkerContext(selection!.anchorNode!, selection!.anchorOffset)

      if (markerInfo) {
        // 标识符内部的 IME 输入，记录 raw offset
        const rawOffset = computeRawOffset(root, markerInfo.anchorNode, markerInfo.anchorOffset)
        if (rawOffset === null) return

        this.scheduler.markDirty(block.id)
        this.compositionContext = {
          blockId: block.id,
          startOffset: rawOffset,
          isInMarker: true
        }
      } else {
        const offset = computeSemanticOffset(root, selection!.anchorNode!, selection!.anchorOffset, this.doc.prefixOffset(block.id))
        if (offset === null) return

        this.scheduler.markDirty(block.id)
        this.compositionContext = {
          blockId: block.id,
          startOffset: offset,
          isInMarker: false
        }
      }
      console.log('compositionContext', this.compositionContext)
    }

    if (type === EditorActionType.CompositionEnd) {
      const block = this.doc.getBlock(this.compositionContext!.blockId)
      if (!block) return

      if (this.compositionContext!.isInMarker) {
        // 标识符内部的 IME 输入，走 reconcile 路径
        const root = this.dom.getNodeById(block.id)
        if (!root) return
        this.handleInsertInMarkerByRawOffset(block, root, this.compositionContext!.startOffset, data!)
      } else {
        const offset = this.compositionContext!.startOffset
        this.scheduler.insertText(block.id, offset, data!, offset + data!.length)
      }
      this.dom.purify()
    }

    if (action.type === EditorActionType.InsertLineBreak) {
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      if (!block || !root) return

      const offset = computeSemanticOffset(root, selection!.anchorNode!, selection!.anchorOffset, this.doc.prefixOffset(block.id))
      if (offset === null) return

      this.scheduler.handleInsertLineBreak(block.id, offset)
    }

    console.groupCollapsed(
      `%c[EditorAction] %s`,
      'color:#42b883;font-weight:bold;',
      type
    )

    console.log('timestamp:', timestamp)

    if (type == 'insert-text') {
      console.log('inputType:', inputType)
    }

    if (data != null) {
      console.log('data:', JSON.stringify(data))
    }

    console.log(transform(action))

    // selection 信息
    if (selection) {
      console.log('selection:', {
        isCollapsed: selection.isCollapsed,
        anchorNode: selection.anchorNode,
        anchorOffset: selection.anchorOffset,
        focusNode: selection.focusNode,
        focusOffset: selection.focusOffset
      })
    } else {
      console.log('selection: null')
    }

    // 原始事件类型
    // console.log('nativeEvent:', nativeEvent.type)

    if (selection && selection.anchorNode === selection.focusNode) { 
      this.dom.clearHighlight()
      if (selection.anchorNode)
        if (type !== EditorActionType.CompositionEnd)
        this.scheduler.highlightBlock(getIdFromBlock(selection.anchorNode), BlockVisualState.active)
    }

    console.groupEnd()

    // ========== Block 级别标记符展开/收起逻辑 ==========
    // 当光标进入某个 Block 时，展开该 Block 的所有标记符
    // 当光标离开时，收起
    if (selection && selection.anchorNode) {
      const currentBlockId = getIdFromBlock(selection.anchorNode)
      const expandedBlockId = this.dom.getExpandedBlockId()

      if (currentBlockId && currentBlockId !== expandedBlockId) {
        // 光标进入了新的 block，收起旧的，展开新的
        if (expandedBlockId) {
          const oldBlock = this.doc.getBlock(expandedBlockId)
          if (oldBlock) {
            this.dom.collapseBlock(oldBlock)
          }
        }
        const newBlock = this.doc.getBlock(currentBlockId)
        if (newBlock) {
          this.dom.expandBlock(currentBlockId, newBlock)
        }
      } else if (!currentBlockId && expandedBlockId) {
        // 光标离开了所有 block
        const oldBlock = this.doc.getBlock(expandedBlockId)
        if (oldBlock) {
          this.dom.collapseBlock(oldBlock)
        }
      }
    }
  }

    
  destroy() {
    this.view.destroy()
  }

  /**
   * 处理在标识符内部的输入
   * 将字符插入到整行原始文本的正确位置，然后全行 reconcile
   */
  private handleInsertInMarker(
    block: BlockModel,
    blockEl: HTMLElement,
    markerInfo: MarkerContext,
    text: string
  ) {
    // 1. 从 model 重建整行原始文本
    const rawText = this.doc.getRawText(block.id)
    
    // 2. 计算字符在原始文本中的插入位置
    const rawOffset = computeRawOffset(blockEl, markerInfo.anchorNode, markerInfo.anchorOffset)
    if (rawOffset === null) return

    // 3. 将字符插入到原始文本中
    const newRawText = rawText.slice(0, rawOffset) + text + rawText.slice(rawOffset)
    console.log('[InsertInMarker] rawText:', JSON.stringify(rawText), '→', JSON.stringify(newRawText), 'at offset:', rawOffset)

    // 4. 计算插入后光标在新原始文本中的位置
    const newCursorRawOffset = rawOffset + text.length

    // 5. 计算新原始文本中 newCursorRawOffset 对应的纯文本偏移
    //    这个偏移不受 inlineParse 重新解析的影响
    const semanticOffset = rawOffsetToPlainTextOffset(newRawText, newCursorRawOffset)

    // 6. 全行 reconcile
    const effect = this.doc.reconcileFromRawText(block.id, newRawText)
    if (!effect) return

    const targetBlock = effect.kind === 'block-transform' ? effect.to : effect.block

    if (effect.kind === 'block-transform') {
      this.dom.replaceBlock(effect.from, effect.to)
    }

    // 7. 强制重置展开状态并重新渲染
    this.dom.forceResetExpanded()
    this.dom.renderBlockExpanded(targetBlock)

    // 8. 用语义偏移定位光标
    const prefixOffset = this.doc.prefixOffset(targetBlock.id)
    this.dom.setCursor(targetBlock.id, semanticOffset, prefixOffset, 'current')
  }

  /**
   * 通过已知的 raw offset 在标识符内部插入文本（用于 IME 输入）
   */
  private handleInsertInMarkerByRawOffset(
    block: BlockModel,
    blockEl: HTMLElement,
    rawOffset: number,
    text: string
  ) {
    // 1. 从 model 重建整行原始文本
    const rawText = this.doc.getRawText(block.id)
    
    // 2. 将字符插入到原始文本中
    const newRawText = rawText.slice(0, rawOffset) + text + rawText.slice(rawOffset)
    console.log('[InsertInMarker/IME] rawText:', JSON.stringify(rawText), '→', JSON.stringify(newRawText))

    // 3. 计算语义偏移
    const newCursorRawOffset = rawOffset + text.length
    const semanticOffset = rawOffsetToPlainTextOffset(newRawText, newCursorRawOffset)

    // 4. 全行 reconcile
    const effect = this.doc.reconcileFromRawText(block.id, newRawText)
    if (!effect) return

    const targetBlock = effect.kind === 'block-transform' ? effect.to : effect.block

    if (effect.kind === 'block-transform') {
      this.dom.replaceBlock(effect.from, effect.to)
    }

    // 5. 强制重置展开状态并重新渲染
    this.dom.forceResetExpanded()
    this.dom.renderBlockExpanded(targetBlock)

    // 6. 用语义偏移定位光标
    const prefixOffset = this.doc.prefixOffset(targetBlock.id)
    this.dom.setCursor(targetBlock.id, semanticOffset, prefixOffset, 'current')
  }

  handleInput(id: string, blockEl: HTMLDivElement) {
    if (!id) return

    // 1️⃣ 从 DOM 提取“用户当前输入的语义文本”
    const domText = this.view.extractText(blockEl)

    // 2️⃣ 让 DocumentController 做语义 reconcile
    const effect = this.doc.reconcileBlock(id, domText)

    if (!effect) return

    if (effect.kind === 'inline-update') {
      console.log('update inline')
      this.dom.updateInline(effect.block!)
      return
    }

    if (effect.kind === 'block-transform') {
      console.log('block transform')
      this.applyTransaction({
        type: 'replace-block',
        from: effect.from!,
        to: effect.to!
      })
    }
  }

  applyTransaction(tx: { type: 'replace-block'; from: BlockModel; to: BlockModel }) {
    this.doc.blocks.set(tx.to.id, tx.to)

    // 2️⃣ 告诉 DOMController 去执行实际 DOM 替换
    this.dom.replaceBlock(tx.from, tx.to)
  }

  handleDeleteAtListMarker(markerEl: HTMLElement) {
    console.log('handleDeleteAtListMarker')
    const blockEl = markerEl.closest('.md-line-block') as HTMLDivElement
    if (!blockEl) {
      this.isHandlingDelete = false
      return
    }

    const blockId = blockEl.dataset.blockId
    if (!blockId) {
      this.isHandlingDelete = false
      return
    }

    // 1. 拿当前 block model
    const block = this.doc.getBlock(blockId)
    if (!block || block.type !== 'list-item') {
      this.isHandlingDelete = false
      return
    }

    // 2. 语义决策：list-item → paragraph
    const nextBlock = this.doc.transformListItemToParagraph(block)

    // 3. DOM 更新（交给 DOMController）
    this.dom.replaceBlock(block, nextBlock)

    // 4. 光标恢复（关键）
    // this.restoreCursorAfterListRemoval(blockEl, nextBlock.id)

    this.isHandlingDelete = false
  } 
}

const getBlockAnchor = (node: Node): HTMLDivElement | null => {
  const element =
    node instanceof Element
      ? node
      : node?.parentElement
  return element?.closest('.md-line-block') as HTMLDivElement
} 

const getIdFromBlock = (node: Node): string => {
  return getBlockAnchor(node)?.dataset.blockId ?? ''
}

/**
 * 计算光标在 block 中的语义偏移量
 * 语义偏移 = prefixOffset + 光标在 md-inline-content 中的字符偏移（排除标记符文本）
 * 
 * 这个偏移量与 DocumentController.recoveryOffset 期望的 offset 一致
 */
function computeSemanticOffset(
  blockEl: HTMLElement,
  anchorNode: Node,
  anchorOffset: number,
  prefixOffset: number
): number | null {
  // 检查光标是否在结构性标记符内（indent、list marker、heading marker）
  if (isInStructMarkerSpan(anchorNode)) {
    // 光标在结构性标记符内，返回 prefixOffset（即文本开头）
    return prefixOffset
  }

  // 找到 md-inline-content 元素
  const inlineContent = blockEl.querySelector('.md-inline-content')
  if (!inlineContent) return null

  // 确认光标确实在 inline-content 内部
  if (!inlineContent.contains(anchorNode)) {
    // 光标可能在 marker 或 indent 上，返回 prefixOffset（即文本开头）
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
    const inMarker = isInMarkerSpan(textNode)
    
    if (textNode === anchorNode) {
      if (inMarker) {
        // 光标在标记符文本中，映射到最近的语义位置
        // 判断是前缀还是后缀标记符
        const markerEl = textNode.parentElement!
        const expandedSpan = markerEl.parentElement!
        const markers = expandedSpan.querySelectorAll('.md-marker')
        if (markers[0] === markerEl) {
          // 前缀标记符 → 语义偏移为当前累积值（文本开头）
          return prefixOffset + charOffset
        } else {
          // 后缀标记符 → 语义偏移为当前累积值（文本末尾）
          return prefixOffset + charOffset
        }
      }
      // 找到了光标所在的文本节点
      return prefixOffset + charOffset + anchorOffset
    }
    
    if (!inMarker) {
      charOffset += textNode.textContent?.length ?? 0
    }
  }

  // 没找到，返回 null
  return null
}

/**
 * 判断一个文本节点是否在 .md-marker span 内部（inline 标记符如 **、~~）
 */
function isInMarkerSpan(node: Node): boolean {
  let el = node.parentElement
  while (el) {
    if (el.classList.contains('md-marker')) return true
    if (el.classList.contains('md-inline-content')) return false
    el = el.parentElement
  }
  return false
}

/**
 * 判断一个文本节点是否在 .md-struct-marker span 内部（结构性标记符如 indent、list marker、heading marker）
 */
function isInStructMarkerSpan(node: Node): boolean {
  let el = node instanceof Element ? node : node.parentElement
  while (el) {
    if (el.classList.contains('md-struct-marker')) return true
    if (el.classList.contains('md-line-block')) return false
    el = el.parentElement
  }
  return false
}

// ========== 标识符内部输入检测 ==========

interface MarkerContext {
  type: 'inline-marker' | 'struct-marker'
  anchorNode: Node
  anchorOffset: number
}

/**
 * 检测光标是否在标识符内部
 * 返回 MarkerContext 或 null（不在标识符内部）
 */
function detectMarkerContext(anchorNode: Node, anchorOffset: number): MarkerContext | null {
  // 检查是否在 inline 标记符内（如 **、~~、== 等）
  if (isInMarkerSpan(anchorNode)) {
    return {
      type: 'inline-marker',
      anchorNode,
      anchorOffset
    }
  }

  // 检查是否在结构性标记符内（如 indent、list marker、heading marker）
  if (isInStructMarkerSpan(anchorNode)) {
    return {
      type: 'struct-marker',
      anchorNode,
      anchorOffset
    }
  }

  return null
}

/**
 * 计算原始文本中 rawOffset 对应的"语义偏移"
 * 
 * 语义偏移 = 结构性标记符长度 + rawOffset 之前的纯文本字符数
 * 
 * 这个函数对原始文本做一次轻量级解析，识别出 Markdown 标记符和纯文本，
 * 然后计算 rawOffset 之前有多少个纯文本字符。
 * 
 * 注意：结构性标记符（如 "- "、"## "、缩进空格）被视为"语义前缀"，
 * 它们的长度直接计入语义偏移。
 */
function rawOffsetToPlainTextOffset(rawText: string, rawOffset: number): number {
  // 1. 解析结构性标记符
  let structPrefixLen = 0
  let contentStart = 0

  // 缩进
  const indentMatch = rawText.match(/^(\s*)/)
  if (indentMatch) {
    const indent = indentMatch[1]
    structPrefixLen += indent.length
    contentStart += indent.length
  }

  // 列表标记符
  const afterIndent = rawText.slice(contentStart)
  const listMatch = afterIndent.match(/^[-*+]\s/)
  const orderedListMatch = afterIndent.match(/^\d+\.\s/)
  const headingMatch = afterIndent.match(/^#{1,6}\s/)

  if (listMatch) {
    structPrefixLen += listMatch[0].length
    contentStart += listMatch[0].length
  } else if (orderedListMatch) {
    structPrefixLen += orderedListMatch[0].length
    contentStart += orderedListMatch[0].length
  } else if (headingMatch) {
    structPrefixLen += headingMatch[0].length
    contentStart += headingMatch[0].length
  }

  // 如果 rawOffset 在结构性标记符内
  if (rawOffset <= contentStart) {
    return rawOffset
  }

  // 2. 对 inline 内容做轻量级标记符识别
  const inlineText = rawText.slice(contentStart)
  const inlineRawOffset = rawOffset - contentStart

  let plainTextCount = 0
  let i = 0

  while (i < inlineText.length && i < inlineRawOffset) {
    // 行内代码 `
    if (inlineText[i] === '`') {
      i++ // 跳过 `
      // 找到匹配的 `
      const end = inlineText.indexOf('`', i)
      if (end !== -1 && end < inlineRawOffset) {
        // 整个代码块在 rawOffset 之前
        plainTextCount += end - i
        i = end + 1 // 跳过关闭的 `
        continue
      } else if (end !== -1) {
        // rawOffset 在代码块内部
        plainTextCount += inlineRawOffset - i
        return structPrefixLen + plainTextCount
      } else {
        // 没有匹配的 `，当作普通字符
        plainTextCount++
        continue
      }
    }

    // ~~ 删除线
    if (inlineText[i] === '~' && inlineText[i + 1] === '~') {
      i += 2 // 跳过标记符
      continue
    }

    // ** 加粗
    if (inlineText[i] === '*' && inlineText[i + 1] === '*') {
      i += 2
      continue
    }

    // == 高亮
    if (inlineText[i] === '=' && inlineText[i + 1] === '=') {
      i += 2
      continue
    }

    // * 或 _ 斜体
    if (inlineText[i] === '*' || inlineText[i] === '_') {
      i++
      continue
    }

    // 普通字符
    plainTextCount++
    i++
  }

  return structPrefixLen + plainTextCount
}
function computeRawOffset(
  blockEl: HTMLElement,
  anchorNode: Node,
  anchorOffset: number
): number | null {
  // 遍历 blockEl 内所有文本节点（按 DOM 顺序）
  const walker = document.createTreeWalker(
    blockEl,
    NodeFilter.SHOW_TEXT,
    null
  )

  let rawOffset = 0
  let textNode: Text | null
  while ((textNode = walker.nextNode() as Text)) {
    if (textNode === anchorNode) {
      return rawOffset + anchorOffset
    }
    rawOffset += textNode.textContent?.length ?? 0
  }

  return null
}
