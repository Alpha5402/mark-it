import { describe, expect, test } from 'vitest'
import { DocumentController } from './DocumentController'

function snapshot(doc: DocumentController) {
  return Array.from(doc.getBlocks().values()).map(block => ({
    id: block.id,
    type: block.type,
    raw: doc.getRawText(block.id),
  }))
}

describe('DocumentController raw round-trip', () => {
  test('round-trips paragraphs, inline structures, and structural block prefixes', () => {
    const source = [
      '# Title',
      '- [x] done',
      '> quote',
      'a [b](c) ![alt](src.png) [^n] $x+1$',
      '[^n]: footnote',
    ].join('\n')

    const doc = new DocumentController(source)

    expect(snapshot(doc).map(b => b.raw).join('\n')).toBe(source)
    expect(snapshot(doc).map(b => b.type)).toEqual([
      'heading',
      'list-item',
      'blockquote',
      'paragraph',
      'paragraph',
    ])
  })

  test('round-trips code, math, and table blocks exactly', () => {
    const source = [
      '~~~python',
      'print(1)',
      '~~~',
      '$$',
      '',
      '$$',
      '| a | b |',
      '| --- | :---: |',
      '| 1 | 2 |',
    ].join('\n')

    const doc = new DocumentController(source)

    expect(snapshot(doc).map(b => b.raw)).toEqual([
      '~~~python\nprint(1)\n~~~',
      '$$\n\n$$',
      '| a | b |\n| --- | :---: |\n| 1 | 2 |',
    ])
    expect(snapshot(doc).map(b => b.type)).toEqual(['code-block', 'math-block', 'table'])
  })

  test('preserves empty code and empty math block identity', () => {
    const doc = new DocumentController('```\n```\n$$\n$$')

    expect(snapshot(doc).map(b => b.raw)).toEqual(['```\n```', '$$\n$$'])
  })

  test('exposes fenced code content without markdown fences', () => {
    const doc = new DocumentController('```ts\nconst x = 1\nconsole.log(x)\n```\nplain')
    const [code, paragraph] = snapshot(doc)

    expect(doc.getCodeBlockContent(code.id)).toBe('const x = 1\nconsole.log(x)')
    expect(doc.getCodeBlockContent(paragraph.id)).toBeNull()

    const empty = new DocumentController('```\n```')
    expect(doc.getCodeBlockContent('missing')).toBeNull()
    expect(empty.getCodeBlockContent(snapshot(empty)[0].id)).toBe('')
  })

  test('keeps whole-line single-line $$ spans as paragraph text', () => {
    const doc = new DocumentController('before\n$$\\frac{a}{b}$$\nafter')

    expect(snapshot(doc)).toMatchObject([
      { type: 'paragraph', raw: 'before' },
      { type: 'paragraph', raw: '$$\\frac{a}{b}$$' },
      { type: 'paragraph', raw: 'after' },
    ])
  })
})

describe('DocumentController reconcileFromRawText', () => {
  test('updates code-block content without splitting when fences remain valid', () => {
    const doc = new DocumentController('```js\nfoo\n```')
    const id = snapshot(doc)[0].id

    const effect = doc.reconcileFromRawText(id, '```ts\nbar\nbaz\n```')

    expect(effect?.kind).toBe('block-transform')
    expect(snapshot(doc)).toMatchObject([
      { type: 'code-block', raw: '```ts\nbar\nbaz\n```' },
    ])
  })

  test('degrades code-block to normal blocks when closing fence is broken', () => {
    const doc = new DocumentController('```js\nfoo\n```')
    const id = snapshot(doc)[0].id

    const effect = doc.reconcileFromRawText(id, '```js\nfoo\n')

    expect(effect?.kind).toBe('code-block-degrade')
    expect(snapshot(doc)).toMatchObject([
      { type: 'paragraph', raw: '```js' },
      { type: 'paragraph', raw: 'foo' },
      { type: 'blank', raw: '' },
    ])
  })

  test('updates math-block content and degrades when marker structure is broken', () => {
    const doc = new DocumentController('$$\naa\n$$')
    const id = snapshot(doc)[0].id

    expect(doc.reconcileFromRawText(id, '$$\nbb\ncc\n$$')?.kind).toBe('block-transform')
    expect(snapshot(doc)).toMatchObject([{ type: 'math-block', raw: '$$\nbb\ncc\n$$' }])

    expect(doc.reconcileFromRawText(id, '$$\nbb\ncc\n')?.kind).toBe('code-block-degrade')
    expect(snapshot(doc).map(b => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'blank'])
  })

  test('degrades math-block when edited into single-line $$ text', () => {
    const doc = new DocumentController('$$\naa\n$$')
    const id = snapshot(doc)[0].id

    expect(doc.reconcileFromRawText(id, '$$\\frac{a}{b}$$')?.kind).toBe('code-block-degrade')
    expect(snapshot(doc)).toMatchObject([
      { type: 'paragraph', raw: '$$\\frac{a}{b}$$' },
    ])
  })

  test('updates table content and degrades when separator row stops matching', () => {
    const doc = new DocumentController('| a | b |\n| --- | --- |\n| 1 | 2 |')
    const id = snapshot(doc)[0].id

    expect(doc.reconcileFromRawText(id, '| a | b |\n| :--- | ---: |\n| x | y |')?.kind).toBe('block-transform')
    expect(snapshot(doc)).toMatchObject([
      { type: 'table', raw: '| a | b |\n| :--- | ---: |\n| x | y |' },
    ])

    expect(doc.reconcileFromRawText(id, '| a | b |\n --- | --- |\n| x | y |')?.kind).toBe('code-block-degrade')
    expect(snapshot(doc).map(b => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph'])
  })

  test('parses raw replacement ranges using block-tokenization rules', () => {
    const doc = new DocumentController('start\nmiddle\nend')
    const ids = snapshot(doc).map(b => b.id)

    const result = doc.replaceBlockRangeFromRawText(
      ids[0],
      ids[1],
      'alpha\n$$\nx\n$$',
    )

    expect(result?.removedBlockIds).toEqual([ids[1]])
    expect(snapshot(doc).map(b => b.type)).toEqual(['paragraph', 'math-block', 'paragraph'])
    expect(snapshot(doc).map(b => b.raw)).toEqual(['alpha', '$$\nx\n$$', 'end'])
  })
})

describe('DocumentController prefixOffset', () => {
  test('computes structural prefix offsets used by cursor mapping', () => {
    const doc = new DocumentController(['  - item', '1. item', '### Title', '>> quote'].join('\n'))
    const blocks = snapshot(doc)

    expect(doc.prefixOffset(blocks[0].id)).toBe(4)
    expect(doc.prefixOffset(blocks[1].id)).toBe(3)
    expect(doc.prefixOffset(blocks[2].id)).toBe(4)
    expect(doc.prefixOffset(blocks[3].id)).toBe(3)
  })
})
