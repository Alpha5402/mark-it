import { DOMController } from './DOMController'
import { DocumentController } from './DocumentController'

export class DOMScheduler {
  private activeBlocks: Set<HTMLElement> = new Set()
  private dirtyBlocks: Set<HTMLElement> = new Set()
  private dom: DOMController
  private doc: DocumentController

  constructor(dom: DOMController, doc: DocumentController) {
    this.dom = dom
    this.doc = doc
  }

  highlightBlock(BlockId: string, type: number) {
    this.dom.clearHighlight()
    this.dom.highlightBlock(
      BlockId, type 
    )
  }

  markDirty(BlockId: string) {
    const node = this.dom.getNodeById(BlockId)
    if (node) {
      if (node.classList.contains('md-block-active')) {
        node.classList.remove('md-block-active')
      }
      node.classList.add('md-block-dirty')
      this.dirtyBlocks.add(node)
    }
  }

  insertText(BlockId: string, offset: number, text: string, nextCursorOffset: number = 0) {
    new Promise(resolve => {
      this.doc.insertText(BlockId, offset, text)
      resolve(true)
    }).then(() => {
      const block = this.doc.getBlock(BlockId)
      if (!block) return
      const prefixOffset = this.doc.prefixOffset(BlockId)
      this.dom.updateDOM(block, prefixOffset, nextCursorOffset)
    })
  }

  handleDeleteBackward(blockId: string, offset: number) {
    const result = this.doc.deleteText(blockId, offset)
    if (!result) {
      // 需要跨 block 合并 - 目前暂不实现，仅处理 block 内删除
      return
    }

    const block = this.doc.getBlock(blockId)
    if (!block) return
    const prefixOffset = this.doc.prefixOffset(blockId)
    this.dom.updateDOM(block, prefixOffset, result.newOffset)
  }

  handleInsertLineBreak(blockId: string, offset: number) {
    const result = this.doc.splitBlock(blockId, offset)
    const origin = this.doc.getBlock(blockId)

    this.markDirty(blockId)

    if (!result || !origin) return

    queueMicrotask(() => {
      const prefixOffset = this.doc.prefixOffset(blockId)
      this.dom.updateDOM(origin, prefixOffset)
      this.dom.purify()
      this.dom.insertBlock(origin, result)

      const newPrefixOffset = this.doc.prefixOffset(result.id)
      this.dom.setCursor(result.id, newPrefixOffset, newPrefixOffset, 'current')
    })
  }
}