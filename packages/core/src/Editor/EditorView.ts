export class EditorView {
  container: HTMLDivElement
  document: HTMLDivElement
  title: HTMLDivElement
  area: HTMLDivElement
  constructor(
    rendererContainer: HTMLDivElement, 
    title: string = ''

  ) {
    this.container = rendererContainer;

    this.document = document.createElement('div');
    this.document.className = 'md-document';
    rendererContainer.appendChild(this.document);

    this.title = document.createElement('div');
    this.title.className = 'md-line-block md-heading-1'
    this.title.innerText = title
    this.document.appendChild(this.title)
    this.document.appendChild(document.createElement('hr'))
    
    this.area = document.createElement('div');
    this.area.className = 'md-renderer-area';
    this.area.contentEditable = 'true';
    this.document.appendChild(this.area);
  }

  destroy() {
    if (this.container.contains(this.area)) {
      this.container.removeChild(this.area);
    }
  }

  extractText(blockEl: HTMLDivElement): string {
    const currentBlock = blockEl.closest('.md-line-block') as HTMLDivElement
    if (!currentBlock.lastElementChild) 
      return ''

    const classList = currentBlock.lastElementChild.classList
    console.log(classList)

    if (classList.contains('md-paragraph')) {
      // 直接拼 inline 文本
      return Array.from(blockEl.childNodes)
        .map(node => node.textContent ?? '')
        .join('')
    }

    if (classList.contains('md-list-item')) {
      // 列表 marker + 内容
      const markerEl = blockEl.querySelector('.md-list-marker')
      const contentEl = blockEl.querySelector('div') // 包裹实际文本的 div

      const markerText = markerEl?.textContent ?? ''
      const contentText = contentEl?.textContent ?? ''
      console.log(markerText + ' ' + contentText)
      return markerText + ' ' + contentText
    }

    if (classList.contains('md-heading')) {
      // heading token + 内容
      const tokenEl = blockEl.querySelector('.md-heading-token')
      const contentText = Array.from(blockEl.childNodes)
        .filter(n => n !== tokenEl)
        .map(n => n.textContent ?? '')
        .join('')
      return (tokenEl?.textContent ?? '') + ' ' + contentText
    }

    // fallback
    return blockEl.textContent ?? ''
  }


}