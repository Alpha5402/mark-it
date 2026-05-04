/**
 * 全局 window.__markit 注入的类型声明
 * 实际实现见 playground/src/App.tsx
 */
declare global {
  interface Window {
    __markit: {
      readonly editor: any
      readonly renderer: any
      reset: (markdown?: string) => void
      getMarkdown: () => string
    }
    __markitReady: boolean
  }
}

export {}
