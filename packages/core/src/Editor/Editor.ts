import { DocumentController } from '../utils/DocumentController';
import { DOMController } from '../utils/DOMController';
import { DOMScheduler } from '../utils/DOMScheduler';
import { HistoryManager, type CursorInfo } from '../utils/HistoryManager';
import { EditorView } from './EditorView';
import { EditorActionType, EventController, type EditorActionContext, type SelectionSnapshot } from './EditorEventController';
import { BlockModel, BlockVisualState, ListItemBlock, INLINE_FLAG, HeadingBlock, BlockquoteBlock, CodeBlock, TableBlock, InlineModel } from '../types';

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
  /** 跨 block 选区模式：记录涉及的 block ID 列表和精确偏移量 */
  private crossBlockSelection: {
    blockIds: string[]
    /** anchor 端的 block ID（拖选起点，在整个拖选过程中固定） */
    anchorBlockId: string
    /** anchor 端的 raw offset（在首次进入跨 block 模式时、collapse 之前计算，之后不变） */
    anchorRawOffset: number
    /** focus 端的 block ID（拖选终点，随鼠标移动而更新） */
    focusBlockId: string
    /** focus 端的 raw offset（每次 selectionchange 都重新计算） */
    focusRawOffset: number
  } | null = null
  /** 跨 block 选区展开的 rAF handle（下一帧渲染前展开，延迟极小且自动合并同帧内的多次调用） */
  private crossBlockExpandRaf: number | null = null

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
    this.controller = new EventController(this.view.area, action => {
    // 这里只做分发，不直接改 DOM
      this.handleEditorAction(action)
      // 修改操作完成后，通知内容变化
      this.notifyContentChange()
    })

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
      type === EditorActionType.CompositionEnd ||
      type === EditorActionType.FormatToggle ||
      type === EditorActionType.Indent ||
      type === EditorActionType.Outdent ||
      type === EditorActionType.Drop
    )
    if (isMutatingAction) {
      const cursorInfo = this.getCurrentCursorInfo(selection)
      this.history.pushSnapshot(this.doc.blocks, cursorInfo)
    }

    // ========== 跨 Block 选区的修改操作 ==========
    // 当处于跨 block 选区模式时，InsertText/Delete/InsertLineBreak 需要
    // 先删除选区覆盖的所有内容，合并首尾 block，再执行后续操作
    if (this.crossBlockSelection && isMutatingAction && type !== EditorActionType.CompositionEnd) {
      const saved = this.crossBlockSelection
      this.crossBlockSelection = null

      if (saved.blockIds.length >= 2) {
        const insertText = type === EditorActionType.InsertText ? (data ?? '') : ''
        this.handleCrossBlockReplace(saved, insertText)
        return
      }
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

    if (type === EditorActionType.InsertText) {
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      if (!block || !root) return

      // 当 block 处于展开模式时，所有输入都走全行 reconcile 路径
      // 因为展开模式下标记符是可见文本，任何输入都可能影响标记符的配对关系
      const isExpanded = this.dom.getExpandedBlockId() === block.id

      if (this.tryHandleMarkdownAutoComplete(block, root, selection!, data ?? '', isExpanded)) {
        return
      }
      
      if (isExpanded) {
        // 展开模式：如果有选区，先删除选中内容
        if (!selection!.isCollapsed) {
          this.handleReplaceSelection(block, root, selection!, data!)
        } else {
          this.handleInsertInMarker(block, root, selection!.anchorNode!, selection!.anchorOffset, data!)
        }
        return  // 已处理完展开/收起和光标定位，不再执行末尾逻辑
      } else {
        // 正常路径：字符级 insertText
        const offset = computeSemanticOffset(root, selection!.anchorNode!, selection!.anchorOffset, this.doc.prefixOffset(block.id))
        if (offset === null) return
        this.scheduler.insertText(block.id, offset, data!, offset + data!.length)
      }
    }

    // ========== 粘贴处理（支持多行） ==========
    if (type === EditorActionType.Paste) {
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      if (!block || !root || !data) return

      const isExpanded = this.dom.getExpandedBlockId() === block.id

      // 有选区时，先删除选中内容，再粘贴
      if (!selection!.isCollapsed && isExpanded) {
        const range = getSelectionRawRange(root, selection!)
        if (!range) return
        const rawText = this.doc.getRawText(block.id)
        const collapsedRawText = rawText.slice(0, range.start) + rawText.slice(range.end)
        // 更新 model 到删除选区后的状态
        if (collapsedRawText.trim() === '') {
          const blankBlock = { id: block.id, type: 'blank' as const, inline: [] as any[] }
          this.doc.blocks.set(block.id, blankBlock)
          this.dom.replaceBlock(block, blankBlock)
        } else {
          const effect = this.doc.reconcileFromRawText(block.id, collapsedRawText)
          if (effect && effect.kind === 'block-transform') {
            this.dom.replaceBlock(effect.from, effect.to)
          }
        }
        // 在删除后的位置粘贴（创建一个模拟的 collapsed selection snapshot）
        const collapsedBlock = this.doc.getBlock(block.id)
        if (!collapsedBlock) return
        this.dom.forceResetExpanded()
        this.dom.renderBlockExpanded(collapsedBlock)
        // 将粘贴内容插入到 range.start 位置
        const pasteRawText = this.doc.getRawText(block.id)
        const newRawText = pasteRawText.slice(0, range.start) + data + pasteRawText.slice(range.start)
        // 多行检测
        const lines = newRawText.split('\n')
        if (lines.length <= 1 || collapsedBlock.type === 'code-block') {
          this.applyRawReconcile(collapsedBlock, newRawText, range.start + data.length)
        } else {
          // 多行粘贴需要拆分处理
          this.dom.forceResetExpanded()
          const pasteLines = data.split('\n')
          const beforeCursor = pasteRawText.slice(0, range.start)
          const afterCursor = pasteRawText.slice(range.start)
          const firstLineRaw = beforeCursor + pasteLines[0]
          const lastLineRaw = pasteLines[pasteLines.length - 1] + afterCursor
          const firstEffect = this.doc.reconcileFromRawText(block.id, firstLineRaw.trim() === '' ? '' : firstLineRaw)
          if (!firstEffect) return
          if (firstEffect.kind === 'code-block-degrade') return
          const updatedBlock = firstEffect.kind === 'block-transform' ? firstEffect.to : firstEffect.block
          this.dom.replaceBlock(collapsedBlock, updatedBlock)
          let prevBlock = updatedBlock
          for (let i = 1; i < pasteLines.length - 1; i++) {
            const nb = this.doc.createBlockFromRawText(pasteLines[i], prevBlock.id)
            this.dom.insertBlock(prevBlock, nb)
            prevBlock = nb
          }
          const lastBlock = this.doc.createBlockFromRawText(lastLineRaw, prevBlock.id)
          this.dom.insertBlock(prevBlock, lastBlock)
          this.dom.renderBlockExpanded(lastBlock)
          const cursorPos = lastLineRaw.length - afterCursor.length
          this.dom.setCursorByRawOffset(lastBlock.id, Math.max(0, cursorPos))
          this.dom.clearHighlight()
          this.scheduler.highlightBlock(lastBlock.id, BlockVisualState.active)
          this.skipNextSelectionAction = true
        }
        return
      }

      const lines = data.split('\n')

      if (lines.length <= 1) {
        // 单行粘贴：走普通插入逻辑
        if (isExpanded) {
          this.handleInsertInMarker(block, root, selection!.anchorNode!, selection!.anchorOffset, data)
        } else {
          const offset = computeSemanticOffset(root, selection!.anchorNode!, selection!.anchorOffset, this.doc.prefixOffset(block.id))
          if (offset === null) return
          this.scheduler.insertText(block.id, offset, data, offset + data.length)
        }
      } else {
        // 多行粘贴：第一行插入当前 block，其余行创建新 block
        this.handlePasteMultiLine(block, root, selection!, lines, isExpanded)
        return
      }
    }

    if (type === EditorActionType.CompositionStart) {
      const block = this.doc.getBlock(getIdFromBlock(selection!.anchorNode!))
      const root = getBlockAnchor(selection!.anchorNode!)
      if (!block || !root) return

      // 当 block 处于展开模式时，所有 IME 输入都走 reconcile 路径
      const isExpanded = this.dom.getExpandedBlockId() === block.id

      if (isExpanded) {
        // 展开模式：如果有选区，先删除选中内容
        let rawOffset: number | null = null
        if (!selection!.isCollapsed) {
          const range = getSelectionRawRange(root, selection!)
          if (!range) return
          const rawText = this.doc.getRawText(block.id)
          const collapsedRawText = rawText.slice(0, range.start) + rawText.slice(range.end)
          // 更新 model
          if (collapsedRawText.trim() === '') {
            const blankBlock = { id: block.id, type: 'blank' as const, inline: [] as any[] }
            this.doc.blocks.set(block.id, blankBlock)
            this.dom.replaceBlock(block, blankBlock)
            this.dom.forceResetExpanded()
            this.dom.renderBlockExpanded(blankBlock)
            rawOffset = 0
          } else {
            const effect = this.doc.reconcileFromRawText(block.id, collapsedRawText)
            if (effect && effect.kind === 'block-transform') {
              this.dom.replaceBlock(effect.from, effect.to)
            }
            this.dom.forceResetExpanded()
            const updatedBlock = this.doc.getBlock(block.id)
            if (updatedBlock) this.dom.renderBlockExpanded(updatedBlock)
            rawOffset = range.start
          }
        } else {
          rawOffset = computeRawOffset(root, selection!.anchorNode!, selection!.anchorOffset)
          // 空行（blank block）展开后只有零宽空格，强制 rawOffset 为 0
          if (block.type === 'blank') {
            rawOffset = 0
          } else if (rawOffset === null) {
            return
          }
        }

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
        // 有选区时，直接删除选中内容（不区分 Backward/Forward）
        if (!selection!.isCollapsed) {
          this.handleReplaceSelection(block, root, selection!, '')
          return
        }

        // 空行按 Backspace：直接合并到前一个 block
        if (block.type === 'blank' && type === EditorActionType.DeleteBackward) {
          this.handleMergeWithPreviousBlock(block.id)
          return
        }

        // 展开模式：使用 raw text 方式删除
        const rawText = this.doc.getRawText(block.id)
        const rawOffset = computeRawOffset(root, selection!.anchorNode!, selection!.anchorOffset)
        if (rawOffset === null) return

        // 获取结构性前缀长度（indent + list marker / heading marker 等）
        const prefixLen = this.doc.prefixOffset(block.id)

        let newRawText: string
        let newCursorRawOffset: number

        if (type === EditorActionType.DeleteBackward) {
          if (rawOffset <= 0) {
            // 光标在 block 最开头，需要跨 Block 合并
            this.handleMergeWithPreviousBlock(block.id)
            return
          }

          // 光标在结构性前缀区域内（indent / list marker / heading marker）
          if (rawOffset <= prefixLen) {
            this.handleDeleteInPrefix(block, rawText, rawOffset)
            return
          }

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
          const blankBlock = { id: block.id, type: 'blank' as const, inline: [] as any[] }
          this.doc.blocks.set(block.id, blankBlock)
          this.dom.replaceBlock(block, blankBlock)
          return
        }

        this.applyRawReconcile(block, newRawText, newCursorRawOffset)
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

      const isExpanded = this.dom.getExpandedBlockId() === block.id

      if (isExpanded) {
        // 有选区时，先删除选中内容，再在删除后的位置换行
        let effectiveRawText = this.doc.getRawText(block.id)
        let effectiveRawOffset: number | null = null

        if (!selection!.isCollapsed) {
          const range = getSelectionRawRange(root, selection!)
          if (!range) return
          const { start, end } = range
          effectiveRawText = effectiveRawText.slice(0, start) + effectiveRawText.slice(end)
          effectiveRawOffset = start
          // 先更新 model
          const tempEffect = this.doc.reconcileFromRawText(block.id, effectiveRawText.trim() === '' ? '' : effectiveRawText)
          if (!tempEffect) return
          if (tempEffect.kind === 'block-transform') {
            this.dom.replaceBlock(tempEffect.from, tempEffect.to)
          }
          // 用删除后的 block 继续换行流程
          const updatedBlock2 = this.doc.getBlock(block.id)
          if (!updatedBlock2) return
          // 重新取 rawText（reconcile 可能改变了 block 类型）
          effectiveRawText = this.doc.getRawText(block.id)
        } else {
          effectiveRawOffset = computeRawOffset(root, selection!.anchorNode!, selection!.anchorOffset)
        }

        const rawText = effectiveRawText
        const rawOffset = effectiveRawOffset
        const currentBlock = this.doc.getBlock(block.id) ?? block

        // 代码块换行：在代码块内容中插入换行符，不拆分 block
        // 自动保持当前行的缩进
        if (currentBlock.type === 'code-block') {
          let effectiveOff = rawOffset ?? 0
          const firstLineBreak = rawText.indexOf('\n')

          // 光标在开头 fence / 语言标记行时，Enter 创建第 1 行空代码行。
          if (firstLineBreak !== -1 && effectiveOff <= firstLineBreak) {
            const newRawText = rawText.slice(0, firstLineBreak + 1) + '\n' + rawText.slice(firstLineBreak + 1)
            this.applyRawReconcile(currentBlock, newRawText, firstLineBreak + 1)
            return
          }

          // 找到当前行的行首，提取缩进
          const lineStart = rawText.lastIndexOf('\n', effectiveOff - 1) + 1
          const currentLine = rawText.slice(lineStart, effectiveOff)
          const indentMatch = currentLine.match(/^(\s*)/)
          const indent = indentMatch ? indentMatch[1] : ''
          const newRawText = rawText.slice(0, effectiveOff) + '\n' + indent + rawText.slice(effectiveOff)
          this.applyRawReconcile(currentBlock, newRawText, effectiveOff + 1 + indent.length)
          return
        }

        // 空行换行：直接创建新空行
        if (block.type === 'blank') {
          this.dom.collapseBlock(block)
          this.dom.forceResetExpanded()
          this.dom.replaceBlock(block, block)
          const newBlock = this.doc.createBlockFromRawText('', block.id)
          this.dom.insertBlock(block, newBlock)
          this.dom.renderBlockExpanded(newBlock)
          this.dom.setCursorByRawOffset(newBlock.id, 0)
          this.dom.clearHighlight()
          this.scheduler.highlightBlock(newBlock.id, BlockVisualState.active)
          this.skipNextSelectionAction = true
          return
        }

        if (rawOffset === null) return

        const completedCodeBlock = this.tryCompleteCodeBlockFromOpeningFence(currentBlock, rawText, rawOffset)
        if (completedCodeBlock) return

        // ========== 列表项 Enter 行为增强 ==========
        if (currentBlock.type === 'list-item') {
          const listItem = currentBlock as ListItemBlock
          const prefixLen = this.doc.prefixOffset(currentBlock.id)
          const contentAfterPrefix = rawText.slice(prefixLen).trim()

          // 空列表项按 Enter → 退出列表（变为空行）
          if (contentAfterPrefix === '') {
            this.dom.collapseBlock(block)
            this.dom.forceResetExpanded()
            const blankBlock: BlockModel = { id: block.id, type: 'blank', inline: [] }
            this.doc.blocks.set(block.id, blankBlock)
            this.dom.replaceBlock(currentBlock, blankBlock)
            this.dom.renderBlockExpanded(blankBlock)
            this.dom.setCursorByRawOffset(blankBlock.id, 0)
            this.dom.clearHighlight()
            this.scheduler.highlightBlock(blankBlock.id, BlockVisualState.active)
            this.skipNextSelectionAction = true
            return
          }

          // 非空列表项按 Enter → 拆分，新行继承列表结构（缩进 + marker）
          const beforeRaw = rawText.slice(0, rawOffset)
          const afterContent = rawText.slice(rawOffset)

          this.dom.collapseBlock(block)
          this.dom.forceResetExpanded()

          // 更新当前 block（前半部分）
          const effect = this.doc.reconcileFromRawText(block.id, beforeRaw.trim() === '' ? '' : beforeRaw)
          if (!effect) return
          if (effect.kind === 'code-block-degrade') return
          const updatedBlock = effect.kind === 'block-transform' ? effect.to : effect.block
          this.dom.replaceBlock(block, updatedBlock)

          // 构造新行的 raw text：继承缩进 + marker 前缀 + 光标后的内容
          const indent = (currentBlock.nesting ?? 0) > 0 ? ' '.repeat(currentBlock.nesting!) : ''
          let newMarker: string
          if (listItem.style.ordered) {
            // 有序列表：自动递增序号
            const orderNum = parseInt(listItem.style.order) || 1
            newMarker = `${orderNum + 1}. `
          } else {
            newMarker = '- '
          }
          const newLineRaw = indent + newMarker + afterContent

          const newBlock = this.doc.createBlockFromRawText(newLineRaw, updatedBlock.id)
          this.dom.insertBlock(updatedBlock, newBlock)

          // 展开新 block 并将光标定位到内容开头（prefix 之后）
          this.dom.renderBlockExpanded(newBlock)
          const newPrefixOffset = this.doc.prefixOffset(newBlock.id)
          this.dom.setCursorByRawOffset(newBlock.id, newPrefixOffset)

          this.dom.clearHighlight()
          this.scheduler.highlightBlock(newBlock.id, BlockVisualState.active)
          this.skipNextSelectionAction = true
          return
        }

        // 展开模式：用 raw offset 切割 raw text，对两半分别重新解析
        const beforeRaw = rawText.slice(0, rawOffset)
        const afterRaw = rawText.slice(rawOffset)

        // 先收起旧 block 的展开状态
        this.dom.collapseBlock(block)
        this.dom.forceResetExpanded()

        // 重新解析前半部分（更新当前 block）
        const effect = this.doc.reconcileFromRawText(block.id, beforeRaw.trim() === '' ? '' : beforeRaw)
        if (!effect) return
        
        if (effect.kind === 'code-block-degrade') {
          // 代码块在换行时退化，按行拆分
          this.handleCodeBlockDegrade(effect.from, effect.lines, rawOffset)
          return
        }
        
        const updatedBlock = effect.kind === 'block-transform' ? effect.to : effect.block
        // replaceBlock 渲染非展开模式
        this.dom.replaceBlock(block, updatedBlock)

        // 创建新 block 并解析后半部分
        const newBlock = this.doc.createBlockFromRawText(afterRaw, updatedBlock.id)
        // 插入到 DOM
        this.dom.insertBlock(updatedBlock, newBlock)

        // 展开新 block 并定位光标
        this.dom.renderBlockExpanded(newBlock)
        const newPrefixOffset = this.doc.prefixOffset(newBlock.id)
        this.dom.setCursorByRawOffset(newBlock.id, newPrefixOffset)

        // 高亮新 block
        this.dom.clearHighlight()
        this.scheduler.highlightBlock(newBlock.id, BlockVisualState.active)
        this.skipNextSelectionAction = true
        return
      } else {
        const offset = computeSemanticOffset(root, selection!.anchorNode!, selection!.anchorOffset, this.doc.prefixOffset(block.id))
        if (offset === null) return
        const rawText = this.doc.getRawText(block.id)
        const completedCodeBlock = this.tryCompleteCodeBlockFromOpeningFence(block, rawText, offset)
        if (completedCodeBlock) return
        this.scheduler.handleInsertLineBreak(block.id, offset)
      }
    }

    // ========== 图片拖拽上传处理 ==========
    if (type === EditorActionType.Drop) {
      const files = action.files
      if (files && files.length > 0) {
        this.handleImageDrop(selection, files)
      }
      return
    }

    // ========== 链接 hover 弹窗处理 ==========
    if (type === EditorActionType.LinkClick) {
      if (data) {
        try {
          const linkInfo = JSON.parse(data)
          this.handleLinkHover(linkInfo, action.linkElement ?? null)
        } catch {}
      }
      return
    }

    // ========== 图片 hover 弹窗处理 ==========
    if (type === EditorActionType.ImageHover) {
      if (data) {
        try {
          const imageInfo = JSON.parse(data)
          this.handleImageHover(imageInfo)
        } catch {}
      }
      return
    }

    // ========== 格式化快捷键处理 ==========
    if (type === EditorActionType.FormatToggle) {
      this.handleFormatToggle(selection, data ?? '')
      return
    }

    // ========== Tab / Shift+Tab 缩进处理 ==========
    if (type === EditorActionType.Indent || type === EditorActionType.Outdent) {
      this.handleIndent(selection, type === EditorActionType.Indent ? 'indent' : 'outdent')
      return
    }

    // ========== Copy / Cut 处理 ==========
    if (type === EditorActionType.Copy || type === EditorActionType.Cut) {
      if (selection && nativeEvent) {
        const text = this.getSelectedText(selection)
        if (text) {
          const clipboardEvent = nativeEvent as ClipboardEvent
          clipboardEvent.clipboardData?.setData('text/plain', text)
        }
        // Cut: 复制后还需要删除选中内容（暂不实现跨 block 删除，仅做复制）
      }
      return
    }

    // ========== 跳过 Undo/Redo 或展开操作后紧随的 SelectionChange ==========
    if (this.skipNextSelectionAction && type === EditorActionType.Select) {
      this.skipNextSelectionAction = false

      // skip 时仍需检测：如果选区已回到单 block/collapsed，需要清理跨 block 状态
      const isCurrentCrossBlock = selection && !selection.isCollapsed && selection.anchorNode && selection.focusNode &&
        getIdFromBlock(selection.anchorNode) !== getIdFromBlock(selection.focusNode) &&
        getIdFromBlock(selection.anchorNode) !== '' && getIdFromBlock(selection.focusNode) !== ''

      if (isCurrentCrossBlock) {
        // 选区仍是跨 block 的，这是我们重建选区触发的 selectionchange，直接跳过
        return
      }

      // 选区已回到单 block/collapsed，需要清理跨 block 状态
      if (this.crossBlockExpandRaf !== null) {
        cancelAnimationFrame(this.crossBlockExpandRaf)
        this.crossBlockExpandRaf = null
      }
      if (this.crossBlockSelection) {
        this.crossBlockSelection = null
      }
      if (this.dom.isMultiExpanded()) {
        this.dom.collapseAllMultiExpanded(this.doc.blocks)
      }
      // 不 return，继续执行后面的单 block 展开/高亮逻辑
    }

    // ========== 跨 Block 选中检测 ==========
    if (selection && !selection.isCollapsed && selection.anchorNode && selection.focusNode) {
      const anchorBlockId = getIdFromBlock(selection.anchorNode)
      const focusBlockId = getIdFromBlock(selection.focusNode)
      if (anchorBlockId && focusBlockId && anchorBlockId !== focusBlockId) {
        const blockIds = this.getBlockIdsBetween(anchorBlockId, focusBlockId)

        // 辅助函数：根据 block 的展开状态计算 raw offset
        const calcRawOffset = (blockId: string, node: Node, offset: number): number | null => {
          const blockEl = this.dom.getNodeById(blockId)
          if (!blockEl) return null
          const isBlockExpanded = this.dom.getExpandedBlockId() === blockId
          const isBlockMultiExpanded = this.dom.isBlockMultiExpanded(blockId)
          if (isBlockExpanded || isBlockMultiExpanded) {
            return computeRawOffset(blockEl, node, offset)
          }
          // 代码块等没有 .md-inline-content 的 block 类型，直接用 computeRawOffset
          const block = this.doc.getBlock(blockId)
          if (block && (block.type === 'code-block' || block.type === 'hr' || block.type === 'blank')) {
            return computeRawOffset(blockEl, node, offset)
          }
          return computeSemanticOffset(blockEl, node, offset, this.doc.prefixOffset(blockId))
        }

        // 计算 focus 端 raw offset（不展开 block，保留浏览器原生选区）
        const focusRawOff = calcRawOffset(focusBlockId, selection.focusNode, selection.focusOffset)

        if (this.crossBlockSelection) {
          // 已处于跨 block 模式：anchor 端不变，只更新 focus 端和 block 范围
          if (focusRawOff !== null) {
            this.crossBlockSelection.blockIds = blockIds
            this.crossBlockSelection.focusBlockId = focusBlockId
            this.crossBlockSelection.focusRawOffset = focusRawOff
          }
        } else {
          // 首次进入跨 block 模式：计算 anchor 端 raw offset
          const anchorRawOff = calcRawOffset(anchorBlockId, selection.anchorNode, selection.anchorOffset)

          if (anchorRawOff !== null && focusRawOff !== null) {
            this.crossBlockSelection = {
              blockIds,
              anchorBlockId,
              anchorRawOffset: anchorRawOff,
              focusBlockId,
              focusRawOffset: focusRawOff
            }
          }
        }

        // 高亮涉及的 block
        this.dom.clearHighlight()
        for (let i = 0; i < blockIds.length; i++) {
          const pos = blockIds.length === 1 ? 'only' as const
            : i === 0 ? 'first' as const
            : i === blockIds.length - 1 ? 'last' as const
            : 'middle' as const
          this.dom.highlightBlock(blockIds[i], BlockVisualState.active, pos)
        }

        // 防抖展开：选区变化停止后延迟展开，避免拖选/键盘选择过程中破坏原生选区
        this.scheduleCrossBlockExpand()
        return
      }
    }

    // 如果之前处于跨 block 选区模式，但现在选区回到了单 block 或 collapsed，
    // 需要清除跨 block 选区状态，取消 pending rAF，并收起之前展开的 block
    if (this.crossBlockSelection || this.crossBlockExpandRaf !== null) {
      if (this.crossBlockExpandRaf !== null) {
        cancelAnimationFrame(this.crossBlockExpandRaf)
        this.crossBlockExpandRaf = null
      }
      this.crossBlockSelection = null
    }

    // 如果之前处于多 block 展开状态，但现在选区回到了单 block 或 collapsed，
    // 需要收起多 block 展开状态
    if (this.dom.isMultiExpanded()) {
      this.dom.collapseAllMultiExpanded(this.doc.blocks)
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

    
  /**
   * 处理多行粘贴
   * 第一行内容插入当前 block 的光标位置，
   * 后续每行各创建一个新 block 并按顺序插入
   */
  private handlePasteMultiLine(
    block: BlockModel,
    blockEl: HTMLElement,
    selection: SelectionSnapshot,
    lines: string[],
    isExpanded: boolean
  ) {
    // 1. 获取当前光标在 raw text 中的位置
    const rawText = this.doc.getRawText(block.id)
    const rawOffset = computeRawOffset(blockEl, selection.anchorNode!, selection.anchorOffset)
    if (rawOffset === null) return

    // 2. 将第一行内容插入当前 block 的光标位置，
    //    同时把光标之后的内容拼接到最后一行
    const beforeCursor = rawText.slice(0, rawOffset)
    const afterCursor = rawText.slice(rawOffset)
    const firstLineRaw = beforeCursor + lines[0]
    const lastLineRaw = lines[lines.length - 1] + afterCursor

    // 3. 收起展开状态
    if (isExpanded) {
      this.dom.collapseBlock(block)
      this.dom.forceResetExpanded()
    }

    // 4. 用第一行内容更新当前 block
    const effect = this.doc.reconcileFromRawText(block.id, firstLineRaw.trim() === '' ? '' : firstLineRaw)
    if (!effect) return
    if (effect.kind === 'code-block-degrade') return
    const updatedBlock = effect.kind === 'block-transform' ? effect.to : effect.block
    this.dom.replaceBlock(block, updatedBlock)

    // 5. 创建中间行的 block（如果超过两行）
    let prevBlock = updatedBlock
    for (let i = 1; i < lines.length - 1; i++) {
      const newBlock = this.doc.createBlockFromRawText(lines[i], prevBlock.id)
      this.dom.insertBlock(prevBlock, newBlock)
      prevBlock = newBlock
    }

    // 6. 创建最后一行的 block
    const lastBlock = this.doc.createBlockFromRawText(lastLineRaw, prevBlock.id)
    this.dom.insertBlock(prevBlock, lastBlock)

    // 7. 展开最后一个 block 并定位光标
    this.dom.renderBlockExpanded(lastBlock)
    // 光标定位到粘贴内容末尾（即最后一行粘贴文本的末尾，afterCursor 之前）
    const cursorRawOffset = lastLineRaw.length - afterCursor.length
    const lastPrefixOffset = this.doc.prefixOffset(lastBlock.id)
    this.dom.setCursorByRawOffset(lastBlock.id, Math.max(lastPrefixOffset, cursorRawOffset))

    // 8. 高亮
    this.dom.clearHighlight()
    this.scheduler.highlightBlock(lastBlock.id, BlockVisualState.active)
    this.skipNextSelectionAction = true
  }

  /**
   * 处理在结构性前缀区域（indent / list marker / heading marker）按 Backspace
   * 
   * 策略（按优先级）：
   * 1. 光标在 indent 区域内（rawOffset <= nesting）→ 删除 1 个字符（空格）
   * 2. 光标在 list marker 区域 → 将 list-item 转为 paragraph（去除 marker）
   * 3. 光标在 heading marker 区域 → 将 heading 转为 paragraph（去除 marker）
   * 4. 光标在 blockquote marker 区域 → 将 blockquote 转为 paragraph
   * 5. 其他情况 → merge with previous block
   */
  private handleDeleteInPrefix(block: BlockModel, rawText: string, rawOffset: number) {
    const nesting = block.nesting ?? 0

    if (nesting > 0 && rawOffset <= nesting) {
      // 光标在 indent 区域：只删除 1 个字符（与正常 Backspace 行为一致）
      const newRawText = rawText.slice(0, rawOffset - 1) + rawText.slice(rawOffset)
      const newCursorRawOffset = rawOffset - 1

      if (newRawText.trim() === '') {
        const blankBlock = { id: block.id, type: 'blank' as const, inline: [] as any[] }
        this.doc.blocks.set(block.id, blankBlock)
        this.dom.replaceBlock(block, blankBlock)
        return
      }

      this.applyRawReconcile(block, newRawText, newCursorRawOffset)
      return
    }

    // 光标在 marker 区域（rawOffset > nesting && rawOffset <= prefixLen）
    // 去除整个 marker，只保留 indent（如有）+ inline 内容
    if (block.type === 'list-item' || block.type === 'heading' || block.type === 'blockquote') {
      // 保留 indent + 纯文本内容（去掉 marker）
      const indentStr = nesting > 0 ? rawText.slice(0, nesting) : ''
      const prefixLen = this.doc.prefixOffset(block.id)
      const contentStr = rawText.slice(prefixLen)
      const newRawText = indentStr + contentStr
      const newCursorRawOffset = nesting  // 光标定位到 indent 末尾（即内容开头）

      if (newRawText.trim() === '') {
        const blankBlock = { id: block.id, type: 'blank' as const, inline: [] as any[] }
        this.doc.blocks.set(block.id, blankBlock)
        this.dom.replaceBlock(block, blankBlock)
        return
      }

      this.applyRawReconcile(block, newRawText, newCursorRawOffset)
      return
    }

    // 其他类型的 block 且光标在前缀区域：直接删除一个字符
    const newRawText = rawText.slice(0, rawOffset - 1) + rawText.slice(rawOffset)
    const newCursorRawOffset = rawOffset - 1

    if (newRawText.trim() === '') {
      const blankBlock = { id: block.id, type: 'blank' as const, inline: [] as any[] }
      this.doc.blocks.set(block.id, blankBlock)
      this.dom.replaceBlock(block, blankBlock)
      return
    }

    this.applyRawReconcile(block, newRawText, newCursorRawOffset)
  }

  /**
   * 处理跨 Block 合并（行首 Backspace）
   * 将当前 block 的内容合并到前一个 block 末尾，删除当前 block，
   * 然后展开合并后的 block 并定位光标到合并点
   */
  private handleMergeWithPreviousBlock(blockId: string) {
    const mergeResult = this.doc.mergeBlockWithPrevious(blockId)
    if (!mergeResult) return

    const { mergedBlock, cursorRawOffset, removedBlockId } = mergeResult

    // 1. 从 DOM 移除被删除的 block 节点
    this.dom.removeBlockNode(removedBlockId)

    // 2. 重新渲染合并后的 block
    this.dom.replaceBlock(mergedBlock, mergedBlock)

    // 3. 展开合并后的 block 并定位光标到合并点
    this.dom.forceResetExpanded()
    this.dom.renderBlockExpanded(mergedBlock)
    this.dom.setCursorByRawOffset(mergedBlock.id, cursorRawOffset)

    // 4. 高亮合并后的 block
    this.dom.clearHighlight()
    this.scheduler.highlightBlock(mergedBlock.id, BlockVisualState.active)

    // 5. 跳过下一次 selectionchange，防止展开/收起闪烁
    this.skipNextSelectionAction = true
  }

  /**
   * 调度跨 block 选区展开（requestAnimationFrame）
   * 每次 selectionchange 检测到跨 block 选区时调用。
   * 同一帧内多次调用只会执行最后一次，延迟极小（~16ms）。
   */
  private scheduleCrossBlockExpand(): void {
    if (this.crossBlockExpandRaf !== null) {
      cancelAnimationFrame(this.crossBlockExpandRaf)
    }
    this.crossBlockExpandRaf = requestAnimationFrame(() => {
      this.crossBlockExpandRaf = null
      this.executeCrossBlockExpand()
    })
  }

  /**
   * 执行跨 block 选区展开
   * 展开所有涉及的 block，用保存的精确 raw offset 重建选区，并高亮。
   */
  private executeCrossBlockExpand(): void {
    if (!this.crossBlockSelection) return
    const saved = this.crossBlockSelection

    // 展开所有涉及的 block
    this.dom.expandMultipleBlocks(saved.blockIds, this.doc.blocks)

    // 用保存的精确 raw offset 重建选区
    this.dom.setSelectionByRawOffsets(
      saved.anchorBlockId, saved.anchorRawOffset,
      saved.focusBlockId, saved.focusRawOffset
    )

    // 高亮涉及的 block
    this.dom.clearHighlight()
    for (let i = 0; i < saved.blockIds.length; i++) {
      const pos = saved.blockIds.length === 1 ? 'only' as const
        : i === 0 ? 'first' as const
        : i === saved.blockIds.length - 1 ? 'last' as const
        : 'middle' as const
      this.dom.highlightBlock(saved.blockIds[i], BlockVisualState.active, pos)
    }

    // 跳过展开操作触发的 selectionchange
    this.skipNextSelectionAction = true
  }

  destroy() {
    // 清理 rAF
    if (this.crossBlockExpandRaf !== null) {
      cancelAnimationFrame(this.crossBlockExpandRaf)
      this.crossBlockExpandRaf = null
    }
    this.controller.destroy()
    this.dom.destroy()
    this.scheduler.destroy()
    this.view.destroy()
  }

  /**
   * 获取完整的 Markdown 源文本
   * 遍历所有 blockModel，逐个调用 getRawText 并用换行符拼接
   */
  getMarkdownSource(): string {
    const lines: string[] = []
    for (const [id] of this.doc.getBlocks()) {
      lines.push(this.doc.getRawText(id))
    }
    return lines.join('\n')
  }

  /**
   * 导出为 HTML 字符串
   * 将所有 block model 转换为语义化 HTML
   */
  exportHTML(): string {
    const parts: string[] = []

    for (const [, block] of this.doc.getBlocks()) {
      parts.push(blockToHTML(block))
    }

    return parts.join('\n')
  }

  /**
   * 查找文档中所有匹配的文本
   * 返回匹配位置数组：[{ blockId, offset, length }]
   */
  findAll(query: string, caseSensitive: boolean = false): { blockId: string; offset: number; length: number }[] {
    if (!query) return []

    const results: { blockId: string; offset: number; length: number }[] = []
    const flags = caseSensitive ? 'g' : 'gi'
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)

    for (const [id] of this.doc.getBlocks()) {
      const rawText = this.doc.getRawText(id)
      let match: RegExpExecArray | null
      while ((match = regex.exec(rawText)) !== null) {
        results.push({ blockId: id, offset: match.index, length: match[0].length })
      }
    }

    return results
  }

  /**
   * 查找并替换文档中所有匹配的文本
   * 返回替换的数量
   */
  replaceAll(query: string, replacement: string, caseSensitive: boolean = false): number {
    if (!query) return 0

    const cursorInfo = this.getCurrentCursorInfo(
      this.controller['captureSelection']?.() ?? null
    )
    this.history.pushSnapshot(this.doc.blocks, cursorInfo)

    let count = 0
    const flags = caseSensitive ? 'g' : 'gi'

    for (const [id] of this.doc.getBlocks()) {
      const rawText = this.doc.getRawText(id)
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
      const newRawText = rawText.replace(regex, () => { count++; return replacement })

      if (newRawText !== rawText) {
        const block = this.doc.getBlock(id)
        if (block) {
          const effect = this.doc.reconcileFromRawText(id, newRawText)
          if (effect && effect.kind !== 'code-block-degrade') {
            const targetBlock = effect.kind === 'block-transform' ? effect.to : effect.block
            if (effect.kind === 'block-transform') {
              this.dom.replaceBlock(effect.from, effect.to)
            } else {
              this.dom.replaceBlock(targetBlock, targetBlock)
            }
          }
        }
      }
    }

    this.notifyContentChange()
    return count
  }

  /**
   * 注册内容变化回调
   * 每次用户编辑操作（insertText、delete、paste、composition、lineBreak、undo/redo）后触发
   */
  onContentChange(callback: (markdown: string) => void): void {
    this.onChange = callback
  }

  /**
   * 通知内容变化（内部方法）
   */
  private notifyContentChange(): void {
    if (this.onChange) {
      this.onChange(this.getMarkdownSource())
    }
  }

  /**
   * 获取当前选区中的文本内容
   * 支持跨 Block 选中：收集选区覆盖的所有 block 的语义文本，用换行拼接
   */
  private getSelectedText(selection: SelectionSnapshot): string | null {
    if (!selection || !selection.anchorNode || !selection.focusNode) return null
    if (selection.isCollapsed) return null

    const anchorBlockId = getIdFromBlock(selection.anchorNode)
    const focusBlockId = getIdFromBlock(selection.focusNode)

    if (!anchorBlockId || !focusBlockId) return null

    // 同一个 block 内的选中：直接取浏览器原生选区文本
    if (anchorBlockId === focusBlockId) {
      const sel = window.getSelection()
      return sel?.toString() ?? null
    }

    // 跨 block 选中：收集所有涉及的 block 的 raw text，用换行拼接
    const blockIds = this.getBlockIdsBetween(anchorBlockId, focusBlockId)
    if (blockIds.length === 0) return null

    const texts: string[] = []
    for (const blockId of blockIds) {
      const rawText = this.doc.getRawText(blockId)
      if (rawText) texts.push(rawText)
    }

    return texts.join('\n')
  }

  /**
   * 获取两个 block 之间（包含两端）的所有 block ID，按 DOM 顺序排列
   */
  private getBlockIdsBetween(startId: string, endId: string): string[] {
    const blockIds = Array.from(this.doc.getBlocks().keys())
    const startIdx = blockIds.indexOf(startId)
    const endIdx = blockIds.indexOf(endId)
    if (startIdx === -1 || endIdx === -1) return []

    const from = Math.min(startIdx, endIdx)
    const to = Math.max(startIdx, endIdx)
    return blockIds.slice(from, to + 1)
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
    let rawOffset = computeRawOffset(blockEl, anchorNode, anchorOffset)
    // 空行（blank block）展开后只有零宽空格文本节点，rawOffset 可能是 0 或 1
    // 但 getRawText 返回空字符串，所以强制为 0
    if (block.type === 'blank') {
      rawOffset = 0
    } else if (rawOffset === null) {
      return
    }

    if (block.type === 'code-block' && (block as CodeBlock).code === '') {
      const firstLineBreak = rawText.indexOf('\n')
      if (firstLineBreak !== -1 && rawOffset === firstLineBreak + 1) {
        const newRawText = rawText.slice(0, rawOffset) + text + '\n' + rawText.slice(rawOffset)
        this.applyRawReconcile(block, newRawText, rawOffset + text.length)
        return
      }
    }

    // 3. 将字符插入到原始文本中
    const newRawText = rawText.slice(0, rawOffset) + text + rawText.slice(rawOffset)

    // 4. 全行 reconcile
    this.applyRawReconcile(block, newRawText, rawOffset + text.length)
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
    this.applyRawReconcile(block, newRawText, rawOffset + text.length)
  }

  /**
   * 处理非空选区的替换操作
   * 先删除选中内容，再插入新文本（text 为空表示纯删除）
   */
  private handleReplaceSelection(
    block: BlockModel,
    blockEl: HTMLElement,
    selection: SelectionSnapshot,
    text: string
  ) {
    const range = getSelectionRawRange(blockEl, selection)
    if (!range) return

    const { start, end } = range
    const rawText = this.doc.getRawText(block.id)
    const newRawText = rawText.slice(0, start) + text + rawText.slice(end)
    const newCursorOffset = start + text.length

    if (newRawText.trim() === '') {
      // 删除后为空，转为 blank block
      const blankBlock = { id: block.id, type: 'blank' as const, inline: [] as any[] }
      this.doc.blocks.set(block.id, blankBlock)
      this.dom.replaceBlock(block, blankBlock)
      this.dom.forceResetExpanded()
      this.dom.renderBlockExpanded(blankBlock)
      this.dom.setCursorByRawOffset(blankBlock.id, 0)
      return
    }

    this.applyRawReconcile(block, newRawText, newCursorOffset)
  }

  /**
   * 通用的 rawText reconcile 处理：处理 inline-update、block-transform、code-block-degrade
   */
  private applyRawReconcile(block: BlockModel, newRawText: string, cursorRawOffset: number) {
    const effect = this.doc.reconcileFromRawText(block.id, newRawText)
    if (!effect) return

    if (effect.kind === 'code-block-degrade') {
      // 代码块语法被破坏，退化为多行 block
      this.handleCodeBlockDegrade(effect.from, effect.lines, cursorRawOffset)
      return
    }

    const targetBlock = effect.kind === 'block-transform' ? effect.to : effect.block

    if (effect.kind === 'block-transform') {
      this.dom.replaceBlock(effect.from, effect.to)
    }

    // 强制重置展开状态并重新渲染
    this.dom.forceResetExpanded()
    this.dom.renderBlockExpanded(targetBlock)

    // 用 rawOffset 在新 DOM 中定位光标
    this.dom.setCursorByRawOffset(targetBlock.id, cursorRawOffset)
  }

  private tryHandleMarkdownAutoComplete(
    block: BlockModel,
    root: HTMLElement,
    selection: SelectionSnapshot,
    data: string,
    isExpanded: boolean
  ): boolean {
    if (!selection.isCollapsed || data.length !== 1) return false
    if (block.type === 'code-block') return false

    const rawText = this.doc.getRawText(block.id)
    let rawOffset: number | null

    if (block.type === 'blank') {
      rawOffset = 0
    } else if (isExpanded) {
      rawOffset = computeRawOffset(root, selection.anchorNode!, selection.anchorOffset)
    } else {
      rawOffset = computeSemanticOffset(root, selection.anchorNode!, selection.anchorOffset, this.doc.prefixOffset(block.id))
    }

    if (rawOffset === null) return false

    if (data === '`') {
      const lineStart = rawText.lastIndexOf('\n', rawOffset - 1) + 1
      const lineBeforeCursor = rawText.slice(lineStart, rawOffset)
      const fenceIndent = lineBeforeCursor.match(/^(\s*)``$/)?.[1]

      if (fenceIndent !== undefined && !isEscaped(rawText, rawOffset - 2)) {
        const insertion = `${fenceIndent}\`\`\`\n${fenceIndent}\`\`\``
        const newRawText = rawText.slice(0, lineStart) + insertion + rawText.slice(rawOffset)
        this.applyRawReconcile(block, newRawText, lineStart + fenceIndent.length + 3)
        return true
      }

      if (rawText[rawOffset] === '`' && !isEscaped(rawText, rawOffset)) {
        this.dom.setCursorByRawOffset(block.id, rawOffset + 1)
        return true
      }
    }

    if (!isAutoPairCharacter(data) || isEscaped(rawText, rawOffset)) return false

    const newRawText = rawText.slice(0, rawOffset) + data + data + rawText.slice(rawOffset)
    this.applyRawReconcile(block, newRawText, rawOffset + 1)
    return true
  }

  private tryCompleteCodeBlockFromOpeningFence(
    block: BlockModel,
    rawText: string,
    rawOffset: number
  ): boolean {
    if (block.type === 'code-block') return false

    const beforeRaw = rawText.slice(0, rawOffset)
    const afterRaw = rawText.slice(rawOffset)
    const openingFence = parseOpeningCodeFence(beforeRaw)
    if (!openingFence) return false

    const closingFence = afterRaw.length > 0 ? parseClosingCodeFence(afterRaw) : null
    if (afterRaw.length > 0 && closingFence !== openingFence.marker) return false

    const newRawText = beforeRaw + '\n\n' + (closingFence ?? openingFence.marker)
    this.applyRawReconcile(block, newRawText, beforeRaw.length + 1)
    return true
  }

  /**
   * 处理代码块退化为多行 block
   * 将单个 code-block 替换为多行 paragraph/其他类型的 block
   */
  private handleCodeBlockDegrade(
    oldBlock: BlockModel,
    newBlocks: BlockModel[],
    cursorRawOffset: number
  ) {
    if (newBlocks.length === 0) return

    // 1. 收起展开状态
    this.dom.forceResetExpanded()

    // 2. 第一个 block 直接替换旧的 code-block
    this.dom.replaceBlock(oldBlock, newBlocks[0])

    // 3. 后续 block 逐个插入
    for (let i = 1; i < newBlocks.length; i++) {
      this.dom.insertBlock(newBlocks[i - 1], newBlocks[i])
    }

    // 4. 根据光标 rawOffset 定位到具体的 block 和行内偏移
    // cursorRawOffset 是在整个原始文本中的偏移，需要按行换算
    let accumulated = 0
    for (let i = 0; i < newBlocks.length; i++) {
      const lineRaw = this.doc.getRawText(newBlocks[i].id)
      const lineLen = lineRaw.length
      if (accumulated + lineLen >= cursorRawOffset || i === newBlocks.length - 1) {
        const localOffset = cursorRawOffset - accumulated
        this.dom.renderBlockExpanded(newBlocks[i])
        this.dom.setCursorByRawOffset(newBlocks[i].id, Math.min(localOffset, lineLen))
        this.dom.clearHighlight()
        this.scheduler.highlightBlock(newBlocks[i].id, BlockVisualState.active)
        break
      }
      accumulated += lineLen + 1 // +1 for newline
    }

    this.skipNextSelectionAction = true
  }

  /**
   * 处理跨 Block 选区的替换操作
   * 使用预先保存的精确 raw offset（anchor 端在首次进入跨 block 模式时保存，focus 端每次 selectionchange 更新）
   */
  private handleCrossBlockReplace(
    saved: NonNullable<typeof this.crossBlockSelection>,
    insertText: string
  ) {
    const { blockIds, anchorBlockId, anchorRawOffset, focusBlockId, focusRawOffset } = saved

    // 确定 DOM 顺序
    const anchorIdx = blockIds.indexOf(anchorBlockId)
    const focusIdx = blockIds.indexOf(focusBlockId)
    const isForward = anchorIdx <= focusIdx

    const startBlockId = isForward ? anchorBlockId : focusBlockId
    const endBlockId = isForward ? focusBlockId : anchorBlockId
    const startRawOffset = isForward ? anchorRawOffset : focusRawOffset
    const endRawOffset = isForward ? focusRawOffset : anchorRawOffset

    const startRawText = this.doc.getRawText(startBlockId)
    const endRawText = this.doc.getRawText(endBlockId)

    // 选区前的文本 + 插入内容 + 选区后的文本
    const beforeSelection = startRawText.slice(0, startRawOffset)
    const afterSelection = endRawText.slice(endRawOffset)
    const mergedRawText = beforeSelection + insertText + afterSelection
    const cursorRawOffset = startRawOffset + insertText.length

    // 删除中间和结尾的 block（不包括 startBlock）
    for (let i = 0; i < blockIds.length; i++) {
      if (blockIds[i] === startBlockId) continue
      this.dom.removeBlockNode(blockIds[i])
      this.doc.blocks.delete(blockIds[i])
    }

    // 清除高亮和展开状态
    this.dom.clearHighlight()
    this.dom.forceResetExpanded()

    // 用合并后的文本更新 startBlock
    const currentStartBlock = this.doc.getBlock(startBlockId)
    if (!currentStartBlock) return

    if (mergedRawText.trim() === '') {
      const blankBlock = { id: startBlockId, type: 'blank' as const, inline: [] as any[] }
      this.doc.blocks.set(startBlockId, blankBlock)
      this.dom.replaceBlock(currentStartBlock, blankBlock)
      this.dom.renderBlockExpanded(blankBlock)
      this.dom.setCursorByRawOffset(startBlockId, 0)
    } else {
      this.applyRawReconcile(currentStartBlock, mergedRawText, cursorRawOffset)
    }

    this.dom.clearHighlight()
    this.scheduler.highlightBlock(startBlockId, BlockVisualState.active)
    this.skipNextSelectionAction = true
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

  /**
   * 处理格式化快捷键（Cmd/Ctrl+B 加粗、+I 斜体等）
   * 逻辑：在选区两端插入/移除对应的 Markdown 标记符
   */
  private handleFormatToggle(selection: SelectionSnapshot | null, format: string) {
    if (!selection || !selection.anchorNode) return

    const blockId = getIdFromBlock(selection.anchorNode)
    const block = this.doc.getBlock(blockId)
    const blockEl = this.dom.getNodeById(blockId)
    if (!block || !blockEl) return

    // 确定标记符
    const markerMap: Record<string, string> = {
      bold: '**',
      italic: '*',
      strikethrough: '~~',
      code: '`',
      highlight: '=='
    }
    const marker = markerMap[format]
    if (!marker && format !== 'link') return

    const isExpanded = this.dom.getExpandedBlockId() === blockId
    const rawText = this.doc.getRawText(blockId)

    if (format === 'link') {
      // 链接格式：[text](url) 或无选区时 [](url)
      if (selection.isCollapsed) {
        // 无选区：插入空链接模板
        let rawOffset: number | null
        if (isExpanded) {
          rawOffset = computeRawOffset(blockEl, selection.anchorNode, selection.anchorOffset)
        } else {
          rawOffset = computeSemanticOffset(blockEl, selection.anchorNode, selection.anchorOffset, this.doc.prefixOffset(blockId))
          if (rawOffset !== null) rawOffset = rawOffset  // semantic offset 已包含 prefix
        }
        if (rawOffset === null) return

        // 对于非展开模式，semantic offset 等于 raw offset（对于普通文本）
        // 需要转换为 raw offset 来操作 rawText
        const insertOffset = isExpanded ? rawOffset : this.semanticToRawOffset(block, rawOffset)
        if (insertOffset === null) return

        const linkTemplate = '[](url)'
        const newRawText = rawText.slice(0, insertOffset) + linkTemplate + rawText.slice(insertOffset)
        // 光标放在 [] 内
        this.applyRawReconcile(block, newRawText, insertOffset + 1)
      } else {
        // 有选区：用选中文本作为链接文本
        if (!isExpanded) {
          // 非展开模式：先展开
          this.dom.expandBlock(blockId, block)
        }
        const range = getSelectionRawRange(blockEl, selection)
        if (!range) return
        const selectedText = rawText.slice(range.start, range.end)
        const newRawText = rawText.slice(0, range.start) + `[${selectedText}](url)` + rawText.slice(range.end)
        // 光标放在 (url) 的 url 上
        const cursorPos = range.start + selectedText.length + 3  // [text](|url)
        this.applyRawReconcile(block, newRawText, cursorPos)
      }
      return
    }

    // 非链接格式
    if (selection.isCollapsed) {
      // 无选区：插入一对空标记符，光标放中间
      let rawOffset: number | null
      if (isExpanded) {
        rawOffset = computeRawOffset(blockEl, selection.anchorNode, selection.anchorOffset)
      } else {
        const semOffset = computeSemanticOffset(blockEl, selection.anchorNode, selection.anchorOffset, this.doc.prefixOffset(blockId))
        rawOffset = semOffset !== null ? this.semanticToRawOffset(block, semOffset) : null
      }
      if (rawOffset === null) return

      const newRawText = rawText.slice(0, rawOffset) + marker + marker + rawText.slice(rawOffset)
      this.applyRawReconcile(block, newRawText, rawOffset + marker.length)
    } else {
      // 有选区：在选区两端插入/移除标记符
      if (!isExpanded) {
        this.dom.expandBlock(blockId, block)
      }
      const range = getSelectionRawRange(blockEl, selection)
      if (!range) return

      const selectedText = rawText.slice(range.start, range.end)

      // 检测是否已有该标记符（toggle off）
      if (selectedText.startsWith(marker) && selectedText.endsWith(marker) && selectedText.length >= marker.length * 2) {
        // 移除标记符
        const unwrapped = selectedText.slice(marker.length, selectedText.length - marker.length)
        const newRawText = rawText.slice(0, range.start) + unwrapped + rawText.slice(range.end)
        this.applyRawReconcile(block, newRawText, range.start + unwrapped.length)
      } else if (
        range.start >= marker.length &&
        rawText.slice(range.start - marker.length, range.start) === marker &&
        rawText.slice(range.end, range.end + marker.length) === marker
      ) {
        // 标记符在选区外围
        const newRawText = rawText.slice(0, range.start - marker.length) + selectedText + rawText.slice(range.end + marker.length)
        this.applyRawReconcile(block, newRawText, range.start - marker.length + selectedText.length)
      } else {
        // 添加标记符
        const newRawText = rawText.slice(0, range.start) + marker + selectedText + marker + rawText.slice(range.end)
        this.applyRawReconcile(block, newRawText, range.start + marker.length + selectedText.length)
      }
    }
  }

  /**
   * 将 semantic offset 转换为 raw offset
   */
  private semanticToRawOffset(block: BlockModel, semanticOffset: number): number {
    // semantic offset 在简单情况下就是 raw offset（prefix + char offset，不含标记符）
    // 对于有标记符的 inline，需要重建 raw text 并映射
    const rawText = this.doc.getRawText(block.id)
    const prefixLen = this.doc.prefixOffset(block.id)

    if (semanticOffset <= prefixLen) return semanticOffset

    // 需要遍历 inline model，累加到 semantic offset 对应的 raw position
    const inlines = block.inline ?? []
    let semanticAccum = 0
    let rawAccum = prefixLen

    for (const inline of inlines) {
      if (inline.type === 'text') {
        const hasMarkers = inline.markers && inline.marks !== 0
        if (hasMarkers) {
          rawAccum += inline.markers!.prefix.length
        }

        const textLen = inline.text.length
        const semanticPos = semanticOffset - prefixLen

        if (semanticAccum + textLen >= semanticPos) {
          // 目标在这个 inline 内
          const localOffset = semanticPos - semanticAccum
          return rawAccum + localOffset
        }
        semanticAccum += textLen
        rawAccum += textLen

        if (hasMarkers) {
          rawAccum += inline.markers!.suffix.length
        }
      } else if (inline.type === 'link') {
        // 简化处理：link 内容作为整体
        const linkRaw = `[${this.doc.inlineToRawText(inline.children)}](${inline.href})`
        rawAccum += linkRaw.length
        // link 的 semantic length = children 的文本总长度
        let linkSemanticLen = 0
        for (const child of inline.children) {
          if (child.type === 'text') linkSemanticLen += child.text.length
        }
        semanticAccum += linkSemanticLen
      }
    }

    // Fallback：直接返回（可能超出范围）
    return Math.min(rawAccum, rawText.length)
  }

  /**
   * 处理 Tab / Shift+Tab 缩进操作
   * - 在列表项上：增加/减少 2 个空格的缩进
   * - 在代码块内：插入/移除 2 个空格
   * - 其他类型：插入/移除 2 个空格缩进
   */
  private handleIndent(selection: SelectionSnapshot | null, direction: 'indent' | 'outdent') {
    if (!selection || !selection.anchorNode) return

    const blockId = getIdFromBlock(selection.anchorNode)
    const block = this.doc.getBlock(blockId)
    const blockEl = this.dom.getNodeById(blockId)
    if (!block || !blockEl) return

    const rawText = this.doc.getRawText(blockId)
    const isExpanded = this.dom.getExpandedBlockId() === blockId

    // 代码块内：在光标位置插入/删除 2 个空格
    if (block.type === 'code-block') {
      if (!isExpanded) return
      const rawOffset = computeRawOffset(blockEl, selection.anchorNode, selection.anchorOffset)
      if (rawOffset === null) return

      if (direction === 'indent') {
        const newRawText = rawText.slice(0, rawOffset) + '    ' + rawText.slice(rawOffset)
        this.applyRawReconcile(block, newRawText, rawOffset + 4)
      } else {
        // 找当前行行首，删除最多 4 个空格
        const lineStart = rawText.lastIndexOf('\n', rawOffset - 1) + 1
        let spacesToRemove = 0
        for (let i = lineStart; i < lineStart + 4 && i < rawText.length; i++) {
          if (rawText[i] === ' ') spacesToRemove++
          else break
        }
        if (spacesToRemove > 0) {
          const newRawText = rawText.slice(0, lineStart) + rawText.slice(lineStart + spacesToRemove)
          const newOffset = Math.max(lineStart, rawOffset - spacesToRemove)
          this.applyRawReconcile(block, newRawText, newOffset)
        }
      }
      return
    }

    // 列表项、段落等：修改行首缩进
    const nesting = block.nesting ?? 0

    if (direction === 'indent') {
      // 增加 4 个空格缩进
      const newRawText = '    ' + rawText

      // 计算光标的新位置
      let cursorRawOffset: number
      if (isExpanded) {
        const rawOffset = computeRawOffset(blockEl, selection.anchorNode, selection.anchorOffset)
        cursorRawOffset = (rawOffset ?? 0) + 4
      } else {
        cursorRawOffset = this.doc.prefixOffset(blockId) + 4
      }

      this.applyRawReconcile(block, newRawText, cursorRawOffset)
    } else {
      // 减少缩进：移除行首最多 4 个空格
      if (nesting <= 0) return

      const spacesToRemove = Math.min(4, nesting)
      const newRawText = rawText.slice(spacesToRemove)

      let cursorRawOffset: number
      if (isExpanded) {
        const rawOffset = computeRawOffset(blockEl, selection.anchorNode, selection.anchorOffset)
        cursorRawOffset = Math.max(0, (rawOffset ?? 0) - spacesToRemove)
      } else {
        cursorRawOffset = Math.max(0, this.doc.prefixOffset(blockId) - spacesToRemove)
      }

      this.applyRawReconcile(block, newRawText, cursorRawOffset)
    }
  }

  /**
   * 处理图片拖拽上传
   * 将拖拽的图片文件转换为 base64 data URL，插入 Markdown 图片语法
   */
  private handleImageDrop(selection: SelectionSnapshot | null, files: FileList) {
    // 筛选图片文件
    const imageFiles: File[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type.startsWith('image/')) {
        imageFiles.push(file)
      }
    }
    if (imageFiles.length === 0) return

    // 逐个读取图片文件并插入
    const promises = imageFiles.map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          const alt = file.name.replace(/\.[^.]+$/, '') // 文件名去掉扩展名作为 alt
          resolve(`![${alt}](${dataUrl})`)
        }
        reader.onerror = () => resolve('')
        reader.readAsDataURL(file)
      })
    })

    Promise.all(promises).then(markdownImages => {
      const validImages = markdownImages.filter(s => s.length > 0)
      if (validImages.length === 0) return

      // 获取当前光标位置
      const currentSelection = this.controller['captureSelection']?.() ?? selection
      if (!currentSelection || !currentSelection.anchorNode) return

      const blockId = getIdFromBlock(currentSelection.anchorNode)
      const block = this.doc.getBlock(blockId)
      const blockEl = this.dom.getNodeById(blockId)
      if (!block || !blockEl) return

      const isExpanded = this.dom.getExpandedBlockId() === blockId
      const rawText = this.doc.getRawText(blockId)

      // 计算插入位置
      let rawOffset: number | null
      if (isExpanded) {
        rawOffset = computeRawOffset(blockEl, currentSelection.anchorNode!, currentSelection.anchorOffset)
      } else {
        rawOffset = rawText.length // 非展开模式，插入到行尾
      }
      if (rawOffset === null) rawOffset = rawText.length

      // 如果是空行，直接替换；否则在光标位置插入
      const insertText = validImages.join('\n')
      if (rawText.trim() === '') {
        // 空行：直接用图片语法替换
        this.applyRawReconcile(block, insertText, insertText.length)
      } else {
        // 非空行：在光标位置插入（如果多张图片需要换行处理）
        if (validImages.length === 1) {
          const newRawText = rawText.slice(0, rawOffset) + insertText + rawText.slice(rawOffset)
          this.applyRawReconcile(block, newRawText, rawOffset + insertText.length)
        } else {
          // 多张图片：在当前行后依次创建新行
          const lines = [rawText.slice(0, rawOffset) + validImages[0] + rawText.slice(rawOffset)]
          for (let i = 1; i < validImages.length; i++) {
            lines.push(validImages[i])
          }
          // 使用类似多行粘贴的方式处理
          this.handlePasteMultiLine(block, blockEl, currentSelection, lines, isExpanded)
        }
      }

      this.notifyContentChange()
    })
  }

  /**
   * 处理链接 hover——显示编辑弹窗
   * 鼠标悬停在链接上时弹出一个浮层，可编辑 URL 和文本
   */
  private handleLinkHover(
    linkInfo: { href: string; text: string; blockId: string; rect: { left: number; top: number; bottom: number; right: number } },
    linkElement: HTMLAnchorElement | null
  ) {
    // 如果已存在弹窗，不重复创建
    const existingPopup = this.view.container.querySelector('.md-link-popup')
    if (existingPopup) return

    const { href, text, blockId, rect } = linkInfo
    const containerRect = this.view.container.getBoundingClientRect()

    // 创建弹窗容器
    const popup = document.createElement('div')
    popup.className = 'md-link-popup'
    popup.style.cssText = `
      position: absolute;
      left: ${rect.left - containerRect.left}px;
      top: ${rect.bottom - containerRect.top + 4}px;
      z-index: 1000;
      background: #fff;
      border: 1px solid #d0d0d0;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      padding: 12px;
      min-width: 300px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `

    // URL 显示行
    const urlRow = document.createElement('div')
    urlRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;'
    const urlIcon = document.createElement('span')
    urlIcon.textContent = '🔗'
    urlIcon.style.cssText = 'flex-shrink: 0; font-size: 14px;'
    urlRow.appendChild(urlIcon)
    const urlInput = document.createElement('input')
    urlInput.type = 'text'
    urlInput.value = href
    urlInput.placeholder = '链接地址'
    urlInput.style.cssText = 'flex: 1; border: 1px solid #e0e0e0; border-radius: 4px; padding: 4px 8px; font-size: 13px; outline: none; font-family: "Maple Mono", Consolas, monospace; color: #267AE9;'
    urlRow.appendChild(urlInput)
    popup.appendChild(urlRow)

    // 文本显示行
    const textRow = document.createElement('div')
    textRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 10px;'
    const textIcon = document.createElement('span')
    textIcon.textContent = '📝'
    textIcon.style.cssText = 'flex-shrink: 0; font-size: 14px;'
    textRow.appendChild(textIcon)
    const textInput = document.createElement('input')
    textInput.type = 'text'
    textInput.value = text
    textInput.placeholder = '链接文本'
    textInput.style.cssText = 'flex: 1; border: 1px solid #e0e0e0; border-radius: 4px; padding: 4px 8px; font-size: 13px; outline: none;'
    textRow.appendChild(textInput)
    popup.appendChild(textRow)

    // 按钮行
    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;'

    const openBtn = document.createElement('button')
    openBtn.textContent = '打开链接'
    openBtn.style.cssText = 'padding: 4px 12px; border: 1px solid #d0d0d0; border-radius: 4px; background: #f8f8f8; cursor: pointer; font-size: 12px;'
    openBtn.addEventListener('click', () => {
      const url = urlInput.value.trim()
      if (url) window.open(url, '_blank')
    })
    btnRow.appendChild(openBtn)

    const saveBtn = document.createElement('button')
    saveBtn.textContent = '保存修改'
    saveBtn.style.cssText = 'padding: 4px 12px; border: none; border-radius: 4px; background: #267AE9; color: #fff; cursor: pointer; font-size: 12px;'
    saveBtn.addEventListener('click', () => {
      const newHref = urlInput.value.trim()
      const newText = textInput.value.trim()
      if (newHref && newText) {
        this.updateLinkByInfo(blockId, text, href, newText, newHref)
      }
      popup.remove()
    })
    btnRow.appendChild(saveBtn)
    popup.appendChild(btnRow)

    // 关闭逻辑：鼠标离开弹窗 + 链接元素区域时关闭
    let closeTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleClose = () => {
      if (closeTimer) clearTimeout(closeTimer)
      closeTimer = setTimeout(() => {
        popup.remove()
        cleanup()
      }, 300) // 300ms 延迟，给用户从链接移到弹窗的缓冲时间
    }

    const cancelClose = () => {
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = null
      }
    }

    // 弹窗的鼠标事件
    popup.addEventListener('mouseenter', cancelClose)
    popup.addEventListener('mouseleave', scheduleClose)

    // 链接元素的鼠标事件（如果元素仍在 DOM 中）
    if (linkElement && this.view.container.contains(linkElement)) {
      linkElement.addEventListener('mouseleave', scheduleClose)
      linkElement.addEventListener('mouseenter', cancelClose)
    } else {
      // 链接元素不在了（可能已展开），启动关闭定时器
      scheduleClose()
    }

    // 点击弹窗内输入框时，阻止冒泡以防止编辑器展开/收起
    popup.addEventListener('mousedown', (e) => {
      e.stopPropagation()
      cancelClose() // 正在交互，不要关闭
    })

    const cleanup = () => {
      if (linkElement) {
        linkElement.removeEventListener('mouseleave', scheduleClose)
        linkElement.removeEventListener('mouseenter', cancelClose)
      }
    }

    // 添加到容器
    this.view.container.style.position = 'relative'
    this.view.container.appendChild(popup)
  }

  /**
   * 通过 blockId 和旧文本/URL 更新链接
   */
  private updateLinkByInfo(blockId: string, oldText: string, oldHref: string, newText: string, newHref: string) {
    const block = this.doc.getBlock(blockId)
    if (!block) return

    const rawText = this.doc.getRawText(blockId)

    const oldLink = `[${oldText}](${oldHref})`
    const newLink = `[${newText}](${newHref})`

    const idx = rawText.indexOf(oldLink)
    if (idx === -1) return

    const newRawText = rawText.slice(0, idx) + newLink + rawText.slice(idx + oldLink.length)

    // 保存快照用于 undo
    const cursorInfo = this.getCurrentCursorInfo(
      this.controller['captureSelection']?.() ?? null
    )
    this.history.pushSnapshot(this.doc.blocks, cursorInfo)

    // 应用更改
    const effect = this.doc.reconcileFromRawText(blockId, newRawText)
    if (!effect) return
    if (effect.kind === 'code-block-degrade') return
    const targetBlock = effect.kind === 'block-transform' ? effect.to : effect.block
    if (effect.kind === 'block-transform') {
      this.dom.replaceBlock(effect.from, effect.to)
    } else {
      this.dom.replaceBlock(targetBlock, targetBlock)
    }

    this.notifyContentChange()
  }

  /**
   * 处理图片 hover——显示编辑弹窗
   * 鼠标悬停在图片上时弹出浮层，可编辑 src 和 alt
   */
  private handleImageHover(
    imageInfo: { src: string; alt: string; blockId: string; rect: { left: number; top: number; bottom: number; right: number } }
  ) {
    // 如果已存在弹窗，不重复创建
    const existingPopup = this.view.container.querySelector('.md-image-popup')
    if (existingPopup) return

    const { src, alt, blockId, rect } = imageInfo
    const containerRect = this.view.container.getBoundingClientRect()

    const popup = document.createElement('div')
    popup.className = 'md-image-popup'
    popup.style.cssText = `
      position: absolute;
      left: ${rect.left - containerRect.left}px;
      top: ${rect.bottom - containerRect.top + 4}px;
      z-index: 1000;
      background: #fff;
      border: 1px solid #d0d0d0;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      padding: 12px;
      min-width: 300px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `

    // 图片地址行
    const srcRow = document.createElement('div')
    srcRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;'
    const srcIcon = document.createElement('span')
    srcIcon.textContent = '🖼️'
    srcIcon.style.cssText = 'flex-shrink: 0; font-size: 14px;'
    srcRow.appendChild(srcIcon)
    const srcInput = document.createElement('input')
    srcInput.type = 'text'
    srcInput.value = src
    srcInput.placeholder = '图片地址'
    srcInput.style.cssText = 'flex: 1; border: 1px solid #e0e0e0; border-radius: 4px; padding: 4px 8px; font-size: 13px; outline: none; font-family: "Maple Mono", Consolas, monospace; color: #267AE9;'
    srcRow.appendChild(srcInput)
    popup.appendChild(srcRow)

    // Alt 文本行
    const altRow = document.createElement('div')
    altRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 10px;'
    const altIcon = document.createElement('span')
    altIcon.textContent = '📝'
    altIcon.style.cssText = 'flex-shrink: 0; font-size: 14px;'
    altRow.appendChild(altIcon)
    const altInput = document.createElement('input')
    altInput.type = 'text'
    altInput.value = alt
    altInput.placeholder = '替代文本'
    altInput.style.cssText = 'flex: 1; border: 1px solid #e0e0e0; border-radius: 4px; padding: 4px 8px; font-size: 13px; outline: none;'
    altRow.appendChild(altInput)
    popup.appendChild(altRow)

    // 按钮行
    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;'

    const openBtn = document.createElement('button')
    openBtn.textContent = '查看原图'
    openBtn.style.cssText = 'padding: 4px 12px; border: 1px solid #d0d0d0; border-radius: 4px; background: #f8f8f8; cursor: pointer; font-size: 12px;'
    openBtn.addEventListener('click', () => {
      const url = srcInput.value.trim()
      if (url) window.open(url, '_blank')
    })
    btnRow.appendChild(openBtn)

    const saveBtn = document.createElement('button')
    saveBtn.textContent = '保存修改'
    saveBtn.style.cssText = 'padding: 4px 12px; border: none; border-radius: 4px; background: #267AE9; color: #fff; cursor: pointer; font-size: 12px;'
    saveBtn.addEventListener('click', () => {
      const newSrc = srcInput.value.trim()
      const newAlt = altInput.value
      if (newSrc) {
        this.updateImageByInfo(blockId, alt, src, newAlt, newSrc)
      }
      popup.remove()
    })
    btnRow.appendChild(saveBtn)
    popup.appendChild(btnRow)

    // 关闭逻辑
    let closeTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleClose = () => {
      if (closeTimer) clearTimeout(closeTimer)
      closeTimer = setTimeout(() => {
        popup.remove()
      }, 300)
    }

    const cancelClose = () => {
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = null
      }
    }

    popup.addEventListener('mouseenter', cancelClose)
    popup.addEventListener('mouseleave', scheduleClose)

    // 找到对应的 img 元素绑定 mouseleave
    const imgEl = this.view.container.querySelector(`.md-line-block[data-block-id="${blockId}"] img.md-image`) as HTMLElement | null
    if (imgEl) {
      imgEl.addEventListener('mouseleave', scheduleClose)
      imgEl.addEventListener('mouseenter', cancelClose)
    }

    popup.addEventListener('mousedown', (e) => {
      e.stopPropagation()
      cancelClose()
    })

    this.view.container.style.position = 'relative'
    this.view.container.appendChild(popup)
  }

  /**
   * 通过 blockId 和旧 alt/src 更新图片
   */
  private updateImageByInfo(blockId: string, oldAlt: string, oldSrc: string, newAlt: string, newSrc: string) {
    const block = this.doc.getBlock(blockId)
    if (!block) return

    const rawText = this.doc.getRawText(blockId)

    const oldImage = `![${oldAlt}](${oldSrc})`
    const newImage = `![${newAlt}](${newSrc})`

    const idx = rawText.indexOf(oldImage)
    if (idx === -1) return

    const newRawText = rawText.slice(0, idx) + newImage + rawText.slice(idx + oldImage.length)

    const cursorInfo = this.getCurrentCursorInfo(
      this.controller['captureSelection']?.() ?? null
    )
    this.history.pushSnapshot(this.doc.blocks, cursorInfo)

    const effect = this.doc.reconcileFromRawText(blockId, newRawText)
    if (!effect) return
    if (effect.kind === 'code-block-degrade') return
    const targetBlock = effect.kind === 'block-transform' ? effect.to : effect.block
    if (effect.kind === 'block-transform') {
      this.dom.replaceBlock(effect.from, effect.to)
    } else {
      this.dom.replaceBlock(targetBlock, targetBlock)
    }

    this.notifyContentChange()
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
    const inStructMarker = isInStructuralMarkerSpan(textNode)
    
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
      if (inStructMarker) {
        // 光标在结构性标记符（如 •、1.）内，映射到 prefixOffset
        return prefixOffset
      }
      // 找到了光标所在的文本节点
      return prefixOffset + charOffset + anchorOffset
    }
    
    if (!inMarker && !inStructMarker) {
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
 * 判断一个文本节点是否在结构性 marker 元素内部
 * 包括：.md-list-marker、.md-list-number（非展开模式的列表标记如 • 或 1.）
 * 这些文本已经被 prefixOffset 计入，不应再参与 charOffset 计算
 */
function isInStructuralMarkerSpan(node: Node): boolean {
  let el = node.parentElement
  while (el) {
    if (el.classList.contains('md-list-marker') || el.classList.contains('md-list-number')) return true
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
    if (isInRawPlaceholderSpan(textNode)) {
      if (textNode === anchorNode) return rawOffset
      continue
    }
    if (textNode === anchorNode) {
      return rawOffset + anchorOffset
    }
    rawOffset += textNode.textContent?.length ?? 0
  }

  return null
}

/**
 * 计算非空选区在 block raw text 中的起止偏移量
 * 返回 { start, end } 其中 start < end（无论选区方向）
 */
function getSelectionRawRange(
  blockEl: HTMLElement,
  selection: SelectionSnapshot
): { start: number; end: number } | null {
  if (!selection.anchorNode || !selection.focusNode) return null

  const anchorOffset = computeRawOffset(blockEl, selection.anchorNode, selection.anchorOffset)
  const focusOffset = computeRawOffset(blockEl, selection.focusNode, selection.focusOffset)

  if (anchorOffset === null || focusOffset === null) return null

  return {
    start: Math.min(anchorOffset, focusOffset),
    end: Math.max(anchorOffset, focusOffset)
  }
}

function isAutoPairCharacter(char: string): boolean {
  return char === '*' || char === '_' || char === '`'
}

function isEscaped(text: string, offset: number): boolean {
  let slashCount = 0
  for (let i = offset - 1; i >= 0 && text[i] === '\\'; i--) {
    slashCount++
  }
  return slashCount % 2 === 1
}

function isInRawPlaceholderSpan(node: Node): boolean {
  let el = node instanceof Element ? node : node.parentElement
  while (el) {
    if (el instanceof HTMLElement && el.dataset.rawPlaceholder) return true
    if (el.classList.contains('md-line-block')) return false
    el = el.parentElement
  }
  return false
}

function parseOpeningCodeFence(rawText: string): { marker: string } | null {
  const match = rawText.match(/^(`{3,}|~{3,})[ \t]*(.*)$/)
  if (!match) return null
  return { marker: match[1] }
}

function parseClosingCodeFence(rawText: string): string | null {
  const match = rawText.match(/^(`{3,}|~{3,})[ \t]*$/)
  return match ? match[1] : null
}

/**
 * 将 inline model 转为 HTML 字符串
 */
function inlineToHTML(inlines: InlineModel[]): string {
  let html = ''
  for (const inline of inlines) {
    if (inline.type === 'text') {
      let text = escapeHTML(inline.text)
      if (inline.marks & INLINE_FLAG.CODE) {
        text = `<code>${text}</code>`
      } else {
        if (inline.marks & INLINE_FLAG.BOLD) text = `<strong>${text}</strong>`
        if (inline.marks & INLINE_FLAG.ITALIC) text = `<em>${text}</em>`
        if (inline.marks & INLINE_FLAG.STRIKE) text = `<del>${text}</del>`
        if (inline.marks & INLINE_FLAG.HIGHLIGHT) text = `<mark>${text}</mark>`
      }
      html += text
    } else if (inline.type === 'link') {
      const childHTML = inlineToHTML(inline.children)
      html += `<a href="${escapeHTML(inline.href)}">${childHTML}</a>`
    } else if (inline.type === 'image') {
      html += `<img src="${escapeHTML(inline.src)}" alt="${escapeHTML(inline.alt)}" />`
    }
  }
  return html
}

/**
 * 将 block model 转为 HTML 字符串
 */
function blockToHTML(block: BlockModel): string {
  switch (block.type) {
    case 'heading': {
      const depth = (block as HeadingBlock).headingDepth
      const tag = `h${depth}`
      return `<${tag}>${inlineToHTML(block.inline ?? [])}</${tag}>`
    }
    case 'paragraph':
      return `<p>${inlineToHTML(block.inline ?? [])}</p>`
    case 'list-item': {
      const style = (block as ListItemBlock).style
      if ('task' in style && style.task) {
        const checked = style.checked ? ' checked' : ''
        return `<li><input type="checkbox"${checked} disabled /> ${inlineToHTML(block.inline ?? [])}</li>`
      }
      return `<li>${inlineToHTML(block.inline ?? [])}</li>`
    }
    case 'hr':
      return '<hr />'
    case 'blank':
      return '<br />'
    case 'blockquote': {
      const content = inlineToHTML(block.inline ?? [])
      return `<blockquote><p>${content}</p></blockquote>`
    }
    case 'code-block': {
      const cb = block as CodeBlock
      const lang = cb.language ? ` class="language-${escapeHTML(cb.language)}"` : ''
      return `<pre><code${lang}>${escapeHTML(cb.code)}</code></pre>`
    }
    case 'table': {
      const tb = block as TableBlock
      let html = '<table>\n<thead>\n<tr>'
      tb.headers.forEach((h, i) => {
        const align = tb.aligns[i] && tb.aligns[i] !== 'default' ? ` style="text-align:${tb.aligns[i]}"` : ''
        html += `<th${align}>${escapeHTML(h)}</th>`
      })
      html += '</tr>\n</thead>\n<tbody>\n'
      tb.rows.forEach(row => {
        html += '<tr>'
        row.forEach((cell, i) => {
          const align = tb.aligns[i] && tb.aligns[i] !== 'default' ? ` style="text-align:${tb.aligns[i]}"` : ''
          html += `<td${align}>${escapeHTML(cell)}</td>`
        })
        html += '</tr>\n'
      })
      html += '</tbody>\n</table>'
      return html
    }
    default:
      return `<p>${inlineToHTML(block.inline ?? [])}</p>`
  }
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
