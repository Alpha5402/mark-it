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
  private compositionContext: { blockId: string, startOffset: number } | null = null

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

      const offset = computeSemanticOffset(root, selection!.anchorNode!, selection!.anchorOffset, this.doc.prefixOffset(block.id))
      if (offset === null) return
      this.scheduler.insertText(block.id, offset, data!, offset + data!.length)
    }

    if (type === EditorActionType.CompositionStart) {
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      if (!block || !root) return

      const offset = computeSemanticOffset(root, selection!.anchorNode!, selection!.anchorOffset, this.doc.prefixOffset(block.id))
      if (offset === null) return

      this.scheduler.markDirty(block.id)

      this.compositionContext = {
        blockId: block.id,
        startOffset: offset
      }
      console.log('compositionContext', this.compositionContext)
    }

    if (type === EditorActionType.CompositionEnd) {
      const block = this.doc.getBlock(this.compositionContext!.blockId)
      if (!block) return

      const offset = this.compositionContext!.startOffset
      this.scheduler.insertText(block.id, offset, data!, offset + data!.length)
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
 * 判断一个文本节点是否在 .md-marker span 内部
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
