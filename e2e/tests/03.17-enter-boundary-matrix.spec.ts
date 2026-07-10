import { test, expect, type Page } from '@playwright/test'
import {
  blockIdAt,
  getEditorSnapshot,
  gotoPlayground,
  placeCaret,
  resetEditor,
} from './helpers/editor'

const inlineEnterCases = [
  { name: 'bold', markdown: 'a **bold** z' },
  { name: 'nested-bold-italic', markdown: 'a **bold *italic*** z' },
  { name: 'link', markdown: 'a [label](url) z' },
  { name: 'image', markdown: 'a ![alt](src) z' },
  { name: 'inline-math', markdown: 'a $x+y$ z' },
  { name: 'footnote-reference', markdown: 'a [^note] z' },
]

async function markdown(page: Page) {
  return page.evaluate(() => window.__markit.getMarkdown())
}

test.describe('03.17 Enter across inline Markdown boundaries', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPlayground(page)
  })

  for (const enterCase of inlineEnterCases) {
    test(`3.17 ${enterCase.name}: Enter splits at every visible raw boundary`, async ({ page }) => {
      const source = enterCase.markdown

      for (let offset = 0; offset <= source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await page.keyboard.press('Enter')

        const expected = `${source.slice(0, offset)}\n${source.slice(offset)}`
        expect(await markdown(page), `${enterCase.name} Enter at raw offset ${offset}`).toBe(expected)

        const snapshot = await getEditorSnapshot(page)
        expect(snapshot.blocks, `${enterCase.name} block raws at ${offset}`).toHaveLength(2)
        expect(snapshot.blocks.map(block => block.raw)).toEqual([
          source.slice(0, offset),
          source.slice(offset),
        ])
        expect(snapshot.expandedBlockId, `${enterCase.name} expanded block at ${offset}`)
          .toBe(snapshot.blocks[1].id)
      }
    })
  }

  const listCases = [
    { name: 'dash-list', markdown: '- item', prefix: '- ', nextPrefix: '- ' },
    { name: 'star-list', markdown: '* item', prefix: '* ', nextPrefix: '* ' },
    { name: 'plus-list', markdown: '+ item', prefix: '+ ', nextPrefix: '+ ' },
    { name: 'ordered-list', markdown: '12. item', prefix: '12. ', nextPrefix: '13. ' },
    { name: 'task-list', markdown: '* [X] task', prefix: '* [X] ', nextPrefix: '* [ ] ' },
  ]

  for (const listCase of listCases) {
    test(`3.17 ${listCase.name}: marker splits raw, content continues the same list kind`, async ({ page }) => {
      const source = listCase.markdown

      for (let offset = 0; offset <= source.length; offset += 1) {
        await resetEditor(page, source)
        const blockId = await blockIdAt(page, 0)
        await placeCaret(page, blockId, offset)
        await page.keyboard.press('Enter')

        const expected = offset < listCase.prefix.length
          ? `${source.slice(0, offset)}\n${source.slice(offset)}`
          : `${source.slice(0, offset)}\n${listCase.nextPrefix}${source.slice(offset)}`
        expect(await markdown(page), `${listCase.name} Enter at raw offset ${offset}`).toBe(expected)
      }
    })
  }
})
