import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App'; // 引入我们刚才写的 App 组件

const container = document.getElementById('root');
const root = createRoot(container);

// 渲染 App
root.render(<App />);