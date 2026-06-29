import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Editor, Renderer } from 'mark-it-core';
import logoUrl from './logo.svg';

type Mode = 'edit' | 'read';
type FileNode = WorkspaceTreeNode;
type FormatShortcutAction = 'bold' | 'italic' | 'strikethrough' | 'highlight' | 'code' | 'link';
type FormatOrbState = 'compact' | 'expanded';
type FormatShortcutStatus = 'active' | 'inactive' | 'mixed';
type FormatShortcutState = Record<FormatShortcutAction, FormatShortcutStatus>;
type TabSession = {
  id: string;
  path: string | null;
  name: string;
  content: string;
  savedAtLabel: string;
  isDirty: boolean;
};
type ContextMenuState =
  | { kind: 'tree-file'; x: number; y: number; node: FileNode }
  | { kind: 'tree-directory'; x: number; y: number; node: FileNode }
  | { kind: 'tab'; x: number; y: number; tabId: string }
  | { kind: 'editor-block'; x: number; y: number; blockId: string; blockType: string; raw: string }
  | { kind: 'editor-surface'; x: number; y: number };
type ContextMenuPayload = ContextMenuState extends infer Menu
  ? Menu extends ContextMenuState
    ? Omit<Menu, 'x' | 'y'>
    : never
  : never;
type ContextMenuItem = {
  label: string;
  hint?: string;
  icon?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  children?: ContextMenuItem[];
  action?: () => void | Promise<void>;
};

const minSidebarWidth = 216;
const maxSidebarWidth = 380;
const collapseThreshold = 176;
const collapsedSidebarWidth = 52;
const autoSaveDelay = 900;
const draftStorageKey = 'mark-it-desktop:draft';
const inactiveFormatShortcutState: FormatShortcutState = {
  bold: 'inactive',
  italic: 'inactive',
  strikethrough: 'inactive',
  highlight: 'inactive',
  code: 'inactive',
  link: 'inactive'
};

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

function blockTypeLabel(type: string) {
  if (type === 'paragraph') return '段落';
  if (type === 'heading') return '标题';
  if (type === 'list-item') return '列表';
  if (type === 'blockquote') return '引用';
  if (type === 'code-block') return '代码块';
  if (type === 'math-block') return '公式块';
  if (type === 'table') return '表格';
  if (type === 'hr') return '分割线';
  if (type === 'blank') return '空行';
  return 'Markdown 块';
}

function isTaskListRaw(raw: string) {
  return /^\s*[-*+] \[(?: |x|X)\]\s/.test(raw);
}

function isCheckedTaskRaw(raw: string) {
  return /^\s*[-*+] \[(?:x|X)\]\s/.test(raw);
}

function getCodeBlockLanguageFromRaw(raw: string) {
  const firstLine = raw.split('\n', 1)[0] ?? '';
  const match = firstLine.match(/^(`{3,}|~{3,})(.*)$/);
  return match ? match[2].trim() : '';
}

function getCodeBlockFenceFromRaw(raw: string) {
  const firstLine = raw.split('\n', 1)[0] ?? '';
  const match = firstLine.match(/^(`{3}|~{3})(.*)$/);
  return match ? match[1] : '```';
}

function isConvertibleTextBlock(type: string) {
  return type === 'paragraph' ||
    type === 'heading' ||
    type === 'list-item' ||
    type === 'blockquote' ||
    type === 'blank';
}

function getFormatShortcutAction(event: KeyboardEvent): FormatShortcutAction | null {
  const key = event.key.toLowerCase();
  if (key === 'b' && !event.shiftKey) return 'bold';
  if (key === 'i' && !event.shiftKey) return 'italic';
  if (key === 'd' && !event.shiftKey) return 'strikethrough';
  if (key === 'h' && event.shiftKey) return 'highlight';
  if (key === 'e' && !event.shiftKey) return 'code';
  if (key === 'k' && !event.shiftKey) return 'link';
  return null;
}

const formatShortcutItems: Array<{
  action: FormatShortcutAction;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    action: 'bold',
    label: 'B',
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/></svg>
  },
  {
    action: 'italic',
    label: 'I',
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
  },
  {
    action: 'strikethrough',
    label: 'D',
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4H9a3 3 0 0 0 0 6h6"/><path d="M8 20h7a3 3 0 0 0 0-6H4"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
  },
  {
    action: 'highlight',
    label: '⇧H',
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
  },
  {
    action: 'code',
    label: 'E',
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
  },
  {
    action: 'link',
    label: 'K',
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
  }
];

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
  const [tabs, setTabs] = useState<TabSession[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceTree, setWorkspaceTree] = useState<FileNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(292);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [platform, setPlatform] = useState('darwin');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [hasFormatSelection, setHasFormatSelection] = useState(false);
  const [isShortcutHintExpanded, setIsShortcutHintExpanded] = useState(false);
  const [formatShortcutState, setFormatShortcutState] = useState<FormatShortcutState>(inactiveFormatShortcutState);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const latestMarkdownRef = useRef('');
  const hasRestoredSessionRef = useRef(false);
  const isCommandKeyDownRef = useRef(false);
  const refreshFormatSelectionRef = useRef<() => void>(() => undefined);
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, tabs]
  );
  const hasOpenDocument = Boolean(activeTab);
  const stats = useMemo(() => getStats(activeTab?.content ?? ''), [activeTab?.content]);
  const formatOrbState: FormatOrbState = isShortcutHintExpanded ? 'expanded' : 'compact';
  const shellStyle = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--sidebar-track': isSidebarCollapsed ? `${collapsedSidebarWidth}px` : `${sidebarWidth}px`
  } as React.CSSProperties;
  const showAppChrome = Boolean(workspaceTree || hasOpenDocument);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const openContextMenu = useCallback((
    event: React.MouseEvent,
    nextMenu: ContextMenuPayload
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 232;
    const menuHeight = 260;
    setContextMenu({
      ...nextMenu,
      x: Math.min(event.clientX, Math.max(12, window.innerWidth - menuWidth - 12)),
      y: Math.min(event.clientY, Math.max(12, window.innerHeight - menuHeight - 12))
    } as ContextMenuState);
  }, []);

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  }, []);

  useEffect(() => {
    const navWithOverlay = navigator as Navigator & {
      windowControlsOverlay?: {
        visible: boolean;
        getTitlebarAreaRect: () => DOMRect;
        addEventListener: (type: 'geometrychange', listener: () => void) => void;
        removeEventListener: (type: 'geometrychange', listener: () => void) => void;
      };
    };
    const overlay = navWithOverlay.windowControlsOverlay;
    if (!overlay || !overlay.visible) return;

    const applyTitlebarMetrics = () => {
      const rect = overlay.getTitlebarAreaRect();
      document.documentElement.style.setProperty('--titlebar-content-x', `${rect.x}px`);
      document.documentElement.style.setProperty('--titlebar-content-width', `${rect.width}px`);
    };

    applyTitlebarMetrics();
    overlay.addEventListener('geometrychange', applyTitlebarMetrics);
    return () => overlay.removeEventListener('geometrychange', applyTitlebarMetrics);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;

    const close = () => closeContextMenu();
    const closeWhenOutsideMenu = (event: PointerEvent | MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.context-menu')) return;
      closeContextMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };

    document.addEventListener('pointerdown', closeWhenOutsideMenu, true);
    document.addEventListener('contextmenu', closeWhenOutsideMenu, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', closeWhenOutsideMenu, true);
      document.removeEventListener('contextmenu', closeWhenOutsideMenu, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeContextMenu, contextMenu]);

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
    const updateFormatSelection = () => {
      const selection = window.getSelection();
      const anchorNode = selection?.anchorNode ?? null;
      const focusNode = selection?.focusNode ?? null;
      const selectedText = selection?.toString().trim() ?? '';
      const nextHasSelection = Boolean(
        mode === 'edit' &&
        activeTabId &&
        containerRef.current &&
        selection &&
        !selection.isCollapsed &&
        selectedText &&
        anchorNode &&
        focusNode &&
        containerRef.current.contains(anchorNode) &&
        containerRef.current.contains(focusNode)
      );

      setHasFormatSelection(nextHasSelection);
      setFormatShortcutState(
        nextHasSelection
          ? editorRef.current?.getSelectionInlineFormatState() ?? inactiveFormatShortcutState
          : inactiveFormatShortcutState
      );
    };
    refreshFormatSelectionRef.current = updateFormatSelection;

    const updateAfterInteraction = () => {
      window.requestAnimationFrame(updateFormatSelection);
    };
    const hideBeforeInteraction = () => {
      setHasFormatSelection(false);
      setFormatShortcutState(inactiveFormatShortcutState);
      setIsShortcutHintExpanded(false);
    };

    document.addEventListener('mousedown', hideBeforeInteraction);
    window.addEventListener('mouseup', updateAfterInteraction);
    window.addEventListener('keyup', updateAfterInteraction);

    return () => {
      document.removeEventListener('mousedown', hideBeforeInteraction);
      window.removeEventListener('mouseup', updateAfterInteraction);
      window.removeEventListener('keyup', updateAfterInteraction);
      refreshFormatSelectionRef.current = () => undefined;
    };
  }, [activeTabId, mode]);

  useEffect(() => {
    const applyShortcutAction = (action: FormatShortcutAction) => {
      const editor = editorRef.current;
      if (!editor) return;
      if (action === 'bold') editor.toggleBold();
      else if (action === 'italic') editor.toggleItalic();
      else if (action === 'strikethrough') editor.toggleStrikethrough();
      else if (action === 'highlight') editor.toggleHighlight();
      else if (action === 'code') editor.toggleCode();
      else if (action === 'link') editor.insertLink();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const action = getFormatShortcutAction(event);
      const commandPressed = event.metaKey || event.ctrlKey;

      if (event.key === 'Meta' || event.key === 'Control') {
        isCommandKeyDownRef.current = true;
        if (hasFormatSelection) setIsShortcutHintExpanded(true);
        return;
      }

      if (commandPressed) {
        isCommandKeyDownRef.current = true;
        if (hasFormatSelection) setIsShortcutHintExpanded(true);
      }

      if (!hasFormatSelection || !commandPressed) {
        return;
      }

      if (!action) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (formatShortcutState[action] === 'mixed') return;
      applyShortcutAction(action);
      setIsShortcutHintExpanded(true);
      window.requestAnimationFrame(() => refreshFormatSelectionRef.current());
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Meta' || event.key === 'Control') {
        isCommandKeyDownRef.current = false;
        setIsShortcutHintExpanded(false);
      }
    };
    const onBlur = () => {
      isCommandKeyDownRef.current = false;
      setIsShortcutHintExpanded(false);
      setFormatShortcutState(inactiveFormatShortcutState);
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [formatShortcutState, hasFormatSelection]);

  useEffect(() => {
    if (!window.markItWorkspace) return;

    let isMounted = true;
    Promise.all([
      window.markItWorkspace.restoreLastFolder(),
      window.markItWorkspace.restoreSession()
    ]).then(([workspace, session]) => {
      if (!isMounted) return;
      if (workspace) applyWorkspace(workspace);

      if (!hasRestoredSessionRef.current && session?.tabs?.length) {
        const restoredTabs: TabSession[] = session.tabs.map((tab) => ({
          id: tab.id,
          path: tab.path,
          name: tab.name,
          content: tab.content,
          isDirty: tab.isDirty,
          savedAtLabel: tab.isDirty ? '已恢复未保存内容' : '已恢复'
        }));
        hasRestoredSessionRef.current = true;
        setTabs(restoredTabs);
        setActiveTabId(session.activeTabId ?? restoredTabs[0]?.id ?? null);
        setMode('edit');
        setRevision((current) => current + 1);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activeTab) return;
    latestMarkdownRef.current = activeTab.content;
  }, [activeTab?.content]);

  useEffect(() => {
    if (!activeTab) return;

    const { id: tabId, path: tabPath, name: tabName } = activeTab;
    const timer = window.setTimeout(async () => {
      const savedAtText = formatSaveTime(new Date());
      const content = latestMarkdownRef.current;

      if (tabPath && window.markItWorkspace) {
        await window.markItWorkspace.writeFile(tabPath, content);
      } else {
        localStorage.setItem(draftStorageKey, JSON.stringify({
          documentTitle: tabName.replace(/\.md$/i, '') || tabName,
          markdown: content,
          savedAt: savedAtText
        }));
      }

      setTabs((current) => current.map((tab) => (
        tab.id === tabId
          ? { ...tab, savedAtLabel: `最近一次保存于 ${savedAtText}`, isDirty: false }
          : tab
      )));
    }, autoSaveDelay);

    return () => window.clearTimeout(timer);
  }, [activeTab?.content, activeTab?.id, activeTab?.name, activeTab?.path]);

  useEffect(() => {
    if (!window.markItWorkspace) return;
    const timer = window.setTimeout(() => {
      window.markItWorkspace?.saveSession({
        activeTabId,
        tabs: tabs.map((tab) => ({
          id: tab.id,
          path: tab.path,
          name: tab.name,
          content: tab.content,
          isDirty: tab.isDirty
        }))
      });
    }, 260);

    return () => window.clearTimeout(timer);
  }, [activeTabId, tabs]);

  useEffect(() => {
    window.markItWorkspace?.setDirtyState(tabs.some((tab) => tab.isDirty));
  }, [tabs]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeTab) return;

    container.innerHTML = '';
    editorRef.current?.destroy();
    rendererRef.current?.destroy();
    editorRef.current = null;
    rendererRef.current = null;

    if (mode === 'edit') {
      const editor = new Editor(container, activeTab.name.replace(/\.md$/i, '') || activeTab.name, activeTab.content);
      editor.onContentChange((nextMarkdown: string) => {
        latestMarkdownRef.current = nextMarkdown;
        setTabs((current) => {
          let didChange = false;
          const nextTabs = current.map((tab) => {
            if (tab.id !== activeTab.id) return tab;
            if (tab.content === nextMarkdown) return tab;
            didChange = true;
            return { ...tab, content: nextMarkdown, savedAtLabel: '正在自动保存...', isDirty: true };
          });
          return didChange ? nextTabs : current;
        });
      });
      editorRef.current = editor;
    } else {
      rendererRef.current = new Renderer(
        container,
        activeTab.name.replace(/\.md$/i, '') || activeTab.name,
        activeTab.content
      );
    }

    return () => {
      editorRef.current?.destroy();
      rendererRef.current?.destroy();
      editorRef.current = null;
      rendererRef.current = null;
    };
  }, [activeTabId, mode, revision]);

  function applyWorkspace(workspace: WorkspaceOpenResult | null) {
    if (!workspace) return;
    setWorkspaceName(workspace.rootName);
    setWorkspaceTree(workspace.tree);
    setExpandedPaths(new Set([workspace.rootPath]));
    setIsSidebarCollapsed(false);
  }

  const openWorkspace = async () => {
    if (!window.markItWorkspace) return;
    applyWorkspace(await window.markItWorkspace.openFolder());
  };

  const createWorkspace = async () => {
    if (!window.markItWorkspace) return;
    applyWorkspace(await window.markItWorkspace.newFolder());
  };

  const openOrFocusFile = (file: MarkdownFileResult) => {
    const normalizedPath = file.path || null;
    if (normalizedPath) {
      const existing = tabs.find((tab) => tab.path === normalizedPath);
      if (existing) {
        latestMarkdownRef.current = existing.content;
        setActiveTabId(existing.id);
        setMode('edit');
        setRevision((current) => current + 1);
        return;
      }
    }

    const nextTab: TabSession = {
      id: normalizedPath ? `path:${normalizedPath}` : `local:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      path: normalizedPath,
      name: file.name,
      content: file.content,
      savedAtLabel: '等待自动保存',
      isDirty: false
    };

    latestMarkdownRef.current = nextTab.content;
    setTabs((current) => [...current, nextTab]);
    setActiveTabId(nextTab.id);
    setMode('edit');
    setRevision((current) => current + 1);
  };

  const closeTab = (tabId: string) => {
    const target = tabs.find((tab) => tab.id === tabId);
    if (!target) return;
    if (target.isDirty) {
      const shouldClose = window.confirm(`“${target.name}” 有未保存内容，确定关闭该标签页吗？`);
      if (!shouldClose) return;
    }

    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === tabId);
      if (index < 0) return current;

      const nextTabs = current.filter((tab) => tab.id !== tabId);
      if (activeTabId === tabId) {
        const fallback = nextTabs[index] ?? nextTabs[index - 1] ?? null;
        setActiveTabId(fallback?.id ?? null);
        latestMarkdownRef.current = fallback?.content ?? '';
        setRevision((currentRevision) => currentRevision + 1);
      }
      return nextTabs;
    });
  };

  const closeOtherTabs = (tabId: string) => {
    const target = tabs.find((tab) => tab.id === tabId);
    if (!target) return;

    const dirtyCount = tabs.filter((tab) => tab.id !== tabId && tab.isDirty).length;
    if (dirtyCount > 0) {
      const shouldClose = window.confirm(`其他标签中有 ${dirtyCount} 个未保存文档，确定关闭其他标签吗？`);
      if (!shouldClose) return;
    }

    setTabs([target]);
    setActiveTabId(target.id);
    latestMarkdownRef.current = target.content;
    setRevision((current) => current + 1);
  };

  const activateTab = (tabId: string) => {
    const target = tabs.find((tab) => tab.id === tabId);
    if (!target) return;
    latestMarkdownRef.current = target.content;
    setActiveTabId(target.id);
    setRevision((current) => current + 1);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const commandPressed = event.metaKey || event.ctrlKey;
      if (!commandPressed) return;

      if (event.key.toLowerCase() === 'w') {
        if (!activeTabId) return;
        event.preventDefault();
        closeTab(activeTabId);
        return;
      }

      if (event.key === 'Tab') {
        if (tabs.length <= 1 || !activeTabId) return;
        event.preventDefault();

        const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
        if (currentIndex < 0) return;
        const nextIndex = event.shiftKey
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : (currentIndex + 1) % tabs.length;
        const nextTab = tabs[nextIndex];
        if (!nextTab) return;

        latestMarkdownRef.current = nextTab.content;
        setActiveTabId(nextTab.id);
        setRevision((current) => current + 1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTabId, tabs]);

  const openMarkdownFile = async () => {
    if (window.markItWorkspace) {
      const file = await window.markItWorkspace.openFile();
      if (file) openOrFocusFile(file);
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
      openOrFocusFile({
        path: '',
        name: file.name,
        content: String(reader.result ?? '')
      });
    };
    reader.readAsText(file);
  };

  const selectTreeFile = async (node: FileNode) => {
    if (!window.markItWorkspace || node.type !== 'file') return;
    openOrFocusFile(await window.markItWorkspace.readFile(node.path));
  };

  const createMarkdownFileAt = async (node: FileNode) => {
    if (!window.markItWorkspace) return;
    const result = await window.markItWorkspace.createMarkdownFile(node.path);
    if (result.workspace) applyWorkspace(result.workspace);
    if (result.file) openOrFocusFile(result.file);
  };

  const createDirectoryAt = async (node: FileNode) => {
    if (!window.markItWorkspace) return;
    const result = await window.markItWorkspace.createDirectory(node.path);
    if (result.workspace) {
      applyWorkspace(result.workspace);
      setExpandedPaths((current) => {
        const next = new Set(current);
        next.add(node.path);
        if (result.path) next.add(result.path);
        return next;
      });
    }
  };

  const revealPath = async (path: string) => {
    await window.markItWorkspace?.revealPath(path);
  };

  const openEditorContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const blockEl = target?.closest('.md-line-block') as HTMLElement | null;
    const blockId = blockEl?.dataset.blockId;
    const surface = editorRef.current ?? rendererRef.current;

    if (!blockId || !surface) {
      openContextMenu(event, { kind: 'editor-surface' });
      return;
    }

    const block = surface.doc.getBlock(blockId);
    if (!block) {
      openContextMenu(event, { kind: 'editor-surface' });
      return;
    }

    openContextMenu(event, {
      kind: 'editor-block',
      blockId,
      blockType: block.type,
      raw: surface.doc.getRawText(blockId)
    });
  };

  const toggleDirectory = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!contextMenu) return [];

    if (contextMenu.kind === 'tree-directory') {
      const expanded = expandedPaths.has(contextMenu.node.path);
      return [
        { label: contextMenu.node.name, hint: '文件夹', disabled: true },
        { label: '', separator: true },
        { label: '新建笔记', hint: '.md', action: () => createMarkdownFileAt(contextMenu.node) },
        { label: '新建文件夹', action: () => createDirectoryAt(contextMenu.node) },
        { label: '', separator: true },
        {
          label: expanded ? '收起文件夹' : '展开文件夹',
          action: () => toggleDirectory(contextMenu.node.path)
        },
        { label: '', separator: true },
        { label: '复制路径', action: () => copyText(contextMenu.node.path) },
        { label: '在 Finder 中显示', action: () => revealPath(contextMenu.node.path) }
      ];
    }

    if (contextMenu.kind === 'tree-file') {
      return [
        { label: contextMenu.node.name, hint: 'Markdown', disabled: true },
        { label: '', separator: true },
        { label: '打开', action: () => selectTreeFile(contextMenu.node) },
        { label: '新建同级笔记', hint: '.md', action: () => createMarkdownFileAt(contextMenu.node) },
        { label: '', separator: true },
        { label: '复制路径', action: () => copyText(contextMenu.node.path) },
        { label: '在 Finder 中显示', action: () => revealPath(contextMenu.node.path) }
      ];
    }

    if (contextMenu.kind === 'tab') {
      const target = tabs.find((tab) => tab.id === contextMenu.tabId);
      if (!target) return [];
      return [
        { label: target.name, hint: target.isDirty ? '未保存' : '已保存', disabled: true },
        { label: '切换到此标签', action: () => activateTab(target.id) },
        { label: '关闭标签', action: () => closeTab(target.id) },
        {
          label: '关闭其他标签',
          disabled: tabs.length <= 1,
          action: () => closeOtherTabs(target.id)
        },
        { label: '复制文件路径', disabled: !target.path, action: () => target.path && copyText(target.path) }
      ];
    }

    if (contextMenu.kind === 'editor-block') {
      const canEdit = Boolean(editorRef.current);
      const surface = editorRef.current ?? rendererRef.current;
      const canConvert = canEdit && isConvertibleTextBlock(contextMenu.blockType);
      const isHeading = contextMenu.blockType === 'heading';
      const isListItem = contextMenu.blockType === 'list-item';
      const isBlockquote = contextMenu.blockType === 'blockquote';
      const isTaskList = contextMenu.blockType === 'list-item' && isTaskListRaw(contextMenu.raw);
      const isCheckedTask = isCheckedTaskRaw(contextMenu.raw);
      const canOutdentListItem = isListItem && /^\s+/.test(contextMenu.raw);
      const canDecreaseBlockquote = isBlockquote && /^>/.test(contextMenu.raw);
      const headingLevel = isHeading ? (contextMenu.raw.match(/^#{1,6}(?=\s)/)?.[0].length ?? 0) : 0;
      const codeLanguage = contextMenu.blockType === 'code-block'
        ? getCodeBlockLanguageFromRaw(contextMenu.raw)
        : '';
      const codeFence = contextMenu.blockType === 'code-block'
        ? getCodeBlockFenceFromRaw(contextMenu.raw)
        : '```';
      const canMoveBlockUp = Boolean(surface?.doc.getPreviousBlockId(contextMenu.blockId));
      const canMoveBlockDown = Boolean(surface?.doc.getNextBlockId(contextMenu.blockId));
      const runBlockCommand = (command: (editor: Editor) => boolean) => {
        const editor = editorRef.current;
        if (!editor) return;
        command(editor);
      };
      const setCodeLanguage = (language: string) => runBlockCommand((editor) => editor.setCodeBlockLanguage(contextMenu.blockId, language));
      const setCodeFence = (fence: '```' | '~~~') => runBlockCommand((editor) => editor.setCodeBlockFence(contextMenu.blockId, fence));
      const createInsertItems = (placement: 'before' | 'after'): ContextMenuItem[] => {
        const runInsert = (template: Parameters<Editor['insertTemplateBlockAfter']>[1]) => {
          runBlockCommand((editor) => placement === 'before'
            ? editor.insertTemplateBlockBefore(contextMenu.blockId, template)
            : editor.insertTemplateBlockAfter(contextMenu.blockId, template)
          );
        };

        return [
          { label: '段落', icon: '¶', disabled: !canEdit, action: () => runInsert('paragraph') },
          { label: '任务', icon: '☑', disabled: !canEdit, action: () => runInsert('task-list') },
          { label: '代码', icon: '</>', disabled: !canEdit, action: () => runInsert('code-block') },
          { label: '公式', icon: 'Σ', disabled: !canEdit, action: () => runInsert('math-block') },
          { label: '表格', icon: '⊞', disabled: !canEdit, action: () => runInsert('table') }
        ];
      };
      const createConvertItems = (): ContextMenuItem[] => [
        {
          label: '段落',
          icon: '¶',
          disabled: !canConvert,
          action: () => runBlockCommand((editor) => editor.convertTextBlock(contextMenu.blockId, 'paragraph'))
        },
        {
          label: '标题 1',
          icon: 'H1',
          disabled: !canConvert,
          action: () => runBlockCommand((editor) => editor.convertTextBlock(contextMenu.blockId, 'heading-1'))
        },
        {
          label: '标题 2',
          icon: 'H2',
          disabled: !canConvert,
          action: () => runBlockCommand((editor) => editor.convertTextBlock(contextMenu.blockId, 'heading-2'))
        },
        {
          label: '标题 3',
          icon: 'H3',
          disabled: !canConvert,
          action: () => runBlockCommand((editor) => editor.convertTextBlock(contextMenu.blockId, 'heading-3'))
        },
        {
          label: '无序列表',
          icon: '•',
          disabled: !canConvert,
          action: () => runBlockCommand((editor) => editor.convertTextBlock(contextMenu.blockId, 'unordered-list'))
        },
        {
          label: '有序列表',
          icon: '1.',
          disabled: !canConvert,
          action: () => runBlockCommand((editor) => editor.convertTextBlock(contextMenu.blockId, 'ordered-list'))
        },
        {
          label: '引用',
          icon: '❯',
          disabled: !canConvert,
          action: () => runBlockCommand((editor) => editor.convertTextBlock(contextMenu.blockId, 'blockquote'))
        }
      ];
      const copyCodeBlockContent = () => {
        const surface = editorRef.current ?? rendererRef.current;
        const code = surface?.doc.getCodeBlockContent(contextMenu.blockId);
        if (code === null || code === undefined) return;
        void copyText(code);
      };
      const copyMathBlockContent = () => {
        const surface = editorRef.current ?? rendererRef.current;
        const tex = surface?.doc.getMathBlockContent(contextMenu.blockId);
        if (tex === null || tex === undefined) return;
        void copyText(tex);
      };
      const copyTableCsv = () => {
        const surface = editorRef.current ?? rendererRef.current;
        const csv = surface?.doc.getTableCsv(contextMenu.blockId);
        if (csv === null || csv === undefined) return;
        void copyText(csv);
      };
      return [
        { label: blockTypeLabel(contextMenu.blockType), hint: '编辑区', disabled: true },
        {
          label: '上方插入',
          disabled: !canEdit,
          children: createInsertItems('before')
        },
        {
          label: '下方插入',
          disabled: !canEdit,
          children: createInsertItems('after')
        },
        { label: '', separator: true },
        ...(isTaskList ? [
          {
            label: isCheckedTask ? '标记任务为未完成' : '标记任务为已完成',
            disabled: !canEdit,
            action: () => runBlockCommand((editor) => editor.toggleTaskListItem(contextMenu.blockId))
          }
        ] : []),
        ...(isListItem ? [
          {
            label: '增加列表缩进',
            icon: '⇥',
            disabled: !canEdit,
            action: () => runBlockCommand((editor) => editor.indentListItem(contextMenu.blockId))
          },
          {
            label: '减少列表缩进',
            icon: '⇤',
            disabled: !canEdit || !canOutdentListItem,
            action: () => runBlockCommand((editor) => editor.outdentListItem(contextMenu.blockId))
          }
        ] : []),
        ...(isBlockquote ? [
          {
            label: '增加引用层级',
            icon: '>',
            disabled: !canEdit,
            action: () => runBlockCommand((editor) => editor.increaseBlockquoteLevel(contextMenu.blockId))
          },
          {
            label: '减少引用层级',
            icon: '<',
            disabled: !canEdit || !canDecreaseBlockquote,
            action: () => runBlockCommand((editor) => editor.decreaseBlockquoteLevel(contextMenu.blockId))
          }
        ] : []),
        ...(isHeading ? [
          {
            label: '提升标题层级',
            icon: 'H↑',
            disabled: !canEdit || headingLevel <= 1,
            action: () => runBlockCommand((editor) => editor.promoteHeadingLevel(contextMenu.blockId))
          },
          {
            label: '降低标题层级',
            icon: 'H↓',
            disabled: !canEdit || headingLevel >= 6,
            action: () => runBlockCommand((editor) => editor.demoteHeadingLevel(contextMenu.blockId))
          }
        ] : []),
        ...(contextMenu.blockType === 'code-block' ? [
          {
            label: '复制代码内容',
            disabled: false,
            action: copyCodeBlockContent
          },
          {
            label: '使用反引号围栏',
            hint: codeFence === '```' ? '当前' : undefined,
            disabled: !canEdit || codeFence === '```',
            action: () => setCodeFence('```')
          },
          {
            label: '使用波浪线围栏',
            hint: codeFence === '~~~' ? '当前' : undefined,
            disabled: !canEdit || codeFence === '~~~',
            action: () => setCodeFence('~~~')
          },
          {
            label: '设为 TypeScript 代码',
            hint: codeLanguage === 'ts' ? '当前' : undefined,
            disabled: !canEdit || codeLanguage === 'ts',
            action: () => setCodeLanguage('ts')
          },
          {
            label: '设为 JavaScript 代码',
            hint: codeLanguage === 'js' ? '当前' : undefined,
            disabled: !canEdit || codeLanguage === 'js',
            action: () => setCodeLanguage('js')
          },
          {
            label: '设为 Python 代码',
            hint: codeLanguage === 'python' ? '当前' : undefined,
            disabled: !canEdit || codeLanguage === 'python',
            action: () => setCodeLanguage('python')
          },
          {
            label: '设为 Bash 代码',
            hint: codeLanguage === 'bash' ? '当前' : undefined,
            disabled: !canEdit || codeLanguage === 'bash',
            action: () => setCodeLanguage('bash')
          },
          {
            label: '清除代码语言',
            disabled: !canEdit || codeLanguage === '',
            action: () => setCodeLanguage('')
          }
        ] : []),
        ...(contextMenu.blockType === 'math-block' ? [
          {
            label: '复制公式内容',
            disabled: false,
            action: copyMathBlockContent
          }
        ] : []),
        ...(contextMenu.blockType === 'table' ? [
          {
            label: '复制表格 CSV',
            disabled: false,
            action: copyTableCsv
          },
          {
            label: '在表格末尾追加行',
            disabled: !canEdit,
            action: () => runBlockCommand((editor) => editor.insertTableRowAfter(contextMenu.blockId))
          },
          {
            label: '在表格末尾追加列',
            disabled: !canEdit,
            action: () => runBlockCommand((editor) => editor.insertTableColumnAfter(contextMenu.blockId))
          },
          {
            label: '删除表格末尾行',
            disabled: !canEdit,
            action: () => runBlockCommand((editor) => editor.deleteTableLastRow(contextMenu.blockId))
          },
          {
            label: '删除表格末尾列',
            disabled: !canEdit,
            action: () => runBlockCommand((editor) => editor.deleteTableLastColumn(contextMenu.blockId))
          }
        ] : []),
        {
          label: '转换为',
          disabled: !canConvert,
          children: createConvertItems()
        },
        { label: '', separator: true },
        {
          label: '复制当前块到下方',
          disabled: !canEdit,
          action: () => runBlockCommand((editor) => editor.duplicateBlockAfter(contextMenu.blockId))
        },
        {
          label: '上移当前块',
          disabled: !canEdit || !canMoveBlockUp,
          action: () => runBlockCommand((editor) => editor.moveBlockUp(contextMenu.blockId))
        },
        {
          label: '下移当前块',
          disabled: !canEdit || !canMoveBlockDown,
          action: () => runBlockCommand((editor) => editor.moveBlockDown(contextMenu.blockId))
        },
        { label: '复制当前块 Markdown', action: () => copyText(contextMenu.raw) },
        { label: '复制全文 Markdown', action: () => activeTab && copyText(activeTab.content) },
        {
          label: '展开编辑当前块',
          disabled: !canEdit,
          action: () => {
            const editor = editorRef.current;
            const block = editor?.doc.getBlock(contextMenu.blockId);
            if (!editor || !block) return;
            editor.dom.forceResetExpanded();
            editor.dom.renderBlockExpanded(block);
            editor.dom.setCursorByRawOffset(block.id, 0);
          }
        },
        {
          label: mode === 'edit' ? '切换到阅读' : '切换到编辑',
          action: () => setMode(mode === 'edit' ? 'read' : 'edit')
        }
      ];
    }

    return [
      { label: '编辑区', hint: mode === 'edit' ? '编辑' : '阅读', disabled: true },
      { label: '复制全文 Markdown', disabled: !activeTab, action: () => activeTab && copyText(activeTab.content) },
      { label: mode === 'edit' ? '切换到阅读' : '切换到编辑', disabled: !activeTab, action: () => setMode(mode === 'edit' ? 'read' : 'edit') }
    ];
  }, [activeTab, closeContextMenu, contextMenu, copyText, expandedPaths, mode, tabs]);

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

  const renderContextMenu = () => {
    if (!contextMenu || contextMenuItems.length === 0) return null;

    const renderMenuItem = (item: ContextMenuItem, index: number, depth = 0): React.ReactNode => {
      if (item.separator) {
        return <div key={`separator-${depth}-${index}`} className="context-menu-separator" role="separator" />;
      }

      const hasChildren = Boolean(item.children?.length);
      const button = (
        <button
          key={`${item.label}-${depth}-${index}`}
          type="button"
          role="menuitem"
          aria-haspopup={hasChildren ? 'menu' : undefined}
          className={`${item.disabled ? 'disabled' : ''} ${item.danger ? 'danger' : ''} ${hasChildren ? 'has-submenu' : ''}`}
          disabled={item.disabled}
          onClick={async (event) => {
            if (hasChildren) {
              event.preventDefault();
              return;
            }
            await item.action?.();
            closeContextMenu();
          }}
        >
          <span className="context-menu-icon" aria-hidden="true">{item.icon ?? ''}</span>
          <span>{item.label}</span>
          {hasChildren ? <small>›</small> : item.hint && <small>{item.hint}</small>}
        </button>
      );

      if (!hasChildren) return button;

      return (
        <div key={`${item.label}-${depth}-${index}`} className="context-menu-submenu">
          {button}
          <div className="context-menu context-menu-nested" role="menu">
            {item.children!.map((child, childIndex) => renderMenuItem(child, childIndex, depth + 1))}
          </div>
        </div>
      );
    };

    return (
      <div
        className="context-menu"
        role="menu"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {contextMenuItems.map((item, index) => renderMenuItem(item, index))}
      </div>
    );
  };

  const renderTreeNode = (node: FileNode, depth = 0) => {
    const expanded = expandedPaths.has(node.path);
    const active = activeTab?.path === node.path;

    if (isDirectory(node)) {
      return (
        <div className="tree-group" key={node.path}>
          <button
            type="button"
            className="tree-row directory-row"
            style={{ paddingLeft: 12 + depth * 14 }}
            onClick={() => toggleDirectory(node.path)}
            onContextMenu={(event) => openContextMenu(event, { kind: 'tree-directory', node })}
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
        onContextMenu={(event) => openContextMenu(event, { kind: 'tree-file', node })}
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
      <header className="tabs-top" role="tablist" aria-label="打开的文档标签">
        <div className="tabs-strip">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeTabId}
              className={`tab-chip ${tab.id === activeTabId ? 'active' : ''}`}
              onContextMenu={(event) => openContextMenu(event, { kind: 'tab', tabId: tab.id })}
            >
              <button
                type="button"
                className="tab-chip-main"
                onClick={() => activateTab(tab.id)}
              >
                {tab.isDirty ? `${tab.name} *` : tab.name}
              </button>
              <button
                type="button"
                className="tab-chip-close"
                aria-label={`关闭 ${tab.name}`}
                onClick={() => closeTab(tab.id)}
              >
                ×
              </button>
              <button
                type="button"
                className="tab-chip-more"
                aria-label={`关闭其他标签（保留 ${tab.name}）`}
                title="关闭其他标签"
                onClick={() => closeOtherTabs(tab.id)}
              >
                ⋯
              </button>
            </div>
          ))}
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
          <div className="document-heading" title={activeTab?.name ?? '未打开文档'}>
            <span>{activeTab ? `${activeTab.name.replace(/\.md$/i, '')}${activeTab.isDirty ? ' *' : ''}` : '未打开文档'}</span>
            <small>{activeTab?.savedAtLabel ?? '等待打开文档'}</small>
          </div>
        </header>
        {hasOpenDocument ? (
          <div className="paper-stage">
            <div
              className="paper"
              ref={containerRef}
              onContextMenu={openEditorContextMenu}
            />
          </div>
        ) : <div className="workspace-empty">打开文件后，可在这里通过标签页切换多个文档。</div>}
        {hasOpenDocument && (
          <div className="stats-orb" aria-label="文档统计">
            <div>
              <span>{stats.lines}</span>
              <small>行</small>
            </div>
            <div>
              <span>{stats.blocks}</span>
              <small>段</small>
            </div>
            <div>
              <span>{stats.words}</span>
              <small>字</small>
            </div>
          </div>
        )}
        {hasFormatSelection && (
          <div
            className={`format-orb ${formatOrbState}`}
            aria-label="快捷样式编辑提示"
          >
            {formatOrbState === 'compact' ? (
              <div className="format-hint-compact">
                <span>快捷样式编辑</span>
                <kbd>{platform === 'darwin' ? '⌘' : 'Ctrl'}</kbd>
              </div>
            ) : (
              <div className="format-shortcuts">
                {formatShortcutItems.map((item, index) => {
                  const status = formatShortcutState[item.action];
                  const previousStatus = formatShortcutItems[index - 1]
                    ? formatShortcutState[formatShortcutItems[index - 1].action]
                    : 'inactive';
                  const nextStatus = formatShortcutItems[index + 1]
                    ? formatShortcutState[formatShortcutItems[index + 1].action]
                    : 'inactive';
                  const classNames = [
                    status === 'active' ? 'active' : '',
                    status === 'mixed' ? 'mixed' : '',
                    status === 'active' && previousStatus === 'active' ? 'connected-left' : '',
                    status === 'active' && nextStatus === 'active' ? 'connected-right' : ''
                  ].filter(Boolean).join(' ');

                  return (
                    <div
                      key={item.action}
                      className={classNames}
                      aria-disabled={status === 'mixed'}
                    >
                      {item.icon}
                      <small>{item.label}</small>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
      {renderContextMenu()}
    </main>
  );
}
