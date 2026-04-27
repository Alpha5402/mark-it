import { DocumentController } from '../utils/DocumentController';
import { DOMController } from '../utils/DOMController';
import { DOMScheduler } from '../utils/DOMScheduler';
import { HistoryManager, type CursorInfo } from '../utils/HistoryManager';
import { EditorView } from './EditorView';
import { EditorActionType, EventController, type EditorActionContext, type SelectionSnapshot } from './EditorEventController';
import { BlockModel, BlockVisualState } from '../types';

export class Editor {
  view: EditorView
  doc: DocumentController
  dom: DOMController
  scheduler: DOMScheduler
  history: HistoryManager
  private onChange?: (content: string) => void;
  isHandlingDelete: boolean = false
  controller: EventController
  private compositionContext: { blockId: string, startOffset: number, isInMarker: boolean } | null = null
  /** Undo/Redo 后跳过紧随的 SelectionChange 事件，防止展开/收起闪烁 */
  private skipNextSelectionAction: boolean = false

  constructor(
    previewContainer: HTMLDivElement,
    documentTitle: string = '未命名',
    initialContent: string = ''
  ) {
    this.view = new EditorView(previewContainer, documentTitle)

    this.doc = new DocumentController(initialContent)
    this.history = new HistoryManager()

    const blocks = Array.from(this.doc.getBlocks().values())
    this.dom = new DOMController(this.view.area, blocks)
    this.scheduler = new DOMScheduler(this.dom, this.doc)
    this.controller = new EventController(this.view.area, action => 
    // 这里只做分发，不直接改 DOM
      this.handleEditorAction(action)
    )

    // 保存初始状态作为第一个快照
    this.history.pushSnapshot(this.doc.blocks)
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

    // ========== Undo / Redo 处理 ==========
    if (type === EditorActionType.Undo || type === EditorActionType.Redo) {
      // 1. 获取当前光标位置信息
      const currentCursor = this.getCurrentCursorInfo(selection)

      // 2. 执行 Undo/Redo
      const snapshot = type === EditorActionType.Undo
        ? this.history.undo(this.doc.blocks, currentCursor)
        : this.history.redo(this.doc.blocks, currentCursor)

      if (snapshot) {
        // 3. 恢复 blocks 状态
        this.doc.restoreFromSnapshot(snapshot.blocks)
        const blocks = Array.from(this.doc.getBlocks().values())
        this.dom.fullRebuild(blocks)

        // 4. 恢复光标位置并高亮 Block
        if (snapshot.cursor) {
          const { blockId, offset, isRawOffset } = snapshot.cursor
          const block = this.doc.getBlock(blockId)
          if (block) {
            // 展开目标 block
            this.dom.expandBlock(blockId, block)

            // 根据偏移量类型选择恢复方式
            if (isRawOffset) {
              // 展开模式下保存的 raw offset，用 setCursorByRawOffset 恢复
              this.dom.setCursorByRawOffset(blockId, offset)
            } else {
              // 非展开模式下保存的 semantic offset，用 setCursor 恢复
              const prefixOffset = this.doc.prefixOffset(blockId)
              this.dom.setCursor(blockId, offset, prefixOffset, 'current')
            }

            // 高亮 block
            this.dom.clearHighlight()
            this.scheduler.highlightBlock(blockId, BlockVisualState.active)
          }
        }

        // 5. 设置标志位，跳过紧随的 SelectionChange 引起的展开/收起
        this.skipNextSelectionAction = true
      }
      return
    }

    // ========== 修改操作前保存快照（用于 Undo） ==========
    const isMutatingAction = (
      type === EditorActionType.InsertText ||
      type === EditorActionType.Paste ||
      type === EditorActionType.DeleteBackward ||
      type === EditorActionType.DeleteForward ||
      type === EditorActionType.InsertLineBreak ||
      type === EditorActionType.CompositionEnd
    )
    if (isMutatingAction) {
      const cursorInfo = this.getCurrentCursorInfo(selection)
      this.history.pushSnapshot(this.doc.blocks, cursorInfo)
    }

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
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      if (!block || !root) return

      // 当 block 处于展开模式时，所有输入都走全行 reconcile 路径
      // 因为展开模式下标记符是可见文本，任何输入都可能影响标记符的配对关系
      const isExpanded = this.dom.getExpandedBlockId() === block.id
      
      if (isExpanded) {
        // 展开模式：走全行 reconcile 路径
        this.handleInsertInMarker(block, root, selection!.anchorNode!, selection!.anchorOffset, data!)
        return  // 已处理完展开/收起和光标定位，不再执行末尾逻辑
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

      // 当 block 处于展开模式时，所有 IME 输入都走 reconcile 路径
      const isExpanded = this.dom.getExpandedBlockId() === block.id

      if (isExpanded) {
        // 展开模式：记录 raw offset
        const rawOffset = computeRawOffset(root, selection!.anchorNode!, selection!.anchorOffset)
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
    }

    if (type === EditorActionType.CompositionEnd) {
      const block = this.doc.getBlock(this.compositionContext!.blockId)
      if (!block) return

      if (this.compositionContext!.isInMarker) {
        // 展开模式的 IME 输入，走 reconcile 路径
        const root = this.dom.getNodeById(block.id)
        if (!root) return
        this.handleInsertInMarkerByRawOffset(block, root, this.compositionContext!.startOffset, data!)
        this.dom.purify()
        return  // 已处理完展开/收起和光标定位，不再执行末尾逻辑
      } else {
        const offset = this.compositionContext!.startOffset
        this.scheduler.insertText(block.id, offset, data!, offset + data!.length)
      }
      this.dom.purify()
    }

    if (type === EditorActionType.DeleteBackward || type === EditorActionType.DeleteForward) {
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      if (!block || !root) return

      const isExpanded = this.dom.getExpandedBlockId() === block.id

      if (isExpanded) {
        // 展开模式：使用 raw text 方式删除
        const rawText = this.doc.getRawText(block.id)
        const rawOffset = computeRawOffset(root, selection!.anchorNode!, selection!.anchorOffset)
        if (rawOffset === null) return

        let newRawText: string
        let newCursorRawOffset: number

        if (type === EditorActionType.DeleteBackward) {
          if (rawOffset <= 0) return
          newRawText = rawText.slice(0, rawOffset - 1) + rawText.slice(rawOffset)
          newCursorRawOffset = rawOffset - 1
        } else {
          // DeleteForward
          if (rawOffset >= rawText.length) return
          newRawText = rawText.slice(0, rawOffset) + rawText.slice(rawOffset + 1)
          newCursorRawOffset = rawOffset
        }

        // 如果删除后为空，转为 blank block
        if (newRawText.trim() === '') {
          const blankBlock = { id: block.id, type: 'blank' as const }
          this.doc.blocks.set(block.id, blankBlock)
          this.dom.replaceBlock(block, blankBlock)
          return
        }

        const effect = this.doc.reconcileFromRawText(block.id, newRawText)
        if (!effect) return

        const targetBlock = effect.kind === 'block-transform' ? effect.to : effect.block

        if (effect.kind === 'block-transform') {
          this.dom.replaceBlock(effect.from, effect.to)
        }

        this.dom.forceResetExpanded()
        this.dom.renderBlockExpanded(targetBlock)
        this.dom.setCursorByRawOffset(targetBlock.id, newCursorRawOffset)
        return
      } else {
        // 非展开模式：通过语义偏移删除
        const offset = computeSemanticOffset(root, selection!.anchorNode!, selection!.anchorOffset, this.doc.prefixOffset(block.id))
        if (offset === null) return

        if (type === EditorActionType.DeleteBackward) {
          this.scheduler.handleDeleteBackward(block.id, offset)
        }
        // DeleteForward 在非展开模式下暂不处理
      }
    }

    if (action.type === EditorActionType.InsertLineBreak) {
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      if (!block || !root) return

      const offset = computeSemanticOffset(root, selection!.anchorNode!, selection!.anchorOffset, this.doc.prefixOffset(block.id))
      if (offset === null) return

      this.scheduler.handleInsertLineBreak(block.id, offset)
    }

    // ========== 跳过 Undo/Redo 后紧随的 SelectionChange ==========
    if (this.skipNextSelectionAction && type === EditorActionType.Select) {
      this.skipNextSelectionAction = false
      return
    }

    if (selection && selection.anchorNode === selection.focusNode) { 
      this.dom.clearHighlight()
      if (selection.anchorNode)
        if (type !== EditorActionType.CompositionEnd)
        this.scheduler.highlightBlock(getIdFromBlock(selection.anchorNode), BlockVisualState.active)
    }

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
    this.controller.destroy()
    this.view.destroy()
  }

  /**
   * 获取当前光标位置信息（blockId + 偏移量）
   * 用于 Undo/Redo 快照中保存光标状态
   */
  private getCurrentCursorInfo(selection: SelectionSnapshot | null): CursorInfo | null {
    if (!selection || !selection.anchorNode || !selection.isCollapsed) return null

    const blockId = getIdFromBlock(selection.anchorNode)
    if (!blockId) return null

    const block = this.doc.getBlock(blockId)
    if (!block) return null

    const root = getBlockAnchor(selection.anchorNode)
    if (!root) return null

    const isExpanded = this.dom.getExpandedBlockId() === blockId

    if (isExpanded) {
      const rawOffset = computeRawOffset(root, selection.anchorNode, selection.anchorOffset)
      if (rawOffset === null) return null
      return { blockId, offset: rawOffset, isRawOffset: true }
    } else {
      const prefixOffset = this.doc.prefixOffset(blockId)
      const semanticOffset = computeSemanticOffset(root, selection.anchorNode, selection.anchorOffset, prefixOffset)
      if (semanticOffset === null) return null
      return { blockId, offset: semanticOffset, isRawOffset: false }
    }
  }

  /**
   * 处理在标识符内部的输入
   * 将字符插入到整行原始文本的正确位置，然后全行 reconcile
   */
  private handleInsertInMarker(
    block: BlockModel,
    blockEl: HTMLElement,
    anchorNode: Node,
    anchorOffset: number,
    text: string
  ) {
    // 1. 从 model 重建整行原始文本
    const rawText = this.doc.getRawText(block.id)
    
    // 2. 计算字符在原始文本中的插入位置
    const rawOffset = computeRawOffset(blockEl, anchorNode, anchorOffset)
    if (rawOffset === null) return

    // 3. 将字符插入到原始文本中
    const newRawText = rawText.slice(0, rawOffset) + text + rawText.slice(rawOffset)

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

    // 6. 用 rawOffset 在新 DOM 中定位光标
    //    由于新的 inlineParse 两两配对策略保证了 getRawText(newModel) === newRawText，
    //    DOM 文本布局与 newRawText 完全一致，可以直接用 rawOffset 定位
    this.dom.setCursorByRawOffset(targetBlock.id, rawOffset + text.length)
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

    // 3. 全行 reconcile
    const effect = this.doc.reconcileFromRawText(block.id, newRawText)
    if (!effect) return

    const targetBlock = effect.kind === 'block-transform' ? effect.to : effect.block

    if (effect.kind === 'block-transform') {
      this.dom.replaceBlock(effect.from, effect.to)
    }

    // 4. 强制重置展开状态并重新渲染
    this.dom.forceResetExpanded()
    this.dom.renderBlockExpanded(targetBlock)

    // 5. 用 rawOffset 在新 DOM 中定位光标
    this.dom.setCursorByRawOffset(targetBlock.id, rawOffset + text.length)
  }

  handleInput(id: string, blockEl: HTMLDivElement) {
    if (!id) return

    // 1️⃣ 从 DOM 提取“用户当前输入的语义文本”
    const domText = this.view.extractText(blockEl)

    // 2️⃣ 让 DocumentController 做语义 reconcile
    const effect = this.doc.reconcileBlock(id, domText)

    if (!effect) return

    if (effect.kind === 'inline-update') {
      this.dom.updateInline(effect.block!)
      return
    }

    if (effect.kind === 'block-transform') {
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
