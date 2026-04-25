export enum EditorActionType {
  InsertText = 'insert-text',
  DeleteBackward = 'delete-backward',
  DeleteForward = 'delete-forward',
  InsertLineBreak = 'insert-line-break',
  SelectionChange = 'selection-change',
  MoveCursorDown = 'move-cursor-down',
  MoveCursorUp = 'move-cursor-up',
  Enter = 'enter',

  Select = 'select',

  Copy = 'copy',
  Cut = 'cut',
  Paste = 'paste',

  CompositionStart = 'composition-start',
  CompositionUpdate = 'composition-update',
  CompositionEnd = 'composition-end',

  DomMutated = 'dom-mutated',

  Unknown = 'unknown'
}

export interface SelectionSnapshot {
  anchorNode: Node | null
  anchorOffset: number
  focusNode: Node | null
  focusOffset: number
  isCollapsed: boolean
}

export interface EditorActionContext {
  type: EditorActionType
  selection: SelectionSnapshot | null
  nativeEvent: Event | null

  prevSelection?: SelectionSnapshot | null
  data?: string | null
  inputType?: string

  /** DOM 变化（仅 MutationObserver 使用） */
  mutations?: MutationRecord[]

  timestamp: number
}

export class EventController {
  private isComposing = false
  private mutationObserver: MutationObserver | null = null
  
  // 记录“上一次”的选区，用于 diff
  private lastSelectionSnapshot: SelectionSnapshot | null = null
  
  private inInputTransaction = false
  private pendingMutations: MutationRecord[] = []

  constructor(
    private readonly root: HTMLElement,
    private readonly onAction: (ctx: EditorActionContext) => void
  ) {
    console.log('root', root)
    this.bind()
    this.initMutationObserver()
    // 初始化选区状态
    this.lastSelectionSnapshot = this.captureSelection()
  }

  destroy() {
    this.unbind()
    this.mutationObserver?.disconnect()
  }

  // -------------------------
  // Bind / Unbind
  // -------------------------

  private bind() {
    this.root.addEventListener('beforeinput', this.onBeforeInput)
    this.root.addEventListener('input', this.onInput)
    this.root.addEventListener('keydown', this.onKeyDown)

    document.addEventListener('selectionchange', this.onSelectionChange)

    this.root.addEventListener('copy', this.onCopy)
    this.root.addEventListener('cut', this.onCut)
    this.root.addEventListener('paste', this.onPaste)

    this.root.addEventListener('compositionstart', this.onCompositionStart)
    this.root.addEventListener('compositionupdate', this.onCompositionUpdate)
    this.root.addEventListener('compositionend', this.onCompositionEnd)
  }

  private unbind() {
    this.root.removeEventListener('beforeinput', this.onBeforeInput)
    this.root.removeEventListener('input', this.onInput)
    this.root.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('selectionchange', this.onSelectionChange)

    this.root.removeEventListener('copy', this.onCopy)
    this.root.removeEventListener('cut', this.onCut)
    this.root.removeEventListener('paste', this.onPaste)

    this.root.removeEventListener('compositionstart', this.onCompositionStart)
    this.root.removeEventListener('compositionupdate', this.onCompositionUpdate)
    this.root.removeEventListener('compositionend', this.onCompositionEnd)
  }

  // -------------------------
  // Selection
  // -------------------------

  private isSelectionInEditor(): boolean {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return false
    const node = sel.anchorNode
    // 向上查找是否包含在 root 内
    return node ? this.root.contains(node.nodeType === 1 ? node : node.parentNode) : false
  }

  private captureSelection(): SelectionSnapshot | null {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null

    return {
      anchorNode: sel.anchorNode,
      anchorOffset: sel.anchorOffset,
      focusNode: sel.focusNode,
      focusOffset: sel.focusOffset,
      isCollapsed: sel.isCollapsed
    }
  }

  // -------------------------
  // Emit
  // -------------------------

  private emit(
    type: EditorActionType,
    nativeEvent: Event | null,
    extra?: Partial<EditorActionContext>
  ) {
    this.onAction({
      type,
      nativeEvent,
      selection: this.captureSelection(),
      timestamp: performance.now(),
      ...extra
    })
  }

  // -------------------------
  // Mutation Observer
  // -------------------------

  private initMutationObserver() {
    this.mutationObserver = new MutationObserver(mutations => {
      if (!this.inInputTransaction) return

      this.pendingMutations.push(...mutations)
    })

    this.mutationObserver.observe(this.root, {
      childList: true,
      characterData: true,
      subtree: true
    })
  }

  // -------------------------
  // Input lifecycle
  // -------------------------

  private onBeforeInput = (e: InputEvent) => {
    if (this.isComposing) return
    e.preventDefault()

    // 1. 捕捉动作前的状态
    const beforeSelection = this.captureSelection()
    this.lastSelectionSnapshot = beforeSelection // 更新缓存
    
    this.inInputTransaction = true
    this.pendingMutations = []

    switch (e.inputType) {
      case 'insertText':
        this.emit(EditorActionType.InsertText, e, {
          data: e.data,
          inputType: e.inputType,
          prevSelection: beforeSelection
        })
        break

      case 'deleteContentBackward':
        this.emit(EditorActionType.DeleteBackward, e, {
          inputType: e.inputType,
          prevSelection: beforeSelection
        })
        break

      case 'deleteContentForward':
        this.emit(EditorActionType.DeleteForward, e, {
          inputType: e.inputType,
          prevSelection: beforeSelection
        })
        break

      // 💡 改进 2: 增加对标准换行 (Enter) 的支持
      case 'insertParagraph': 
        this.emit(EditorActionType.InsertLineBreak, e, {
          inputType: e.inputType,
          prevSelection: beforeSelection,
          data: '\n' // 显式标记为换行符
        })
        break;

      case 'insertLineBreak': // Shift + Enter
        this.emit(EditorActionType.InsertLineBreak, e, {
          inputType: e.inputType,
          prevSelection: beforeSelection,
          data: '\n'
        })
        break

      default:
        // 对于粘贴、拖拽等操作，也可以先作为一个 Unknown 或 GenericInput 抛出去
        this.emit(EditorActionType.Unknown, e, {
          inputType: e.inputType,
          prevSelection: beforeSelection
        })
    }

    // preventDefault() 阻止了浏览器默认输入行为，input 事件不会触发，
    // 所以需要在这里手动重置 inInputTransaction，否则 onKeyDown 会被永久阻塞
    this.inInputTransaction = false
    this.pendingMutations = []
  }

  private onInput = (e: Event) => {
    // 处理 Mutation（如果有）
    if (this.pendingMutations.length > 0) {
      this.emit(EditorActionType.DomMutated, e, {
        mutations: this.pendingMutations.slice(),
        prevSelection: this.lastSelectionSnapshot
      })
    }
    
    // input 结束后，更新一下最新的选区快照
    this.lastSelectionSnapshot = this.captureSelection()
    
    this.inInputTransaction = false
    this.pendingMutations = []
  }

  // -------------------------
  // Keyboard fallback
  // -------------------------

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.inInputTransaction) return

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const selection = window.getSelection()
      if (!selection || !selection.anchorNode) return

      const blockEl = getBlockAnchor(selection.anchorNode)
      if (!blockEl) return

      const caretRect = getCaretRect(selection)
      if (!caretRect) return

      // 始终拦截上下键，避免浏览器默认行为在 flex 布局中产生异常
      e.preventDefault()

      const direction = e.key === 'ArrowDown' ? 'down' : 'up'
      this.emit(
        direction === 'down' ? EditorActionType.MoveCursorDown : EditorActionType.MoveCursorUp,
        null,
        { data: String(caretRect.left) }
      )
    }

    // 示例：拦截 Undo (如果我们要自己做历史记录的话)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault()
    }
  }

  // -------------------------
  // Selection
  // -------------------------

  private onSelectionChange = () => {
    if (!this.isSelectionInEditor()) return

    const current = this.captureSelection()
    this.emit(EditorActionType.Select, null, {
        selection: current,
        prevSelection: this.lastSelectionSnapshot
    })
    
    this.lastSelectionSnapshot = current
  }

  // -------------------------
  // Clipboard
  // -------------------------

  private onCopy = (e: ClipboardEvent) => {
    this.emit(EditorActionType.Copy, e)
  }

  private onCut = (e: ClipboardEvent) => {
    this.emit(EditorActionType.Cut, e)
  }

  private onPaste = (e: ClipboardEvent) => {
    this.emit(EditorActionType.Paste, e, {
      data: e.clipboardData?.getData('text/plain') ?? null
    })
  }

  // -------------------------
  // IME
  // -------------------------

  private onCompositionStart = (e: CompositionEvent) => {
    this.isComposing = true
    this.emit(EditorActionType.CompositionStart, e)
  }

  private onCompositionUpdate = (e: CompositionEvent) => {
    this.emit(EditorActionType.CompositionUpdate, e)
    e.preventDefault()
  }

  private onCompositionEnd = (e: CompositionEvent) => {
    this.isComposing = false
    this.emit(EditorActionType.CompositionEnd, e, {
      data: e.data
    })
  }
}




function getCaretRect(selection: Selection): DOMRect | null {
  if (selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0).cloneRange()
  range.collapse(true)

  const rects = range.getClientRects()
  if (rects.length > 0) {
    return rects[0]
  }

  return range.getBoundingClientRect()
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
