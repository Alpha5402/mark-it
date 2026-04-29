import React, { useEffect, useRef, useState } from 'react';
import { Layout, Button } from 'tdesign-react';
import 'tdesign-react/es/style/index.css';
import './App.css'; 
import { Editor, Renderer } from '@mark-it/core';

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

\`\`\`javascript
function hello() {
  console.log("Hello, World!")
  return {
    name: "Mark It",
    version: "1.0.0"
  }
}
\`\`\``;
  
  const editorModel = true;
  const containerRef = useRef<HTMLDivElement>(null);
  const editorInstance = useRef<Editor | null>(null);
  const rendererRef = useRef<HTMLDivElement>(null);
  const rendererInstance = useRef<Renderer | null>(null);

  // markdown 源文本状态，供左侧面板实时展示
  const [markdownSource, setMarkdownSource] = useState<string>(initialContent);

  useEffect(() => {
    if (!containerRef.current && !rendererRef.current) return;

    if (editorModel) {
      editorInstance.current = new Editor(
        containerRef.current!, 
        '未命名',
        initialContent
      );

      // 注册内容变化回调，实时更新源文本
      editorInstance.current.onContentChange((markdown: string) => {
        setMarkdownSource(markdown);
      });
    } else {
      rendererInstance.current = new Renderer(
        containerRef.current!,
        '未命名',
        initialContent
      );
    }

    return () => {
      editorInstance.current?.destroy();
      rendererInstance.current?.destroy();
    };
  }, []);

  return (
    <Layout className="app-layout">
      {/* 公共头部 */}
      <Header className="app-header">
        <h3>Mark it</h3>
        <div className="button-container">
          <Button className='import-btn'>上传文档</Button>
          <Button className='import-btn'>导出</Button>
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
