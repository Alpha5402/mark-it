import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  // 1. 启用 React 插件，让 Vite 能看懂 JSX
  plugins: [react()],
  
  resolve: {
    alias: [
      {
        // 1. 优先匹配 CSS 文件
        // 注意：请核对你 core/src 下到底是 style.css 还是 styles.css，这里要和文件名一致
        find: '@mark-it/core/style.css',
        replacement: path.resolve(__dirname, '../packages/core/src/main.css')
      },
      {
        // 2. 也是比较好的习惯：匹配 core 里的其他文件（如果你将来有 utils 之类的）
        // 这条规则允许你 import '@mark-it/core/utils/foo' -> '.../src/utils/foo'
        // 但前提是你不能用 index.ts 做入口，或者这个正则要写得更复杂。
        // 简单起见，我们先只加上面那条 CSS 规则，下面这条保持不变。
        
        // 3. 最后匹配包名主入口
        find: '@mark-it/core',
        replacement: path.resolve(__dirname, '../packages/core/src/index.ts')
      }
    ]
  }
})