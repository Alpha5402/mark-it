const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const isDev = !app.isPackaged;
const stateFileName = 'workspace-state.json';
const sessionFileName = 'tab-session.json';
const titleBarHeight = 46;
const trafficLightSize = 14;

function getStateFilePath() {
  return path.join(app.getPath('userData'), stateFileName);
}

function getSessionFilePath() {
  return path.join(app.getPath('userData'), sessionFileName);
}

function readWorkspaceState() {
  try {
    const stateFilePath = getStateFilePath();
    if (!fs.existsSync(stateFilePath)) return null;
    const payload = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    const rootPath = typeof payload?.rootPath === 'string' ? payload.rootPath : '';
    return rootPath ? { rootPath } : null;
  } catch {
    return null;
  }
}

function writeWorkspaceState(rootPath) {
  try {
    fs.writeFileSync(getStateFilePath(), JSON.stringify({ rootPath }), 'utf8');
  } catch {
    // ignore persistence errors to avoid interrupting user flows
  }
}

function readSessionState() {
  try {
    const sessionFilePath = getSessionFilePath();
    if (!fs.existsSync(sessionFilePath)) return null;
    return JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeSessionState(payload) {
  try {
    fs.writeFileSync(getSessionFilePath(), JSON.stringify(payload), 'utf8');
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function toTreeNode(entryPath) {
  const stat = fs.statSync(entryPath);
  const name = path.basename(entryPath);

  if (!stat.isDirectory()) {
    if (!name.toLowerCase().endsWith('.md')) return null;
    return { type: 'file', name, path: entryPath };
  }

  const children = fs.readdirSync(entryPath)
    .map((entry) => toTreeNode(path.join(entryPath, entry)))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

  return { type: 'directory', name, path: entryPath, children };
}

function getRestoredWorkspaceTree() {
  const workspaceState = readWorkspaceState();
  const rootPath = workspaceState?.rootPath;
  if (!rootPath) return null;

  try {
    const stat = fs.statSync(rootPath);
    if (!stat.isDirectory()) return null;
    return {
      rootPath,
      rootName: path.basename(rootPath),
      tree: toTreeNode(rootPath)
    };
  } catch {
    return null;
  }
}

function ensureUniquePath(directoryPath, baseName, extension = '') {
  let candidate = path.join(directoryPath, baseName + extension);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directoryPath, `${baseName} ${index}${extension}`);
    index += 1;
  }
  return candidate;
}

function resolveDirectoryTarget(targetPath) {
  try {
    const stat = fs.statSync(targetPath);
    return stat.isDirectory() ? targetPath : path.dirname(targetPath);
  } catch {
    return null;
  }
}

async function chooseWorkspace(properties) {
  const result = await dialog.showOpenDialog({
    properties,
    title: '选择 Mark It 工作区'
  });

  if (result.canceled || !result.filePaths[0]) return null;
  const folderPath = result.filePaths[0];
  writeWorkspaceState(folderPath);
  return {
    rootPath: folderPath,
    rootName: path.basename(folderPath),
    tree: toTreeNode(folderPath)
  };
}

function restoreLastWorkspace() {
  return getRestoredWorkspaceTree();
}

function restoreTabSession() {
  const payload = readSessionState();
  if (!payload || !Array.isArray(payload.tabs)) return { tabs: [], activeTabId: null };

  const restoredTabs = payload.tabs
    .map((item) => {
      const id = typeof item?.id === 'string' ? item.id : '';
      const name = typeof item?.name === 'string' ? item.name : '';
      const pathValue = typeof item?.path === 'string' && item.path ? item.path : null;
      const dirtyContent = typeof item?.content === 'string' ? item.content : '';
      const isDirty = Boolean(item?.isDirty);
      if (!id || !name) return null;

      if (!pathValue) {
        return {
          id,
          path: null,
          name,
          content: dirtyContent,
          isDirty
        };
      }

      try {
        const stat = fs.statSync(pathValue);
        if (!stat.isFile()) return null;
        const content = isDirty ? dirtyContent : fs.readFileSync(pathValue, 'utf8');
        return {
          id,
          path: pathValue,
          name,
          content,
          isDirty
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const activeTabId = typeof payload.activeTabId === 'string' ? payload.activeTabId : null;
  const hasActiveTab = Boolean(activeTabId && restoredTabs.some((tab) => tab.id === activeTabId));

  return {
    tabs: restoredTabs,
    activeTabId: hasActiveTab ? activeTabId : restoredTabs[0]?.id ?? null
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1060,
    minHeight: 720,
    title: 'Mark It Desktop',
    icon: path.join(__dirname, 'icon.icns'),
    backgroundColor: '#e8edf1',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    titleBarOverlay: process.platform === 'darwin',
    trafficLightPosition: process.platform === 'darwin'
      ? { x: 16, y: Math.round((titleBarHeight - trafficLightSize) / 2) }
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL(process.env.MARK_IT_DEV_URL || 'http://127.0.0.1:1420');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  const sendWindowState = () => {
    win.webContents.send('window:state', {
      platform: process.platform,
      isFullScreen: win.isFullScreen()
    });
  };

  win.webContents.on('did-finish-load', sendWindowState);
  win.on('enter-full-screen', sendWindowState);
  win.on('leave-full-screen', sendWindowState);

  let hasDirtyTabs = false;
  let isClosingConfirmed = false;
  const handleDirtyState = (_event, payload) => {
    hasDirtyTabs = Boolean(payload?.hasDirtyTabs);
  };
  ipcMain.on('workspace:dirty-state', handleDirtyState);
  win.on('closed', () => {
    ipcMain.removeListener('workspace:dirty-state', handleDirtyState);
  });

  win.on('close', (event) => {
    if (isClosingConfirmed || !hasDirtyTabs) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['取消', '仍然退出'],
      defaultId: 0,
      cancelId: 0,
      title: '未保存更改',
      message: '当前有未保存的文档内容，确定退出 Mark It 吗？'
    });

    if (choice === 1) {
      isClosingConfirmed = true;
      win.close();
    }
  });
}

app.whenReady().then(() => {
  ipcMain.handle('workspace:open-folder', () => chooseWorkspace(['openDirectory']));
  ipcMain.handle('workspace:new-folder', () => chooseWorkspace(['openDirectory', 'createDirectory']));
  ipcMain.handle('workspace:restore-last-folder', () => restoreLastWorkspace());
  ipcMain.handle('workspace:save-session', (_event, payload) => writeSessionState(payload));
  ipcMain.handle('workspace:restore-session', () => restoreTabSession());
  ipcMain.handle('workspace:open-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });

    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    return {
      path: filePath,
      name: path.basename(filePath),
      content: fs.readFileSync(filePath, 'utf8')
    };
  });
  ipcMain.handle('workspace:read-file', (_event, filePath) => ({
    path: filePath,
    name: path.basename(filePath),
    content: fs.readFileSync(filePath, 'utf8')
  }));
  ipcMain.handle('workspace:write-file', (_event, filePath, content) => {
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true };
  });
  ipcMain.handle('workspace:create-markdown-file', (_event, targetPath) => {
    const directoryPath = resolveDirectoryTarget(targetPath);
    if (!directoryPath) return { ok: false };

    const filePath = ensureUniquePath(directoryPath, 'Untitled', '.md');
    fs.writeFileSync(filePath, '', 'utf8');

    return {
      ok: true,
      file: {
        path: filePath,
        name: path.basename(filePath),
        content: ''
      },
      workspace: getRestoredWorkspaceTree()
    };
  });
  ipcMain.handle('workspace:create-directory', (_event, targetPath) => {
    const directoryPath = resolveDirectoryTarget(targetPath);
    if (!directoryPath) return { ok: false };

    const folderPath = ensureUniquePath(directoryPath, 'New Folder');
    fs.mkdirSync(folderPath);

    return {
      ok: true,
      path: folderPath,
      workspace: getRestoredWorkspaceTree()
    };
  });
  ipcMain.handle('workspace:reveal-path', (_event, targetPath) => {
    shell.showItemInFolder(targetPath);
    return { ok: true };
  });
  ipcMain.handle('window:get-state', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return {
      platform: process.platform,
      isFullScreen: Boolean(win?.isFullScreen())
    };
  });

  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
