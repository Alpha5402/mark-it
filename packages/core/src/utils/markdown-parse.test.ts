import { describe, expect, test } from 'vitest'
import { INLINE_FLAG, type FootnoteRefInline, type MathInline, type TextInline } from '../types'
import { inlineParse, parseLine } from './parse'
import { initialTokenize, tokenizeByLine } from './tokenize'

describe('initialTokenize', () => {
  test('merges fenced code blocks and preserves surrounding paragraph boundaries', () => {
    const tokens = initialTokenize('before\n```ts\nconst x = 1\n```\nafter')

    expect(tokens.map(t => t.raw)).toEqual([
      'before',
      '```ts\nconst x = 1\n```',
      'after',
    ])
  })

  test('does not merge unclosed fenced code blocks', () => {
    const tokens = initialTokenize('```ts\nconst x = 1')

    expect(tokens.map(t => t.raw)).toEqual(['```ts', 'const x = 1'])
  })

  test('merges math blocks with multiline fences or whole-line single-line fences', () => {
    expect(initialTokenize('x\n$$\na+b\n$$\ny').map(t => t.raw)).toEqual([
      'x',
      '$$\na+b\n$$',
      'y',
    ])

    expect(initialTokenize('$$a+b$$').map(t => t.raw)).toEqual(['$$a+b$$'])
    expect(initialTokenize('$$\na+b').map(t => t.raw)).toEqual(['$$', 'a+b'])
  })

  test('merges markdown tables as one raw line', () => {
    const tokens = initialTokenize('intro\n| a | b |\n| --- | :---: |\n| 1 | 2 |\noutro')

    expect(tokens.map(t => t.raw)).toEqual([
      'intro',
      '| a | b |\n| --- | :---: |\n| 1 | 2 |',
      'outro',
    ])
  })
})

describe('parseLine', () => {
  test('parses common block types', () => {
    expect(parseLine(tokenizeByLine('# Title')).type).toBe('heading')
    expect(parseLine(tokenizeByLine('- item')).type).toBe('list-item')
    expect(parseLine(tokenizeByLine('1. item')).type).toBe('list-item')
    expect(parseLine(tokenizeByLine('> quote')).type).toBe('blockquote')
    expect(parseLine(tokenizeByLine('---')).type).toBe('hr')
    expect(parseLine(tokenizeByLine('')).type).toBe('blank')
  })

  test('parses task list markers and checked state', () => {
    const unchecked = parseLine(tokenizeByLine('- [ ] todo')) as any
    const checked = parseLine(tokenizeByLine('- [x] done')) as any

    expect(unchecked.type).toBe('list-item')
    expect(unchecked.style).toEqual({ ordered: false, task: true, checked: false })
    expect(checked.style).toEqual({ ordered: false, task: true, checked: true })
  })

  test('parses code block language, fence, content, and empty content count', () => {
    const code = parseLine(tokenizeByLine('~~~python\nprint(1)\n~~~')) as any
    const empty = parseLine(tokenizeByLine('```\n```')) as any

    expect(code).toMatchObject({
      type: 'code-block',
      language: 'python',
      fence: '~~~',
      code: 'print(1)',
      codeLineCount: 1,
    })
    expect(empty).toMatchObject({
      type: 'code-block',
      language: '',
      fence: '```',
      code: '',
      codeLineCount: 0,
    })
  })

  test('parses math block content and distinguishes empty from blank-line content', () => {
    const empty = parseLine(tokenizeByLine('$$\n$$')) as any
    const blankLine = parseLine(tokenizeByLine('$$\n\n$$')) as any
    const singleLine = parseLine(tokenizeByLine('$$\\frac{a}{b}$$')) as any

    expect(empty).toMatchObject({ type: 'math-block', tex: '', texLineCount: 0 })
    expect(blankLine).toMatchObject({ type: 'math-block', tex: '', texLineCount: 1 })
    expect(singleLine.type).toBe('paragraph')
  })

  test('parses table headers, alignments, and rows', () => {
    const table = parseLine(tokenizeByLine('| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |')) as any

    expect(table.type).toBe('table')
    expect(table.headers).toEqual(['a', 'b', 'c'])
    expect(table.aligns).toEqual(['left', 'center', 'right'])
    expect(table.rows).toEqual([['1', '2', '3']])
  })
})

describe('inlineParse', () => {
  test('parses common marker spans and preserves marker text for raw round-trip', () => {
    const parsed = inlineParse('**bold** *em* `code` ~~del~~ ==mark==')
    const texts = parsed.inline.filter(i => i.type === 'text') as TextInline[]

    expect(texts.map(t => [t.text, t.marks, t.markers])).toEqual([
      ['bold', INLINE_FLAG.BOLD, { prefix: '**', suffix: '**' }],
      [' ', 0, undefined],
      ['em', INLINE_FLAG.ITALIC, { prefix: '*', suffix: '*' }],
      [' ', 0, undefined],
      ['code', INLINE_FLAG.CODE, { prefix: '`', suffix: '`' }],
      [' ', 0, undefined],
      ['del', INLINE_FLAG.STRIKE, { prefix: '~~', suffix: '~~' }],
      [' ', 0, undefined],
      ['mark', INLINE_FLAG.HIGHLIGHT, { prefix: '==', suffix: '==' }],
    ])
  })

  test('parses link, image, footnote ref, and inline math', () => {
    const parsed = inlineParse('a [b](c) ![alt](src.png) [^n] $x+1$')

    expect(parsed.inline.map(i => i.type)).toEqual([
      'text',
      'link',
      'text',
      'image',
      'text',
      'footnote-ref',
      'text',
      'math',
    ])
    expect((parsed.inline[1] as any).href).toBe('c')
    expect((parsed.inline[3] as any).alt).toBe('alt')
    expect((parsed.inline[5] as FootnoteRefInline).id).toBe('n')
    expect((parsed.inline[7] as MathInline).tex).toBe('x+1')
  })

  test('treats unpaired markers as plain text', () => {
    const parsed = inlineParse('**bold *em $x')

    expect(parsed.inline).toHaveLength(1)
    expect(parsed.inline[0]).toMatchObject({
      type: 'text',
      text: '**bold *em $x',
      marks: 0,
      offset: 0,
      dirty: false,
    })
  })
})
