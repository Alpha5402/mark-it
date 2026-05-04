# Mark It e2e 测试

基于 Playwright 的端到端测试，以 `playground` 作为被测载体，直接验证 core
的**自主事件接管**（beforeinput / keydown / paste / copy / cut / compositionstart
/ compositionupdate / compositionend / drop / selectionchange / mutation-observer）。

## 运行

```bash
# 1) 安装依赖（根目录）
pnpm install

# 2) 安装浏览器（首次）
pnpm --filter @mark-it/e2e install-browsers

# 3) 运行全部 e2e
pnpm --filter @mark-it/e2e test

# 可选：
pnpm --filter @mark-it/e2e test:headed   # 有头模式
pnpm --filter @mark-it/e2e test:ui       # Playwright UI 模式
pnpm --filter @mark-it/e2e test:debug    # PWDEBUG=1 逐步调试
pnpm --filter @mark-it/e2e report        # 打开上一次 HTML 报告
```

playwright 配置里已经声明了 `webServer`，会自动启动
`pnpm --filter playground dev -- --host 127.0.0.1 --port 5173 --strictPort`，
并在 `http://127.0.0.1:5173` 就绪后开始跑测试。

## 目录

```
e2e/
├── playwright.config.ts
├── tsconfig.json
└── tests/
    ├── helpers/
    │   ├── editor.ts    // 核心 helper：reset、placeCaret、simulatePaste、...
    │   └── globals.d.ts // window.__markit 类型声明
    ├── 00-bootstrap.spec.ts
    ├── 01-create-block.spec.ts
    ├── 02-delete-block.spec.ts
    ├── 03.0-expand.spec.ts
    ├── 03.1-insert-plain.spec.ts
    ├── 03.2-insert-special.spec.ts
    ├── 03.3-paste-single.spec.ts
    ├── 03.4-paste-split.spec.ts
    ├── 03.5-delete-plain.spec.ts
    ├── 03.6-delete-special.spec.ts
    ├── 03.7-selection-replace.spec.ts
    ├── 03.8-arrow-keys.spec.ts
    ├── 03.9-tab.spec.ts
    └── 04-event-interception.spec.ts
```

## 与 playground 的约定

playground 的 `App.tsx` 当检测到 URL 带 `?e2e=1` 时会用**空文档**启动，并
将下列 API 挂到 `window.__markit`：

```ts
window.__markit = {
  editor: Editor,
  renderer: Renderer,
  reset(markdown?: string): void, // 销毁并重建 editor
  getMarkdown(): string,
}
```

同时 `window.__markitReady = true` 标记就绪。e2e helper `gotoPlayground` 会
等待这个标志。

## 编写新用例的几个要点

1. **光标**：先 `placeCaret(page, blockId, rawOffset)` 再键入；这个函数会
   先点击 block（触发展开），再调用 `dom.setCursorByRawOffset()` 落点。
2. **选区**：用 `setSelection(page, anchor, focus)`，支持跨 block。
3. **粘贴**：用 `simulatePaste(page, text)` 构造 `ClipboardEvent + DataTransfer`
   并派发到 `.md-renderer-area`（Playwright 原生 clipboard 写入受平台限制）。
4. **IME**：用 `simulateIME(page, finalText, steps)` 构造 `CompositionEvent`。
5. **断言**：优先使用 `expectMarkdownEquals` / `expectBlockCount` 等 helper，
   失败信息会附带当前 markdown 快照，定位更快。

## 注意事项

- `Ctrl/Cmd` 快捷键统一使用 Playwright 的 `Meta+key` 语法（Mac / Linux 都有
  效；Windows CI 时需要额外适配）。
- 浏览器的 `ClipboardEvent` 构造器在某些平台不接受 `clipboardData` 参数，
  helper 里已经做了兼容性处理。
- Playwright 启动 vite 的首次 cold-start 可能慢，默认 `timeout: 120_000`。
