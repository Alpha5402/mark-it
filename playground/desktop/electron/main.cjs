const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const isDev = !app.isPackaged;

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

async function chooseWorkspace(properties) {
  const result = await dialog.showOpenDialog({
    properties,
    title: '选择 Mark It 工作区'
  });

  if (result.canceled || !result.filePaths[0]) return null;
  const folderPath = result.filePaths[0];
  return {
    rootPath: folderPath,
    rootName: path.basename(folderPath),
    tree: toTreeNode(folderPath)
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
}

app.whenReady().then(() => {
  ipcMain.handle('workspace:open-folder', () => chooseWorkspace(['openDirectory']));
  ipcMain.handle('workspace:new-folder', () => chooseWorkspace(['openDirectory', 'createDirectory']));
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
