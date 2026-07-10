import { useEffect, useRef } from 'react';
import { Editor, type Renderer } from 'mark-it-core';

declare global {
  interface Window {
    __markit?: {
      readonly editor: Editor | null;
      readonly renderer: Renderer | null;
      reset: (content?: string) => void;
      getMarkdown: () => string;
    };
    __markitReady?: boolean;
  }
}

/**
 * Minimal, deterministic host used by the editor behavior audit suite.
 * The product Web entry still renders the shared Electron UI; `?e2e=1`
 * deliberately removes application state so tests can exercise Mark-it core.
 */
export function EditorHarness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    const mount = (content = '') => {
      editorRef.current?.destroy();
      editorRef.current = null;
      if (!containerRef.current) return;
      containerRef.current.innerHTML = '';
      editorRef.current = new Editor(containerRef.current, '编辑行为巡检', content);
    };

    mount();
    window.__markit = {
      get editor() { return editorRef.current; },
      get renderer() { return null; },
      reset: mount,
      getMarkdown: () => editorRef.current?.getMarkdownSource() ?? ''
    };
    window.__markitReady = true;
    window.dispatchEvent(new Event('markit:ready'));

    return () => {
      editorRef.current?.destroy();
      editorRef.current = null;
      delete window.__markit;
      window.__markitReady = false;
    };
  }, []);

  return <div className="editor-audit-harness" ref={containerRef} />;
}
