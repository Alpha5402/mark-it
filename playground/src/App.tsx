import React, { useEffect, useRef, useState } from 'react';
import { Layout, Button } from 'tdesign-react';
import 'tdesign-react/es/style/index.css';
import './App.css'; 
import { Editor, Renderer, DocumentMetadata } from '@mark-it/core';

const { Header, Content } = Layout;

const App: React.FC = () => {
  const initialContent = `# h1
## h2
### h3
#### h4
##### h5
###### h6

- 这是一个无序列表
- 这是一个无序列表
	- 这是一个**无序列表**和测试文本
	- 这是一个无序列表和测试文本
		- 这是一个无序列表
		- 这是一个无序列表
     - 这是一个单空格测试样例

1. 这是一个有序列表
2. 这是一个有序列表
	1. 这是一个有序列表
	2. 这是一个有序列表
		1. 这是一个有序列表
		2. 这是一个有序列表

- [ ] 这是一个未完成的任务
- [x] 这是一个已完成的任务
- [ ] 还有一个待办事项
- [x] 已经搞定的事情

这是一个包含了**加粗**、*斜体*、_斜体_、~~删除线~~、==高亮==、[超链接](https://www.baidu.com)的文本。啊啊啊啊啊啊 saki 酱，saki 酱，saki 酱，saki 酱，saki 酱，saki 酱，saki 酱，saki 酱，saki 酱，saki 酱，saki 酱

这是一张图片：![Mark It Logo](https://via.placeholder.com/200x100?text=Mark+It)

---

> 这是一段引用文本
> 引用的**第二行**

| 功能 | 状态 | 备注 |
| :--- | :---: | ---: |
| 快捷键 | ✅ | Ctrl+B/I/K |
| 任务列表 | ✅ | checkbox 交互 |
| 表格 | ✅ | 支持对齐 |
| 图片 | ✅ | 内联渲染 |
| 数学公式 | ✅ | KaTeX 渲染 |
| 脚注 | ✅ | 引用 + 定义 |

\`\`\`javascript
function hello() {
  console.log("Hello, World!")
  return {
    name: "Mark It",
    version: "1.0.0"
  }
}
\`\`\`

## 数学公式测试

行内公式：质能方程 $E=mc^2$，以及二次方程求根公式 $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$。

欧拉公式 $e^{i\\pi} + 1 = 0$ 被誉为数学中最美的公式。

块级公式 — 高斯积分：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

矩阵表示：

$$
A = \\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix}
$$

求和公式：

$$
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

## 脚注测试

Markdown 是一种轻量级标记语言[^1]，由 John Gruber 于 2004 年创建[^gruber]。

Mark It 编辑器支持实时预览[^2]，并且支持多种扩展语法，包括数学公式[^math]和脚注。

[^1]: Markdown 最初的设计目标是让文档的源码也具有可读性。
[^gruber]: John Gruber 是 Daring Fireball 博客的作者，也是 Markdown 的发明者。
[^2]: 实时预览功能基于自研的增量渲染引擎实现。
[^math]: 数学公式渲染基于 KaTeX 库实现，支持大部分 LaTeX 数学语法。`;
  
  const editorModel = true;
  const containerRef = useRef<HTMLDivElement>(null);
  const editorInstance = useRef<Editor | null>(null);
  const rendererRef = useRef<HTMLDivElement>(null);
  const rendererInstance = useRef<Renderer | null>(null);

  const metadata: DocumentMetadata = {
    items: [
      { label: '作者', value: 'Mark It Team' },
      { label: '更新时间', value: '2026-05-03' },
      { label: '版本', value: 'v1.2.0' },
      { label: '标签', value: 'Markdown · 编辑器' }
    ]
  };

  // markdown 源文本状态，供左侧面板实时展示
  const [markdownSource, setMarkdownSource] = useState<string>(initialContent);

  // e2e 场景：URL 中带 ?e2e=1 时使用空初始内容，避免默认示例干扰断言
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isE2E = searchParams?.get('e2e') === '1';
  const bootstrapContent = isE2E ? '' : initialContent;

  useEffect(() => {
    if (!containerRef.current && !rendererRef.current) return;

    const mount = (content: string) => {
      // 清理旧实例
      editorInstance.current?.destroy();
      rendererInstance.current?.destroy();
      editorInstance.current = null;
      rendererInstance.current = null;
      if (containerRef.current) containerRef.current.innerHTML = '';

      if (editorModel) {
        editorInstance.current = new Editor(
          containerRef.current!,
          '功能测试文档',
          content,
          metadata
        );
        editorInstance.current.onContentChange((markdown: string) => {
          setMarkdownSource(markdown);
        });
        // 同步一次
        setMarkdownSource(editorInstance.current.getMarkdownSource());
      } else {
        rendererInstance.current = new Renderer(
          containerRef.current!,
          '功能测试文档',
          content
        );
      }
    };

    mount(bootstrapContent);

    // ========== e2e 全局 hook ==========
    // 将 editor/mount 暴露到 window，供 Playwright 直接调用
    (window as any).__markit = {
      get editor() { return editorInstance.current; },
      get renderer() { return rendererInstance.current; },
      /** 用指定 markdown 重新挂载 editor */
      reset: (content: string = '') => {
        mount(content);
      },
      /** 便捷读取 */
      getMarkdown: () => editorInstance.current?.getMarkdownSource() ?? '',
    };
    // 标记已就绪
    (window as any).__markitReady = true;
    window.dispatchEvent(new Event('markit:ready'));

    return () => {
      editorInstance.current?.destroy();
      rendererInstance.current?.destroy();
      delete (window as any).__markit;
      (window as any).__markitReady = false;
    };
  }, []);

  return (
    <Layout className="app-layout">
      {/* 公共头部 */}
      <Header className="app-header">
        <h3>Mark it</h3>
        <div className="format-toolbar" role="toolbar" aria-label="格式化工具">
          <button type="button" title="加粗 (⌘B)" onClick={() => editorInstance.current?.toggleBold()}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>
          </button>
          <button type="button" title="斜体 (⌘I)" onClick={() => editorInstance.current?.toggleItalic()}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
          </button>
          <button type="button" title="删除线 (⌘D)" onClick={() => editorInstance.current?.toggleStrikethrough()}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4H9a3 3 0 0 0 0 6h6"/><path d="M8 20h7a3 3 0 0 0 0-6H4"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
          </button>
          <button type="button" title="高亮 (⌘⇧H)" onClick={() => editorInstance.current?.toggleHighlight()}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" title="代码 (⌘E)" onClick={() => editorInstance.current?.toggleCode()}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          </button>
          <button type="button" title="链接 (⌘K)" onClick={() => editorInstance.current?.insertLink()}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </button>
        </div>
      </Header>

      {/* 内容区域：左右分栏 */}
      <Content className="app-content">
        {/* 左侧：Markdown 源文本（只读） */}
        <div className="source-pane">
          <div className="pane-header">MARKDOWN SOURCE</div>
          <div className="source-scroll">
            <pre className="source-pre">{markdownSource}</pre>
          </div>
        </div>

        {/* 右侧：编辑器渲染区 */}
        <div className="render-layout">
          <div className='renderer-container' ref={containerRef}></div>
        </div>
      </Content>
    </Layout>
  );
};

export default App;
