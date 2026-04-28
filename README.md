# Mark It Core

一个基于 Monorepo 的 Markdown 编辑器项目，包含：

- `@mark-it/core`：核心引擎（编辑器 + 渲染器）
- `playground`：基于 React + Vite 的测试与演示站点

该项目使用 `pnpm workspace` 管理多包，并通过 `turbo` 统一编排开发与构建流程。

## 项目特性

- Monorepo 架构，便于核心包与示例应用协同开发
- 可复用的核心包 `@mark-it/core`，支持独立构建和发布
- 提供 `Editor` 与 `Renderer` 两种核心能力
- Playground 直接通过 `workspace:*` 引用本地核心包，开发反馈快
- 支持样式单独导出：`@mark-it/core/style.css`

## 技术栈

- 包管理：`pnpm`
- Monorepo：`pnpm workspace`
- 构建编排：`turbo`
- 核心包构建：`tsup` + `TypeScript`
- 演示站点：`React` + `Vite`

## 目录结构

```text
mark-it-core/
├─ packages/
│  └─ core/                 # @mark-it/core 核心包
│     ├─ src/
│     │  ├─ Editor/         # 编辑器相关实现
│     │  ├─ Renderer/       # 渲染器相关实现
│     │  ├─ utils/          # 文档、DOM、解析转换等工具
│     │  ├─ styles/
│     │  └─ index.ts        # 包入口
│     └─ package.json
├─ playground/              # React 测试站点
│  ├─ src/
│  ├─ vite.config.ts
│  └─ package.json
├─ package.json             # 根脚本（turbo）
├─ pnpm-workspace.yaml
└─ turbo.json
```

## 环境要求

- Node.js 18+
- pnpm 10+

## 快速开始

### 1) 安装依赖

```bash
pnpm install
```

### 2) 启动开发环境（核心包 watch + playground）

```bash
pnpm dev
```

根目录 `dev` 脚本会执行：

```bash
turbo run dev --parallel
```

### 3) 构建全部包

```bash
pnpm build
```

根目录 `build` 脚本会执行：

```bash
turbo run build
```

## 子包说明

### `@mark-it/core`

核心包导出：

- `Editor`：可编辑模式
- `Renderer`：只读渲染模式
- 类型定义（`types`）

入口：`packages/core/src/index.ts`

构建产物位于 `packages/core/dist`，包含：

- `index.js`（CJS）
- `index.mjs`（ESM）
- `index.d.ts`（类型）
- `index.css`（样式）

#### 在应用中使用

```ts
import { Editor, Renderer } from '@mark-it/core';
import '@mark-it/core/style.css';

const container = document.getElementById('app') as HTMLDivElement;

const editor = new Editor(container, '未命名', '# Hello Mark It');
// 或
const renderer = new Renderer(container, '未命名', '# Hello Mark It');

// 页面销毁时清理
editor.destroy();
renderer.destroy();
```

> `Editor` 和 `Renderer` 的构造参数均为：
>
> 1. `previewContainer: HTMLDivElement`
> 2. `documentTitle?: string`
> 3. `initialContent?: string`

### `playground`

`playground` 是一个 React 测试站点，用于验证 `@mark-it/core` 的交互与渲染效果。

- 使用 `workspace:*` 引用本地核心包
- 在 `vite.config.ts` 中配置了 `@mark-it/core` 本地源码别名，便于联调

单独启动：

```bash
pnpm --filter playground dev
```

## 常用命令

```bash
# 根目录
pnpm dev
pnpm build

# 仅 core
pnpm --filter @mark-it/core dev
pnpm --filter @mark-it/core build

# 仅 playground
pnpm --filter playground dev
pnpm --filter playground build
pnpm --filter playground preview
```

## 开发说明

- 根目录通过 `turbo` 统一调度任务
- `core` 使用 `tsup` 打包，支持 `cjs + esm + dts`
- `playground` 主要用于功能验证与手工测试

## TODO

### P0 — 核心缺失功能（必须有）

- [x] 快捷键系统（`Ctrl/Cmd+B` 加粗、`Ctrl/Cmd+I` 斜体、`Ctrl/Cmd+K` 链接、`Ctrl/Cmd+E` 行内代码、`Ctrl/Cmd+D` 删除线、`Ctrl/Cmd+Shift+H` 高亮）
- [x] 列表行为增强：列表项末尾按 `Enter` 自动创建新列表项（继承缩进和类型）
- [x] 列表行为增强：空列表项按 `Enter` 退出列表（变为 paragraph）
- [x] 列表行为增强：`Tab` / `Shift+Tab` 缩进/反缩进列表（4 空格为一个缩进单位）
- [x] 图片支持（`![alt](url)` 语法渲染）
- [ ] 图片拖拽上传
- [ ] 表格支持（Markdown 表格的渲染和编辑）

### P1 — 重要功能（应该有）

- [x] 任务列表（`- [ ]` 和 `- [x]` 渲染与交互，含 checkbox 点击和删除线效果）
- [x] Markdown 语法自动补全（输入 `` ` ``、`*`、`~`、`=`、`[`、`(` 自动补全对应关闭字符）
- [x] 代码块行号
- [ ] 链接编辑弹窗（点击链接弹出编辑面板）
- [x] 查找和替换（`findAll()` / `replaceAll()` API）
- [x] 导出功能（`exportHTML()` 方法，将文档导出为语义化 HTML）

### P2 — 锦上添花

- [ ] 数学公式 / LaTeX 支持
- [ ] 脚注支持
- [ ] 工具栏（顶部格式化按钮）
- [ ] 移动端 / 触摸适配
- [ ] 无障碍访问（ARIA 标签、屏幕阅读器）
- [ ] 拼写检查集成

### 稳定性 / 体验改进

- [ ] 跨行选中的视觉一致性
- [ ] 大文档性能优化（虚拟滚动等）
- [ ] 错误恢复 / 优雅降级
- [x] 代码块内编辑体验（Enter 自动保持缩进、Tab/Shift+Tab 缩进管理）

## 后续可完善方向

- 增加自动化测试（单元测试 / 集成测试）
- 增加 CI（lint、build、test）
- 完善 API 文档与变更日志
- 补充更多 Markdown 语法支持与插件机制

## License

当前仓库为 `ISC`（见根目录 `package.json`）。
