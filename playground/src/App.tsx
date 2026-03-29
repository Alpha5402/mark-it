import React, { useEffect, useRef } from 'react';
import { Layout, Row, Col, Button } from 'tdesign-react';
import 'tdesign-react/es/style/index.css';
import './App.css'; 
// import { useMarkdown } from './hooks/useMarkdown';
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

这是一个包含了**加粗**、*斜体*、_斜体_、~~删除线~~、==高亮==、[超链接](https://www.baidu.com)的文本。啊啊啊啊啊啊 saki 酱，saki 酱，saki 酱，saki 酱，saki 酱，saki 酱，saki 酱，saki 酱，saki 酱，saki 酱，saki 酱`
  
  const editorModel = true
  // const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
  //   setMarkdown(e.target.value);
  // };
  const containerRef = useRef<HTMLDivElement>(null);

  const editorInstance = useRef<Editor | null>(null);
  const rendererRef = useRef<HTMLDivElement>(null)
  const rendererInstance = useRef<Renderer | null> (null)
  useEffect(() => {
    if (!containerRef.current && !rendererRef.current) return;

    if (editorModel) {
      editorInstance.current = new Editor(
        containerRef.current, 
        '未命名',
        initialContent
      );
    } else {
      rendererInstance.current = new Renderer(
        containerRef.current,
        '未命名',
        initialContent
      )
    }

    return () => {
      editorInstance.current?.destroy();
      rendererInstance.current?.destroy();
    };
  }, []); // 空数组表示只在挂载时执行一次

  return (
    <Layout className="app-layout">
      {/* 1. 公共头部：不需要写两遍 */}
      <Header className="app-header">
        <h3>Mark it</h3>
        <div className="button-container">
          <Button className='import-btn'>上传文档</Button>
          <Button className='import-btn'>导出</Button>
        </div>
      </Header>

      {/* 2. 内容区域：根据模式切换 */}
      <Content className="app-content">
        <div className="render-layout">
          <div className='renderer-container' ref={containerRef}></div>
        </div>
      </Content>
    </Layout>
  );
};

export default App;