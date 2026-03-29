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
        console.log('remove active')
      }
      console.log('mark dirty')
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
      console.log(block)
      if (!block) return
      this.dom.updateDOM(block, nextCursorOffset)
    })
  }

  handleInsertLineBreak(blockId: string, offset: number) {
    const result = this.doc.splitBlock(blockId, offset)
    const origin = this.doc.getBlock(blockId)

    this.markDirty(blockId)

    if (!result || !origin) return

    queueMicrotask(() => {
      this.dom.updateDOM(origin)
      this.dom.purify()
      this.dom.insertBlock(origin, result)

      this.dom.setCursor(result.id, this.doc.prefixOffset(blockId), 'current')
    })
  }
}