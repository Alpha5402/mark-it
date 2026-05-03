import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Editor, Renderer } from '@mark-it/core';
import logoUrl from './logo.svg';

type Mode = 'edit' | 'read';
type FileNode = WorkspaceTreeNode;
type ActiveDocument = {
  path: string | null;
  name: string;
};

const minSidebarWidth = 216;
const maxSidebarWidth = 380;
const collapseThreshold = 176;
const collapsedSidebarWidth = 52;
const autoSaveDelay = 900;
const draftStorageKey = 'mark-it-desktop:draft';

function getStats(markdown: string) {
  const compact = markdown.replace(/\s/g, '');
  return {
    words: compact.length,
    lines: markdown ? markdown.split(/\r\n|\r|\n/).length : 0,
    blocks: markdown ? markdown.split(/\n{2,}/).filter(Boolean).length : 0
  };
}

function formatSaveTime(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date).replace(':', '：');
}

function isDirectory(node: FileNode) {
  return node.type === 'directory';
}

function FolderIcon() {
  return (
    <svg className="tree-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3.25 7.25C3.25 6.42 3.92 5.75 4.75 5.75H9.2C9.74 5.75 10.24 6.02 10.54 6.47L11.45 7.85H19.25C20.08 7.85 20.75 8.52 20.75 9.35V18.25C20.75 19.08 20.08 19.75 19.25 19.75H4.75C3.92 19.75 3.25 19.08 3.25 18.25V7.25Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M3.8 9.25H20.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg className="tree-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="5.5"
        y="3.5"
        width="13"
        height="17"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M8.5 8H15.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M8.5 12H15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M8.5 16H13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <svg className="rail-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="16" height="14" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9 5V19" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }

  return (
    <svg className="rail-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.2 8.3V15.7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="rail-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.35 3.75H13.65L14.25 6.05C14.82 6.25 15.36 6.56 15.85 6.94L18.12 6.26L19.76 9.11L18.08 10.75C18.14 11.15 18.18 11.57 18.18 12C18.18 12.43 18.14 12.85 18.08 13.25L19.76 14.89L18.12 17.74L15.85 17.06C15.36 17.44 14.82 17.75 14.25 17.95L13.65 20.25H10.35L9.75 17.95C9.18 17.75 8.64 17.44 8.15 17.06L5.88 17.74L4.24 14.89L5.92 13.25C5.86 12.85 5.82 12.43 5.82 12C5.82 11.57 5.86 11.15 5.92 10.75L4.24 9.11L5.88 6.26L8.15 6.94C8.64 6.56 9.18 6.25 9.75 6.05L10.35 3.75Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.65"
      />
      <circle cx="12" cy="12" r="3.05" fill="none" stroke="currentColor" strokeWidth="1.65" />
    </svg>
  );
}

export default function App() {
  const [mode, setMode] = useState<Mode>('edit');
  const [markdown, setMarkdown] = useState('');
  const [documentTitle, setDocumentTitle] = useState('未打开文档');
  const [activeDocument, setActiveDocument] = useState<ActiveDocument | null>(null);
  const [revision, setRevision] = useState(0);
  const [savedAt, setSavedAt] = useState<string>('等待打开文档');
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceTree, setWorkspaceTree] = useState<FileNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(292);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [platform, setPlatform] = useState('darwin');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const latestMarkdownRef = useRef(markdown);
  const hasOpenDocument = Boolean(activeDocument);
  const stats = useMemo(() => getStats(markdown), [markdown]);
  const shellStyle = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--sidebar-track': isSidebarCollapsed ? `${collapsedSidebarWidth}px` : `${sidebarWidth}px`
  } as React.CSSProperties;
  const showAppChrome = Boolean(workspaceTree || hasOpenDocument);

  useEffect(() => {
    latestMarkdownRef.current = markdown;
  }, [markdown]);

  useEffect(() => {
    if (!window.markItWindow) return;

    window.markItWindow.getState().then((state) => {
      setPlatform(state.platform);
      setIsFullScreen(state.isFullScreen);
    });

    return window.markItWindow.onStateChange((state) => {
      setPlatform(state.platform);
      setIsFullScreen(state.isFullScreen);
    });
  }, []);

  useEffect(() => {
    if (!hasOpenDocument) return;

    const timer = window.setTimeout(async () => {
      const savedAtText = formatSaveTime(new Date());
      const content = latestMarkdownRef.current;

      if (activeDocument?.path && window.markItWorkspace) {
        await window.markItWorkspace.writeFile(activeDocument.path, content);
      } else {
        localStorage.setItem(draftStorageKey, JSON.stringify({
          documentTitle,
          markdown: content,
          savedAt: savedAtText
        }));
      }

      setSavedAt(`最近一次保存于 ${savedAtText}`);
    }, autoSaveDelay);

    return () => window.clearTimeout(timer);
  }, [activeDocument?.path, documentTitle, hasOpenDocument, markdown]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasOpenDocument) return;

    container.innerHTML = '';
    editorRef.current?.destroy();
    rendererRef.current?.destroy();
    editorRef.current = null;
    rendererRef.current = null;

    if (mode === 'edit') {
      const editor = new Editor(container, documentTitle, markdown);
      editor.onContentChange((nextMarkdown: string) => {
        latestMarkdownRef.current = nextMarkdown;
        setMarkdown(nextMarkdown);
        setSavedAt('正在自动保存...');
      });
      editorRef.current = editor;
    } else {
      rendererRef.current = new Renderer(container, documentTitle, markdown);
    }

    return () => {
      editorRef.current?.destroy();
      rendererRef.current?.destroy();
      editorRef.current = null;
      rendererRef.current = null;
    };
  }, [documentTitle, hasOpenDocument, mode, revision]);

  const applyWorkspace = (workspace: WorkspaceOpenResult | null) => {
    if (!workspace) return;
    setWorkspaceName(workspace.rootName);
    setWorkspaceTree(workspace.tree);
    setExpandedPaths(new Set([workspace.rootPath]));
    setIsSidebarCollapsed(false);
  };

  const openWorkspace = async () => {
    if (!window.markItWorkspace) return;
    applyWorkspace(await window.markItWorkspace.openFolder());
  };

  const createWorkspace = async () => {
    if (!window.markItWorkspace) return;
    applyWorkspace(await window.markItWorkspace.newFolder());
  };

  const loadMarkdownFile = (file: MarkdownFileResult) => {
    latestMarkdownRef.current = file.content;
    setMarkdown(file.content);
    setDocumentTitle(file.name.replace(/\.md$/i, '') || file.name);
    setActiveDocument({ path: file.path, name: file.name });
    setSavedAt('等待自动保存');
    setMode('edit');
    setRevision((current) => current + 1);
  };

  const openMarkdownFile = async () => {
    if (window.markItWorkspace) {
      const file = await window.markItWorkspace.openFile();
      if (file) loadMarkdownFile(file);
      return;
    }

    fileInputRef.current?.click();
  };

  const openBrowserFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      loadMarkdownFile({
        path: '',
        name: file.name,
        content: String(reader.result ?? '')
      });
    };
    reader.readAsText(file);
  };

  const selectTreeFile = async (node: FileNode) => {
    if (!window.markItWorkspace || node.type !== 'file') return;
    loadMarkdownFile(await window.markItWorkspace.readFile(node.path));
  };

  const toggleDirectory = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const startSidebarResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const wasCollapsed = isSidebarCollapsed;
    const startX = event.clientX;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.round(moveEvent.clientX);

      if (wasCollapsed) {
        if (moveEvent.clientX > startX + 2) {
          document.body.classList.remove('is-resizing-sidebar');
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          setSidebarWidth(Math.min(maxSidebarWidth, Math.max(minSidebarWidth, nextWidth)));
          setIsSidebarCollapsed(false);
        }
        return;
      }

      if (nextWidth <= collapseThreshold) {
        document.body.classList.remove('is-resizing-sidebar');
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        setSidebarWidth(minSidebarWidth);
        requestAnimationFrame(() => setIsSidebarCollapsed(true));
        return;
      }

      setIsSidebarCollapsed(false);
      setSidebarWidth(Math.min(maxSidebarWidth, Math.max(minSidebarWidth, nextWidth)));
    };

    const onMouseUp = () => {
      document.body.classList.remove('is-resizing-sidebar');
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    document.body.classList.add('is-resizing-sidebar');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [isSidebarCollapsed]);

  const renderTreeNode = (node: FileNode, depth = 0) => {
    const expanded = expandedPaths.has(node.path);
    const active = activeDocument?.path === node.path;

    if (isDirectory(node)) {
      return (
        <div className="tree-group" key={node.path}>
          <button
            type="button"
            className="tree-row directory-row"
            style={{ paddingLeft: 12 + depth * 14 }}
            onClick={() => toggleDirectory(node.path)}
          >
            <span className={`tree-caret ${expanded ? 'expanded' : ''}`}>›</span>
            <span className="tree-icon"><FolderIcon /></span>
            <span className="tree-name">{node.name}</span>
          </button>
          {expanded && node.children?.map((child) => renderTreeNode(child, depth + 1))}
        </div>
      );
    }

    return (
      <button
        type="button"
        key={node.path}
        className={`tree-row file-row ${active ? 'active' : ''}`}
        style={{ paddingLeft: 34 + depth * 14 }}
        onClick={() => selectTreeFile(node)}
      >
        <span className="tree-icon"><NoteIcon /></span>
        <span className="tree-name">{node.name}</span>
      </button>
    );
  };

  if (!showAppChrome) {
    return (
      <main className="welcome-shell">
        <div className="welcome-stage">
          <div className="welcome-mark">
            <img src={logoUrl} alt="" />
          </div>
          <h1>Mark It</h1>
          <p>打开一个 Markdown 文件夹，或直接打开单个文档开始写作。</p>
          <div className="welcome-actions">
            <button type="button" onClick={createWorkspace}>新建文件夹</button>
            <button type="button" onClick={openWorkspace}>打开文件夹</button>
            <button type="button" onClick={openMarkdownFile}>打开文件</button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          accept=".md,text/markdown"
          onChange={openBrowserFile}
        />
      </main>
    );
  }

  return (
    <main
      className={`desktop-shell platform-${platform} ${isFullScreen ? 'is-fullscreen' : ''} ${isSidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}
      style={shellStyle}
    >
      <header className="topbar">
        <div className="mode-switch" role="group" aria-label="切换模式">
          <button
            type="button"
            className={mode === 'edit' ? 'active' : ''}
            disabled={!hasOpenDocument}
            onClick={() => setMode('edit')}
          >
            编辑
          </button>
          <button
            type="button"
            className={mode === 'read' ? 'active' : ''}
            disabled={!hasOpenDocument}
            onClick={() => setMode('read')}
          >
            阅读
          </button>
        </div>
        <div className="document-heading" title={documentTitle}>
          <span>{documentTitle}</span>
          <small>{savedAt}</small>
        </div>
        <div className="topbar-stats" aria-label="文档统计">
          <div>
            <span>{stats.words}</span>
            <small>字符</small>
          </div>
          <div>
            <span>{stats.lines}</span>
            <small>行</small>
          </div>
          <div>
            <span>{stats.blocks}</span>
            <small>段落</small>
          </div>
        </div>
      </header>

      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="brand">
          <img src={logoUrl} alt="" className="brand-logo" />
          <div className="brand-copy">
            <div className="brand-name">Mark It</div>
            <div className="brand-meta">{workspaceName || 'Desktop writer'}</div>
          </div>
        </div>

        <div className="sidebar-main">
          {workspaceTree ? (
            <div className="file-tree" aria-label="Markdown 文件树">
              {renderTreeNode(workspaceTree)}
            </div>
          ) : (
            <div className="sidebar-empty">打开文件夹后，这里会显示 Markdown 文件树。</div>
          )}
        </div>

        <div className="sidebar-rail-actions">
          <button
            type="button"
            className="rail-button"
            title={isSidebarCollapsed ? '展开边栏' : '收起边栏'}
            aria-label={isSidebarCollapsed ? '展开边栏' : '收起边栏'}
            onClick={() => setIsSidebarCollapsed((current) => !current)}
          >
            <SidebarToggleIcon collapsed={isSidebarCollapsed} />
          </button>
          <button
            type="button"
            className="rail-button"
            title="设置"
            aria-label="设置"
          >
            <SettingsIcon />
          </button>
        </div>

        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          accept=".md,text/markdown"
          onChange={openBrowserFile}
        />
      </aside>

      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="调整边栏宽度"
        aria-orientation="vertical"
        onMouseDown={startSidebarResize}
      />

      <section className="workspace">
        {hasOpenDocument ? (
          <div className="paper-stage">
            <div className="paper" ref={containerRef} />
          </div>
        ) : null}
      </section>
    </main>
  );
}
