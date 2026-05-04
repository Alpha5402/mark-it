我来仔细阅读 core 代码，了解事件接管的实现细节，然后帮你设计更全面的 e2e 测试场景。
[查找目录中]
[读取文件中]
现在我了解了事件接管的设计。让我继续查看 Editor 主文件和类型定义，了解 Block 的类型和处理流程。
[读取文件中]
[读取文件中]
现在我需要查看 Editor.ts 中的核心事件处理逻辑以及主要的编辑场景，因为这是用户事件接管的核心。文件较大（101KB），我有目的地搜索关键方法。
[查找文件中]
[查找文件中]
[查找文件中]
[查找文件中]
[查找文件中]
[查找文件中]
[查找文件中]
[查找文件中]
[查找文件中]
现在让我查看 helpers/EditSession.ts，了解目前的测试辅助手段，以及 main.css/rendered DOM 结构。
[读取文件中]
[查找文件中]
[读取文件中]
[查找文件中]
[查找文件中]
[查找文件中]
我已经有足够的信息对事件接管的细节有全面了解了。最后查看一下 package.json 确认 Playwright 的相关依赖情况，以及 Editor 的导出入口。
[读取文件中]
[读取文件中]
我已经对 core 的事件接管架构了解得非常清楚了。下面给出一份详细且贴合代码实现的 Playwright e2e 测试场景大纲。这份大纲是为你的自主事件接管架构量身定制的，因为这是关键的复杂性所在，任何遗漏都会导致输入/光标异常。

---

# 一、事件接管架构概要（必读，作为测试设计的依据）

基于对 [`EditorEventController.ts`](/Users/asherqiu/mark-it/packages/core/src/Editor/EditorEventController.ts) 和 [`Editor.ts`](/Users/asherqiu/mark-it/packages/core/src/Editor/Editor.ts) 的阅读，你的事件接管有几个**非常关键的特性**，测试必须全部覆盖：

1. **`beforeinput` 全部 `preventDefault()`**：浏览器不会真正写入 DOM，`input` 事件不触发，全部由 `applyRawReconcile` 手动改 model + 重渲染 DOM。
2. **`keydown` 完全接管 ArrowLeft/Right/Up/Down/Tab/Cmd+X**：并做"幽灵位置跳过"、`stickyX` 记忆、跨 block 上下移动。
3. **Block 的两种视觉状态**：收起（`.md-line-block` 无 `md-block-expanded`）和展开（带 `md-block-expanded` + `.md-struct-marker` + `.md-marker` 可见）。光标所在 block 会被自动展开。
4. **两种偏移系统**：[`rawOffset`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22rawOffset%22%2C%5B%7B%22line%22%3A54%2C%22character%22%3A12%7D%2C%7B%22line%22%3A54%2C%22character%22%3A21%7D%5D%5D)（展开态）和 `semanticOffset`（收起态），每个输入事件都要根据 `isExpanded` 走不同路径。
5. **auto-pair 字符**：`*` `_` `` ` ``、`$$`、` ``` ` 会触发自动成对/自动补全代码块。
6. **跨 block 选区**：有独立的 `crossBlockSelection` 状态与 rAF 展开，替换逻辑调 `handleCrossBlockReplace`。
7. **IME（`composition-*`）特殊路径**：`onBeforeInput` 在 composing 时直接 return，不能误伤中文输入。
8. **`MutationObserver` 兜底**：非预期的 DOM 变更（如浏览器原生未被 `preventDefault` 的情况）会抛 `DomMutated`。

---

# 二、推荐的测试覆盖大纲（在你的 10 个场景基础上扩展）

## 场景 0：基础渲染与初始状态（前置用例）

- `0.1` 用不同 markdown 源初始化，`.md-line-block` 数量、顺序、class 正确
- `0.2` 初次渲染不应出现 `md-block-expanded`
- `0.3` `contentEditable="true"` 只在 `.md-renderer-area` 与 title 上
- `0.4` `MutationObserver` 在初始渲染期间不会错误触发 `DomMutated`

## 场景 1：新建 Block（所有类型）

> 此处"新建"应该理解为通过**用户输入**触发 model 增加一个 block。每种类型都要从三个路径触发：①直接键入前缀；②粘贴；③回车拆分。

| 子项 | 输入操作 | 期望 |
|---|---|---|
| 1.1 | 空行键入 `# ` → heading-1 | `.md-heading-1` 且有 `md-struct-marker`，光标在 "# " 后 |
| 1.2 | [`##`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22%23%23%22%2C%5B%7B%22line%22%3A7%2C%22character%22%3A38%7D%2C%7B%22line%22%3A7%2C%22character%22%3A40%7D%5D%5D) ~ `######` 六级 heading | 对应 `md-heading-1..6` |
| 1.3 | 键入 `- ` → list-item (unordered) | `.md-list-item`, `md-list-marker` 为 `- ` |
| 1.4 | 键入 `1. ` / `3. ` → list-item (ordered) | `md-list-marker` 文本 = `"1. "` / `"3. "` |
| 1.5 | 键入 `- [ ] ` / `- [x] ` → task list | `md-task-checkbox`（非展开），展开态是 struct-marker `- [ ] ` |
| 1.6 | 键入 `> ` / `>> ` → blockquote | `dataset.depth` 等于 depth |
| 1.7 | 键入 `---`+Enter → hr | `.md-hr-wrapper` 出现，无 md-inline-content |
| 1.8 | 键入 ` ``` js `+Enter → code-block 自动补闭 | 由 `tryCompleteCodeBlockFromOpeningFence` 触发，形成 ` ```js\n\n``` `，光标落在中间 |
| 1.9 | 键入 `$$` 自动补全 → `$$$$` 光标居中 → 再 Enter → math-block | `.md-math-block` |
| 1.10 | 键入表格首行 `\| a \| b \|`+Enter + `\| --- \| --- \|`+Enter → table | `.md-table-wrapper`，收起模式有 `<table>` |
| 1.11 | 空行 Enter → blank | `.md-blank` |
| 1.12 | 在段落末尾 Enter → 新建 paragraph | block 数+1，光标在新 block prefixOffset 位置 |
| 1.13 | 通过粘贴多行纯文本 → 一次创建多个 block | 覆盖 `handlePasteMultiLine`（见 3.4） |
| 1.14 | 每次新建 block 后 `.md-block-expanded` 只存在于光标所在 block（"切换展开"不能泄漏） |

## 场景 2：删除 Block（整个删除）

> 核心是 `handleMergeWithPreviousBlock` 与"删光后退化 blank"。

| 子项 | 路径 | 期望 |
|---|---|---|
| 2.1 | 段首 Backspace（`rawOffset===0`）→ 与前一 block 合并 | [`mergeBlockWithPrevious`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22mergeBlockWithPrevious%22%2C%5B%7B%22line%22%3A509%2C%22character%22%3A33%7D%2C%7B%22line%22%3A509%2C%22character%22%3A55%7D%5D%5D)，block 总数-1，新展开 block 是合并后的，光标在合并点 [`cursorRawOffset`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22cursorRawOffset%22%2C%5B%7B%22line%22%3A424%2C%22character%22%3A81%7D%2C%7B%22line%22%3A424%2C%22character%22%3A96%7D%5D%5D) |
| 2.2 | blank block 上 Backspace | 走 mergeWithPrevious 分支 |
| 2.3 | blank block 是首个 block 时 Backspace | **不应**崩溃，也不应合并不存在的 block |
| 2.4 | 末尾 Delete（DeleteForward）→ 合并下一 block（目前代码 DeleteForward 非展开模式不处理，展开模式 `rawOffset >= rawText.length` 时 [`return`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22return%22%2C%5B%7B%22line%22%3A40%2C%22character%22%3A4%7D%2C%7B%22line%22%3A40%2C%22character%22%3A10%7D%5D%5D)，**此处建议补 e2e 验证"Delete 在末尾不吞前一个字符"**） |
| 2.5 | 一次性删空所有内容 → block 退化为 blank | [`block.type === 'blank'`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22block.type%20%3D%3D%3D%20%27blank%27%22%2C%5B%7B%22line%22%3A104%2C%22character%22%3A10%7D%2C%7B%22line%22%3A104%2C%22character%22%3A45%7D%5D%5D)，DOM 出现 `.md-blank` |
| 2.6 | heading 上在 marker 区域内按 Backspace → 降级为 paragraph（[`handleDeleteInPrefix`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22handleDeleteInPrefix%22%2C%5B%7B%22line%22%3A457%2C%22character%22%3A2%7D%2C%7B%22line%22%3A502%2C%22character%22%3A3%7D%5D%5D)） | `.md-heading-*` 消失，变 `.md-paragraph` |
| 2.7 | list-item 在 marker 区域 Backspace → 退出 list（变 paragraph） | `.md-list-item` 消失 |
| 2.8 | 嵌套列表（`    - item`）在缩进区域 Backspace | 只删 1 个空格，不立即降级 |
| 2.9 | blockquote marker 区域 Backspace → 变 paragraph |  |
| 2.10 | 选区跨 block 拖选后按 Backspace | 走 `handleCrossBlockReplace`，中间 block 全部 `dom.removeBlockNode` 且 [`doc.blocks.delete`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22doc.blocks.delete%22%2C%5B%7B%22line%22%3A19%2C%22character%22%3A2%7D%2C%7B%22line%22%3A19%2C%22character%22%3A25%7D%5D%5D) |
| 2.11 | 删除 block 后 [`getBlockIds()`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22getBlockIds%28%29%22%2C%5B%7B%22line%22%3A406%2C%22character%22%3A2%7D%2C%7B%22line%22%3A408%2C%22character%22%3A3%7D%5D%5D) 顺序正确且 `nodes` Map 无泄漏 |  |

## 场景 3：编辑 Block

### 3.0 展开 Block（⭐最容易错的关键）

- `3.0.1` 鼠标点击某 block 的文本区 → 该 block 自动获得 `.md-block-expanded`；光标位置保持
- `3.0.2` 点击 **另一个** block → 老的收起，`getExpandedBlockId()` 切换
- `3.0.3` 点击展开后 DOM 出现：`.md-struct-marker`（heading/list/blockquote/code fence/math $$ 等），以及 inline 的 `.md-marker-expanded` 与 `.md-marker`
- `3.0.4` 收起后不应残留 `.md-marker` / `.md-struct-marker`
- `3.0.5` 连续 5 次展开/收起，DOM 节点数稳定（参见已有的 "多次展开/收起不应导致 DOM 泄漏"）
- `3.0.6` 展开 code-block 时出现 `md-code-block-expanded` + `md-code-fence-marker`；收起时恢复 `<pre><code>` 高亮
- `3.0.7` 展开 math-block → 文本 `"$$\n...\n$$"` 出现；收起 → KaTeX HTML
- `3.0.8` 展开 table → 原始 `| a | b |` 文本出现；收起 → `<table>`
- `3.0.9` 展开 hr → `.md-hr-content` 文本 `---`；收起 → `<hr>`
- `3.0.10` 展开 blank → 只含一个 `\u200B` 文本节点；收起 → 零宽空格 + `<br>`
- `3.0.11` 通过 **方向键上/下移动光标进入别的 block** 也应正确切换展开（走的是 `MoveCursorUp/Down`，与 selectionchange 展开路径不同）
- `3.0.12` Undo/Redo 后应 `fullRebuild` 并展开目标 block（`skipNextSelectionAction=true`）

### 3.1 在 Block 内部新增普通字符

- `3.1.1` paragraph 中间键入 `x` → DOM 文本 +1，光标 +1
- `3.1.2` heading 中间键入 → 不降级，保持 `md-heading-N`
- `3.1.3` list-item 内容区键入 → 不破坏 marker
- `3.1.4` 数字键入 `3` 在段首不应被误识别为 `3.`（没有后续 `. ` 不算 list）
- `3.1.5` 空 block 上连续键入若干字符 → 类型正确保持为 paragraph
- `3.1.6` **中文 IME 输入（composition-start/update/end）**：期间不会触发 `applyRawReconcile`，`compositionEnd.data` 一次性应用，光标位置准确
- `3.1.7` 连续快速键入（短时间 10+ 次 InsertText）不应丢字符、不应造成 DOM 不一致
- `3.1.8` 键入空格不会意外触发 auto-pair

### 3.2 在 Block 内部新增特殊字符（⭐核心风险）

此类字符要严格验证 `tryHandleMarkdownAutoComplete` 与格式解析：

- `3.2.1` 键入单个 `*` / `_` / `` ` `` → 由 `isAutoPairCharacter` 自动补成对，光标落在中间
- `3.2.2` 转义后的 `\*` 不应 auto-pair（`isEscaped` 分支）
- `3.2.3` 已在 `*` 后再键入 `*` → 粘性越过，不再重复补全（验证 "`rawText[rawOffset] === data`" 的 skip-over 行为若有）
- `3.2.4` 键入 `**text**` 完成粗体 → 展开态仍显示 `**`，收起态 `.md-bold`
- `3.2.5` 键入 `__x__` → italic/bold（视语法）
- `3.2.6` 键入 `~~x~~` → strike；`==x==` → highlight
- `3.2.7` 键入 `$x$` → MathInline；键入 `$$` → 触发 `$$$$` 自动补全为 math-inline/math-block（走 `tryHandleMarkdownAutoComplete` 的 `$$` 分支）
- `3.2.8` 行首键入 ` `` ` → 还是普通内联 code；行首键入第 2 个 ` `` ` → 满足 `/^(\s*)``$/` 触发插入 `\`\`\`\n\`\`\``
- `3.2.9` 在 code-block / math-block 内键入 `*` / `` ` `` **不应**触发 auto-pair（代码里明确 `return false`）
- `3.2.10` 键入 `[` 不 auto-pair（目前 `isAutoPairCharacter` 不含 `[`），键入 `[](` 再插入 url 的行为
- `3.2.11` 连续键入 `**` 后紧跟一个字符，再补 `**` —— 光标在第二个 `**` 之间 → 不形成空的 `****`
- `3.2.12` auto-pair 后按 Backspace **应**删除整对（若实现如此），否则只删一个——要对齐实际实现
- `3.2.13` 数学公式 [`$`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22%24%22%2C%5B%7B%22line%22%3A35%2C%22character%22%3A35%7D%2C%7B%22line%22%3A35%2C%22character%22%3A36%7D%5D%5D) 自动补全内部键入 `\int` 不破坏外层 [`$`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22%24%22%2C%5B%7B%22line%22%3A35%2C%22character%22%3A35%7D%2C%7B%22line%22%3A35%2C%22character%22%3A36%7D%5D%5D)
- `3.2.14` `[^1]` 脚注引用键入时正确形成 `FootnoteRefInline`

### 3.3 在 Block 内部通过粘贴大串字符

- `3.3.1` 单行长字符串粘贴（走 [`lines.length <= 1`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22lines.length%20%3C%3D%201%22%2C%5B%7B%22line%22%3A430%2C%22character%22%3A12%7D%2C%7B%22line%22%3A430%2C%22character%22%3A32%7D%5D%5D) 单行分支） → 合并 before/after 做 reconcile
- `3.3.2` 粘贴长达 10k 字符的纯文本 → 不崩溃、用时合理（性能基线）
- `3.3.3` 粘贴含特殊字符 `**`、`__`、`$` 的文本 → 解析出对应 inline marker
- `3.3.4` 在 code-block / math-block / table 内粘贴多行 → 走 `handleInsertInMarker` 单 block 内，不拆分 block
- `3.3.5` 粘贴时当前 block 处于展开态 → 粘贴后仍在同一 block 且展开
- `3.3.6` 粘贴只含 `\u200B` / `\r\n` 混合 → 正确归一化（建议单独验证）
- `3.3.7` 粘贴 HTML（富文本）目前通过 `getData('text/plain')` 获取纯文本，验证富文本粘贴时**不会**带格式

### 3.4 粘贴/回车拆分或新建 Block（⭐架构关键）

- `3.4.1` 在段落中间粘贴 `"hello\nworld"` → 第一行并入当前 block、第二行新建 block，光标在新 block 末尾 `- afterCursor.length`
- `3.4.2` 粘贴 `"a\nb\nc"` 三行 → block 数 +2
- `3.4.3` 粘贴含 fenced code 多行，例如 ` "text\n```js\nfoo\n```\nend" ` → [`initialTokenize`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22initialTokenize%22%2C%5B%7B%22line%22%3A15%2C%22character%22%3A9%7D%2C%7B%22line%22%3A15%2C%22character%22%3A24%7D%5D%5D) 应识别代码围栏，合并为一个 code-block
- `3.4.4` 粘贴含 math-block `"x\n$$\nE=mc^2\n$$\ny"` → 生成 math-block
- `3.4.5` 粘贴含 table → 生成 table block
- `3.4.6` 在有选区的情况下粘贴多行 → 先删选区，再走多行粘贴分支（代码第 242-300 行）
- `3.4.7` 在 list-item 中回车（非空内容）→ 创建下一条 list，继承 [`indent`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22indent%22%2C%5B%7B%22line%22%3A191%2C%22character%22%3A12%7D%2C%7B%22line%22%3A191%2C%22character%22%3A54%7D%5D%5D) 和 marker（有序：[`orderNum+1`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22orderNum%2B1%22%2C%5B%7B%22line%22%3A249%2C%22character%22%3A14%7D%2C%7B%22line%22%3A249%2C%22character%22%3A60%7D%5D%5D)；无序：`- `）
- `3.4.8` 空 list-item 回车 → 退出列表变 blank（[`contentAfterPrefix===''`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22contentAfterPrefix%3D%3D%3D%27%27%22%2C%5B%7B%22line%22%3A225%2C%22character%22%3A12%7D%2C%7B%22line%22%3A225%2C%22character%22%3A64%7D%5D%5D) 分支）
- `3.4.9` code-block 内回车 → 仅插入 `\n` + 继承上一行缩进，**不**拆分 block
- `3.4.10` math-block 内回车 → 同上
- `3.4.11` code-block 开头 fence 行按 Enter → 光标落在代码第一空行（[`effectiveOff <= firstLineBreak`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22effectiveOff%20%3C%3D%20firstLineBreak%22%2C%5B%7B%22line%22%3A177%2C%22character%22%3A10%7D%2C%7B%22line%22%3A177%2C%22character%22%3A42%7D%5D%5D) 分支）
- `3.4.12` blank block 回车 → 直接创建新 blank，不尝试 reconcile 空串
- `3.4.13` paragraph 中间回车 → 前半 [`reconcileFromRawText`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22reconcileFromRawText%22%2C%5B%7B%22line%22%3A241%2C%22character%22%3A30%7D%2C%7B%22line%22%3A241%2C%22character%22%3A50%7D%5D%5D) 原 block、后半 [`createBlockFromRawText`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22createBlockFromRawText%22%2C%5B%7B%22line%22%3A215%2C%22character%22%3A32%7D%2C%7B%22line%22%3A215%2C%22character%22%3A54%7D%5D%5D)，新 block 展开、光标在 [`prefixOffset`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22prefixOffset%22%2C%5B%7B%22line%22%3A39%2C%22character%22%3A33%7D%2C%7B%22line%22%3A39%2C%22character%22%3A45%7D%5D%5D)
- `3.4.14` `handleCodeBlockDegrade` 分支：在 code-block 中间回车导致围栏被破坏 → 拆分为多行 paragraph
- `3.4.15` 粘贴后 `skipNextSelectionAction=true` 确实被消费（下一次 selectionchange 不重复展开/收起导致闪烁）

### 3.5 删除非特殊字符

- `3.5.1` paragraph 中间 Backspace → rawText 长度-1，type 不变
- `3.5.2` Backspace 删到 prefixLen 之前 → 进入 [`handleDeleteInPrefix`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22handleDeleteInPrefix%22%2C%5B%7B%22line%22%3A457%2C%22character%22%3A2%7D%2C%7B%22line%22%3A502%2C%22character%22%3A3%7D%5D%5D)
- `3.5.3` 连续 Backspace 删到全空 → block 转 blank（[`newRawText.trim()===''`](command:gongfeng.gongfeng-copilot.chat.open-symbol-in-file?%5B%7B%22%24mid%22%3A1%2C%22fsPath%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22external%22%3A%22file%3A%2F%2F%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22path%22%3A%22%2FUsers%2Fasherqiu%2Fmark-it%2Fpackages%2Fcore%2F__tests__%2Fhelpers%2FEditSession.ts%22%2C%22scheme%22%3A%22file%22%7D%2C%22newRawText.trim%28%29%3D%3D%3D%27%27%22%2C%5B%7B%22line%22%3A128%2C%22character%22%3A10%7D%2C%7B%22line%22%3A128%2C%22character%22%3A97%7D%5D%5D) 分支）
- `3.5.4` Delete（DeleteForward）在段中删一字符 → 光标不移动
- `3.5.5` IME 输入过程中按 Backspace → 不应误删已上屏字符（因为 `this.isComposing` 时 `onBeforeInput` return）
- `3.5.6` 在多 block 选区下删除字符 → 全选区被替换为空，多 block 合并为一个

### 3.6 删除特殊字符（⭐核心风险，容易造成 block 类型抖动）

- `3.6.1` 展开态删掉 `**text**` 的一个 `*` → marker 失效，inline text 的 bold 取消
- `3.6.2` 删除 `# ` 中的空格 → heading 退化 paragraph（对齐现有 e2e "## Title" 测试）
- `3.6.3` 删除 `- ` 中的 `-` → 仍在 prefix 区 → list 退化 paragraph
- `3.6.4` 删除整个 `**` 前缀符 → bold 取消；删一半 `*` → 行为：要么 auto 补回一个（如果实现）要么 text 保留
- `3.6.5` 删除代码围栏 `` ```js `` 的结尾 ` `` ` → 触发 `code-block-degrade`，block 被拆分成多个 paragraph
- `3.6.6` 删除 math-block 的 `$$` 中一个 `$` → `isValidMath` 返回 false → 同样 degrade
- `3.6.7` 删除表格分隔行的 `---` → 表格破坏，`reconcileFromRawText` 的 table 分支生成多行 paragraph
- `3.6.8` 删除 link 的 `[` 或 `]` → link inline 降级为普通 text
- `3.6.9` 删除 footnote 的 `]` → FootnoteRef 消失
- `3.6.10` 删除 `$x$` 的 `$` → MathInline 消失
- `3.6.11` **删除后光标位置**：应在删除点（`newCursorRawOffset = rawOffset - 1`），测试节点应精确验证 selection 的 anchorNode/Offset

### 3.7 选区替换（选中 → 粘贴/输入）

- `3.7.1` 选中单 block 内 `[start, end)` → 键入单字符 → `handleReplaceSelection`，`start + text.length` 为新光标
- `3.7.2` 选中整段文本 → 键入字符 → 变单字符的 paragraph
- `3.7.3` 选中整段 → 粘贴单行 → 替换
- `3.7.4` 选中整段 → 粘贴多行 → 先 collapsedRawText reconcile（可能变 blank），再多行插入，最后 `skipNextSelectionAction`（代码 242-300 行分支）
- `3.7.5` 选中整段 → 选中内容 `trim()==='' ` → block 转 blank
- `3.7.6` 选中文本后按 Enter（InsertLineBreak）→ 先删选区再在 `range.start` 位置换行拆 block
- `3.7.7` 选中跨 block 后键入字符 → `handleCrossBlockReplace`，首尾合并，中间 block 被 `dom.removeBlockNode`
- `3.7.8` 选中跨 block 后粘贴多行 → 同样触发 cross-block replace 再重新走多行粘贴逻辑（代码里 `insertText` 是单值，要单独验证 cross-block + multiline paste 的组合路径是否存在遗漏！**这是一个容易遗漏的边界**）
- `3.7.9` 反向选区（focus 在 anchor 前面）→ 行为与正向一致
- `3.7.10` 选中后按 Delete 键 → 行为与按 Backspace 一致（都走 `handleReplaceSelection(.. '')`）
- `3.7.11` 选区替换完成后，`crossBlockSelection=null`、`crossBlockExpandRaf` 被取消、`multiExpanded` 被收起

### 3.8 方向键（⭐最易出 bug 的"幽灵位置"处理）

- `3.8.1` 展开态 ArrowRight 穿越 `.md-struct-marker` 边界 → 光标视觉位置单调递增，无停滞
- `3.8.2` 展开态 ArrowRight 在 `**bold**` 边界 → 跳过 `.md-marker` 的 DOM 幽灵位置（代码里 `MAX_ITERATIONS=20`，`Math.abs(curRect.left - prevRect.left) < 1` 判断）
- `3.8.3` ArrowLeft 镜像行为
- `3.8.4` Shift+ArrowRight 扩展选区 → 使用 `sel.modify('extend', ...)`
- `3.8.5` Alt+ArrowRight 按词移动（`granularity: 'word'`）
- `3.8.6` Cmd+ArrowRight 按行首/行尾（`granularity: 'lineboundary'`）
- `3.8.7` 到 block 边界仍按方向键 → 行为（应进入前/后 block？或停留？具体看实现）
- `3.8.8` ArrowDown/Up：首次按下时 `stickyX` 被记录；连续上下键应使用同一 x 坐标（验证 `stickyX` 复用）
- `3.8.9` ArrowDown 跨 block → 触发 `dom.expandBlock(targetBlock)` + `collapseBlock(oldBlock)`
- `3.8.10` ArrowDown 跨 block 到 code-block → 应展开 code-block 以便像素定位
- `3.8.11` 中间夹杂 ArrowLeft（水平键）→ `stickyX=null`，下次 ArrowDown 重新记录
- `3.8.12` 鼠标点击后再按 ArrowUp → 由于 `onSelectionChange` 里 `!isVerticalMove` 会清 `stickyX`，所以重新记录
- `3.8.13` 方向键不应产生 `InsertText`/`DeleteBackward` 事件（即 beforeinput 不被触发）

### 3.9 Tab 缩进 / Shift+Tab 反缩进

- `3.9.1` 段落上 Tab → 在行首插入 4 空格，`nesting+=4`（等效）
- `3.9.2` 段落上 Shift+Tab（nesting=0）→ 什么也不做
- `3.9.3` 缩进后光标位置：展开态 = 原 rawOffset+4；非展开 = `prefixOffset+4`
- `3.9.4` list-item 上 Tab → 缩进变嵌套 list
- `3.9.5` code-block 内 Tab → 在光标位置插入 4 空格（不是变嵌套）
- `3.9.6` code-block 内 Shift+Tab → 删除行首最多 4 个空格
- `3.9.7` code-block 非展开态按 Tab → 直接 return，不改变
- `3.9.8` Tab 不应触发浏览器默认焦点切换（`e.preventDefault()`）
- `3.9.9` Tab 连续按 → 缩进逐次增加；Shift+Tab 反之减少到 0 后不再变
- `3.9.10` Tab 在多 block 选区时（目前 `handleIndent` 仅看 `selection.anchorNode`，只缩进起始 block）→ 验证实际行为与预期是否一致，可能是**需要修正**的边界

---

## 场景 4：补充容易被遗漏的"事件接管"专项

> 基于对 `EditorEventController` 的阅读，这些场景是 **Playwright e2e 才能验证** 的、纯 model 测试验证不到的。

### 4.1 `beforeinput.preventDefault` 验证

- `4.1.1` 任何键入后，如果没有 `onAction` 路径处理，DOM 也不应被浏览器原生修改（通过 `MutationObserver` 抓取 `DomMutated` 事件不应出现于普通 InsertText 后）
- `4.1.2` `inInputTransaction` 在 `onBeforeInput` 完成后被立刻重置（代码 256 行注释）
- `4.1.3` `insertCompositionText`、`historyUndo` 等 `inputType` 不走 case 会走到 default → 抛 Unknown，不破坏状态

### 4.2 IME（中文输入法）

- `4.2.1` 键入拼音 `nihao` → compositionstart → 多次 compositionupdate → compositionend data=`"你好"` → model 被更新一次
- `4.2.2` composition 过程中 `onBeforeInput` 应 return（`if (this.isComposing) return`）
- `4.2.3` composition 过程中敲 Escape 取消 → compositionend data 为空串 → 不改 model
- `4.2.4` 展开态 vs 非展开态 composition → 两条路径 `isInMarker: true/false`（代码 371-405）
- `4.2.5` IME 结束后 `dom.purify()` 被调用（验证零宽空格被清理）

### 4.3 Copy / Cut / Paste 的 clipboardData

- `4.3.1` Copy 时 preventDefault，写入 `text/plain` 为 `getSelectedText(selection)`（非 DOM 文本）
- `4.3.2` 跨 block 选区 Copy → 收集所有涉及 block 的 raw text 用 `\n` 拼接
- `4.3.3` 展开态 Copy → 复制内容应与收起态一致（避免复制出 `**` 等标记符）
- `4.3.4` Paste 的 data 来自 `e.clipboardData.getData('text/plain')`
- `4.3.5` Cut 目前仅做复制（代码注释"暂不实现跨 block 删除"）→ 验证"单 block 选区 Cut"是否被实现并正确删除

### 4.4 Undo / Redo

- `4.4.1` `Cmd+Z` 触发 EditorActionType.Undo → `history.undo` → `dom.fullRebuild`
- `4.4.2` `Cmd+Shift+Z` / `Cmd+Y` → Redo
- `4.4.3` Undo 后光标恢复到原位置（`snapshot.cursor` 的 `isRawOffset` 两种路径）
- `4.4.4` Undo 后 `skipNextSelectionAction` 生效，不会闪烁
- `4.4.5` 连续编辑后多次 Undo/Redo，DOM 节点数与 block id 稳定

### 4.5 Selection change 与 Block 自动展开/收起

- `4.5.1` 鼠标点击进入新 block → 旧 block collapse，新 block expand
- `4.5.2` 点击编辑区外（`anchorNode` 不在 root 内）→ `isSelectionInEditor` 返回 false，不 emit Select
- `4.5.3` 鼠标拖选跨 block → 进入 `crossBlockSelection` 模式，`scheduleCrossBlockExpand` 在 rAF 后展开多个 block
- `4.5.4` 拖选过程中 focus 移动 → `anchorBlockId` 不变，`focusRawOffset` 每次更新
- `4.5.5` 拖选缩回单 block → `crossBlockSelection=null`，`collapseAllMultiExpanded`
- `4.5.6` 拖选后松开 → 多 block 展开保持直到 collapsed
- `4.5.7` 光标完全脱离编辑区再点击回来 → 不 crash

### 4.6 Drag & Drop

- `4.6.1` `dragover` 被 `preventDefault`（否则 `drop` 不触发）
- `4.6.2` 拖入图片文件 → 触发 `EditorActionType.Drop`，`files.length > 0`，走 `handleImageDrop`，生成 `![alt](data:image/...base64)` 插入
- `4.6.3` 拖入多个文件 → 每个生成一行
- `4.6.4` 拖入纯文本（`files.length===0`）→ 不应触发 Drop action

### 4.7 鼠标悬停/点击：链接、图片、脚注

- `4.7.1` `mouseover` 落在 `a.md-link` → `EditorActionType.LinkClick` 带 rect/href
- `4.7.2` `mouseover` 落在 `img.md-image` → `ImageHover`
- `4.7.3` Cmd/Ctrl + 左键点击 `a.md-link` → `window.open(href, '_blank')`（e2e 用 `page.context().waitForEvent('page')` 或 mock）
- `4.7.4` Cmd/Ctrl + 左键点击 `a.md-footnote-link` → `FootnoteJump`，滚动到 `[^id]` 定义

### 4.8 MutationObserver 兜底

- `4.8.1` 通过 DevTools 或测试直接 `document.execCommand('bold')`（绕过 beforeinput？如果浏览器仍触发）→ `pendingMutations` 在 `onInput` 时 emit `DomMutated`
- `4.8.2` 在 `inInputTransaction=false` 时的 DOM 改动不应被记录（非事务期的 MutationObserver 早 return）

### 4.9 边界值与健壮性

- `4.9.1` 空文档（无 block）初始化 → beforeinput 不 crash
- `4.9.2` `selection.anchorNode = null` 时所有 handler 应 return，不 crash
- `4.9.3` 编辑一个被删除后未更新引用的 block → Editor 各函数里的 `if (!block) return`
- `4.9.4` `rawOffset === null`（computeRawOffset 返回 null）时不 crash
- `4.9.5` 快速在多 block 之间跳转、键入（压测）→ expandedBlockId 最终收敛于唯一值

---

# 三、给 Playwright e2e 的几条设计建议

1. **事件触发方式**：
 - 普通字符用 `page.keyboard.insertText()`（会触发 beforeinput 且带 data）
 - 特殊键用 `page.keyboard.press('ArrowLeft')`、`Meta+Z` 等
 - 粘贴用 `page.evaluate` 构造 `ClipboardEvent + DataTransfer` 并 `dispatchEvent`（Playwright 原生 `page.keyboard.insertText` 不触发 paste）
 - IME 模拟要用 `CompositionEvent` dispatch
 - Drop 用 `DataTransfer` + `dispatchEvent('drop')`

2. **断言通道**：
 - **DOM 层**：`locator.innerHTML`、`.md-line-block` 数量、class 列表、`data-block-id` 集合
 - **Model 层**：暴露 `window.__editor = editor` 后 `page.evaluate(() => editor.getMarkdownSource())` 和 `editor.doc.blocks`
 - **选区层**：`page.evaluate(() => { const s=getSelection(); return {...} })` 精确到 anchorNode/anchorOffset
 - **事件层**：在 `new Editor()` 的 `handleEditorAction` 外层加一个 spy（或在测试页面注入），记录所有 action 的 `type`/`data`，断言关键分支被触发

3. **抗抖动**：上下键、跨 block 展开、rAF 展开都涉及异步，一定用 `page.waitForFunction` 或 `locator.waitFor({ state: 'visible' })`；不要用固定 `setTimeout`。

4. **快照基线**：每个场景跑完后，`editor.getMarkdownSource()` 应可 round-trip（再次解析渲染后仍一致），这是一个非常有效的"总闸"断言。

---

如果你需要，我可以基于这份大纲帮你生成具体的 Playwright 脚手架（包括 `insertTextViaKeyboard`、`simulatePaste`、`simulateIME`、`getEditorState` 等工具函数，以及按场景分组的 spec 文件）。是否要我继续这一步？