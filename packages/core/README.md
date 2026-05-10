# Mark It Core

Core markdown editor and renderer for Mark It.

`mark-it-core` provides a browser-side Markdown editing surface, a read-only renderer, TypeScript types, and the stylesheet needed to render Mark It documents.

## Features

- Editable Markdown document surface with block-based rendering
- Read-only Markdown renderer
- Common Markdown blocks including headings, lists, blockquotes, code blocks, tables, task lists, images, math, and footnotes
- Inline formatting such as bold, italic, strikethrough, highlight, links, and inline code
- Export helpers for Markdown source and semantic HTML
- ESM, CommonJS, and TypeScript declaration outputs

## Install

```bash
npm install mark-it-core katex prismjs
```

`katex` and `prismjs` are peer dependencies used for math and code rendering.

## Usage

```ts
import { Editor, Renderer } from 'mark-it-core';
import 'mark-it-core/style.css';

const container = document.getElementById('app') as HTMLDivElement;

const editor = new Editor(container, 'Untitled', '# Hello Mark It');

editor.onContentChange((markdown) => {
  console.log(markdown);
});

console.log(editor.getMarkdownSource());
console.log(editor.exportHTML());

editor.destroy();
```

Render a read-only document:

```ts
import { Renderer } from 'mark-it-core';
import 'mark-it-core/style.css';

const container = document.getElementById('preview') as HTMLDivElement;
const renderer = new Renderer(container, 'Preview', '# Hello Mark It');

renderer.destroy();
```

## API

### `new Editor(container, documentTitle?, initialContent?, metadata?)`

Creates an editable Markdown document.

- `container`: target `HTMLDivElement`
- `documentTitle`: optional title, defaults to `未命名`
- `initialContent`: optional Markdown source
- `metadata`: optional document metadata

Common instance methods:

- `getMarkdownSource()`: returns the current Markdown source
- `exportHTML()`: returns semantic HTML for the current document
- `findAll(query, caseSensitive?)`: finds matching text in the document
- `replaceAll(query, replacement, caseSensitive?)`: replaces matching text
- `onContentChange(callback)`: subscribes to Markdown changes
- `destroy()`: cleans up DOM and event listeners

Formatting helpers:

- `toggleBold()`
- `toggleItalic()`
- `toggleStrikethrough()`
- `toggleCode()`
- `toggleHighlight()`
- `insertLink()`

### `new Renderer(container, documentTitle?, initialContent?)`

Creates a read-only Markdown renderer.

- `container`: target `HTMLDivElement`
- `documentTitle`: optional title, defaults to `未命名`
- `initialContent`: optional Markdown source

Use `destroy()` when the renderer is no longer needed.

## Development

This package is part of the Mark It monorepo:

```bash
pnpm install
pnpm --filter mark-it-core dev
pnpm --filter mark-it-core build
pnpm --filter mark-it-core test
```

Repository: https://github.com/Alpha5402/mark-it

## License

ISC
