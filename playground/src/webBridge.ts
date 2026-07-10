/// <reference path="../desktop/src/vite-env.d.ts" />

type StoredWorkspace = {
  rootName: string;
  files: Record<string, string>;
  directories: string[];
};

const workspaceKey = 'mark-it-web:workspace';
const sessionKey = 'mark-it-web:session';
const rootPath = '/Mark It Web';

const starterWorkspace: StoredWorkspace = {
  rootName: 'Mark It Web',
  directories: [`${rootPath}/灵感`],
  files: {
    [`${rootPath}/欢迎使用.md`]: `# 欢迎使用 Mark It Web

Web 端与 Electron 端复用同一套界面与 **Mark-it core**。

- [x] 文件树与多标签页
- [x] 编辑 / 阅读模式
- [x] 自动保存与会话恢复
- [ ] 写下你的下一条想法

选中一段文字后，可以体验快捷样式工具。`,
    [`${rootPath}/灵感/随手记.md`]: `# 随手记

这是浏览器本地工作区中的第二篇文档。

> 内容会保存在当前浏览器的 localStorage 中。`
  }
};

function loadWorkspace(): StoredWorkspace {
  try {
    const value = localStorage.getItem(workspaceKey);
    return value ? JSON.parse(value) as StoredWorkspace : starterWorkspace;
  } catch {
    return starterWorkspace;
  }
}

function saveWorkspace(workspace: StoredWorkspace) {
  localStorage.setItem(workspaceKey, JSON.stringify(workspace));
}

function basename(path: string) {
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function normalizeMarkdownName(value: string) {
  const name = value.trim() || '未命名';
  return /\.md$/i.test(name) ? name : `${name}.md`;
}

function uniquePath(workspace: StoredWorkspace, parentPath: string, rawName: string, kind: 'file' | 'directory') {
  const baseName = kind === 'file' ? normalizeMarkdownName(rawName) : (rawName.trim() || '新建文件夹');
  const extension = kind === 'file' ? '.md' : '';
  const stem = extension ? baseName.slice(0, -extension.length) : baseName;
  let candidate = `${parentPath}/${baseName}`;
  let index = 2;
  while (candidate in workspace.files || workspace.directories.includes(candidate)) {
    candidate = `${parentPath}/${stem} ${index}${extension}`;
    index += 1;
  }
  return candidate;
}

function toTree(workspace: StoredWorkspace): WorkspaceOpenResult {
  const directoryPaths = [rootPath, ...workspace.directories]
    .sort((left, right) => left.localeCompare(right));
  const nodes = new Map<string, WorkspaceTreeNode>();

  directoryPaths.forEach((path) => nodes.set(path, {
    type: 'directory',
    name: path === rootPath ? workspace.rootName : basename(path),
    path,
    children: []
  }));

  directoryPaths.slice(1).forEach((path) => {
    const parentPath = path.slice(0, path.lastIndexOf('/')) || rootPath;
    nodes.get(parentPath)?.children?.push(nodes.get(path)!);
  });

  Object.keys(workspace.files).sort().forEach((path) => {
    const parentPath = path.slice(0, path.lastIndexOf('/')) || rootPath;
    nodes.get(parentPath)?.children?.push({ type: 'file', name: basename(path), path });
  });

  return { rootPath, rootName: workspace.rootName, tree: nodes.get(rootPath)! };
}

function promptForName(message: string, fallback: string) {
  return window.prompt(message, fallback)?.trim() ?? '';
}

export function installWebBridge() {
  if (window.markItWorkspace) return;

  if (!localStorage.getItem(workspaceKey)) saveWorkspace(starterWorkspace);

  window.markItWindow = {
    getState: async () => ({ platform: 'web', isFullScreen: false }),
    onStateChange: () => () => undefined
  };

  window.markItWorkspace = {
    openFolder: async () => toTree(loadWorkspace()),
    newFolder: async () => {
      const rootName = promptForName('工作区名称', 'Mark It Web');
      if (!rootName) return null;
      const workspace: StoredWorkspace = { rootName, files: {}, directories: [] };
      saveWorkspace(workspace);
      localStorage.removeItem(sessionKey);
      return toTree(workspace);
    },
    restoreLastFolder: async () => toTree(loadWorkspace()),
    saveSession: async (payload) => {
      localStorage.setItem(sessionKey, JSON.stringify(payload));
      return { ok: true };
    },
    restoreSession: async () => {
      try {
        const value = localStorage.getItem(sessionKey);
        if (value) return JSON.parse(value) as PersistedSessionState;

        const workspace = loadWorkspace();
        const welcomePath = `${rootPath}/欢迎使用.md`;
        const content = workspace.files[welcomePath];
        if (content === undefined) return { tabs: [], activeTabId: null };

        const tabId = `path:${welcomePath}`;
        return {
          activeTabId: tabId,
          tabs: [{
            id: tabId,
            path: welcomePath,
            name: basename(welcomePath),
            content,
            isDirty: false
          }]
        };
      } catch {
        return { tabs: [], activeTabId: null };
      }
    },
    setDirtyState: () => undefined,
    openFile: async () => {
      const workspace = loadWorkspace();
      const path = Object.keys(workspace.files).sort()[0];
      return path ? { path, name: basename(path), content: workspace.files[path] } : null;
    },
    readFile: async (path) => {
      const workspace = loadWorkspace();
      return { path, name: basename(path), content: workspace.files[path] ?? '' };
    },
    writeFile: async (path, content) => {
      const workspace = loadWorkspace();
      workspace.files[path] = content;
      saveWorkspace(workspace);
      return { ok: true };
    },
    createMarkdownFile: async (targetPath) => {
      const name = promptForName('新建 Markdown 文件', '未命名.md');
      if (!name) return { ok: false };
      const workspace = loadWorkspace();
      const parentPath = targetPath in workspace.files
        ? targetPath.slice(0, targetPath.lastIndexOf('/'))
        : targetPath;
      const path = uniquePath(workspace, parentPath, name, 'file');
      workspace.files[path] = '';
      saveWorkspace(workspace);
      return {
        ok: true,
        file: { path, name: basename(path), content: '' },
        workspace: toTree(workspace)
      };
    },
    createDirectory: async (targetPath) => {
      const name = promptForName('新建文件夹', '新建文件夹');
      if (!name) return { ok: false };
      const workspace = loadWorkspace();
      const parentPath = targetPath in workspace.files
        ? targetPath.slice(0, targetPath.lastIndexOf('/'))
        : targetPath;
      const path = uniquePath(workspace, parentPath, name, 'directory');
      workspace.directories.push(path);
      saveWorkspace(workspace);
      return { ok: true, path, workspace: toTree(workspace) };
    },
    revealPath: async () => ({ ok: false })
  };
}
