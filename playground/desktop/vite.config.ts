import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG)
  },
  resolve: {
    alias: [
      {
        find: '@mark-it/core/style.css',
        replacement: path.resolve(__dirname, '../../packages/core/src/styles/main.css')
      },
      {
        find: '@mark-it/core',
        replacement: path.resolve(__dirname, '../../packages/core/src/index.ts')
      }
    ]
  }
});
