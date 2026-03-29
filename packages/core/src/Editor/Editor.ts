import { DocumentController } from '../utils/DocumentController';
import { DOMController } from '../utils/DOMController';
import { DOMScheduler } from '../utils/DOMScheduler';
import { EditorView } from './EditorView';
import { EditorActionType, EventController, type EditorActionContext } from './EditorEventController';
import { BlockModel, BlockVisualState } from '../types';
import { transform } from '../utils/transformer';
import { resolveDivideRange } from '../utils/DOMController';

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
      const root = getBlockAnchor(selection!.anchorNode!)
      if (!block || !root) return

      const line = Array.from(root.childNodes)
      if (!line) return

      const unit = resolveDivideRange(root)
      const node = selection!.anchorNode!
      let lastMaxOffset = 0
      for(let i = 0; i < unit.length; i++) {
        if (node === unit[i].node) {
          lastMaxOffset = i
          break
        }
      }

      const offset = lastMaxOffset + selection!.anchorOffset

      this.dom.setCursor(block.id, offset, 'down')

    } else if (type === EditorActionType.MoveCursorUp) {

      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      console.log(block, root)
      if (!block || !root) return

      const line = Array.from(root.childNodes)
      if (!line) return

      const unit = resolveDivideRange(root)
      const node = selection!.anchorNode!
      let lastMaxOffset = 0
      for(let i = 0; i < unit.length; i++) {
        if (node === unit[i].node) {
          lastMaxOffset = i
          break
        }
      }

      const offset = lastMaxOffset + selection!.anchorOffset

      this.dom.setCursor(block.id, offset, 'up')
    }

    if (type === EditorActionType.InsertText || type === EditorActionType.Paste) {
      console.log('Received input request')
      console.log('selection', selection)
      console.log(getIdFromBlock(selection!.anchorNode!))
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      console.log(block, root)
      if (!block || !root) return

      const line = Array.from(root.childNodes)
      if (!line) return

      const unit = resolveDivideRange(root)
      const node = selection!.anchorNode!
      let lastMaxOffset = 0
      for(let i = 0; i < unit.length; i++) {
        if (node === unit[i].node) {
          lastMaxOffset = i
          break
        }
      }

      const offset = lastMaxOffset + selection!.anchorOffset
      this.scheduler.insertText(block.id, offset, data!, offset + data!.length)
    }

    if (type === EditorActionType.CompositionStart) {
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      console.log(block, root)
      if (!block || !root) return

      const unit = resolveDivideRange(root)
      const node = selection!.anchorNode!

      let base = 0
      for (let i = 0; i < unit.length; i++) {
        if (unit[i].node === node) {
          base = i
          break
        }
      }

      this.scheduler.markDirty(block.id)

      this.compositionContext = {
        blockId: block.id,
        startOffset: base + selection!.anchorOffset
      }
      console.log('compositionContext', this.compositionContext)
    }

    if (type === EditorActionType.CompositionEnd) {
      const block = this.doc.getBlock(this.compositionContext!.blockId)
      const node = this.dom.getNodeById(this.compositionContext!.blockId)
      if (!node) return
      const root = getBlockAnchor(node)
      if (!block || !root) return
      const line = Array.from(root.childNodes)
      if (!line) return

      const unit = resolveDivideRange(root)
      let lastMaxOffset = 0
      for(let i = 0; i < unit.length; i++) {
        if (node === unit[i].node) {
          lastMaxOffset = i
          break
        }
      }

      const offset = lastMaxOffset + this.compositionContext!.startOffset
      console.log(offset + data!.length)
      this.scheduler.insertText(block.id, offset, data!, offset + data!.length)
      this.dom.purify()
    }

    if (action.type === EditorActionType.InsertLineBreak) {
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      // console.log(block, root)
      if (!block || !root) return

      const line = Array.from(root.childNodes)
      if (!line) return

      const unit = resolveDivideRange(root)
      const node = selection!.anchorNode!
      let lastMaxOffset = 0
      for(let i = 0; i < unit.length; i++) {
        if (node === unit[i].node) {
          lastMaxOffset = i
          break
        }
      }

      const offset = lastMaxOffset + selection!.anchorOffset

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

