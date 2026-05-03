const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('markItWorkspace', {
  openFolder: () => ipcRenderer.invoke('workspace:open-folder'),
  newFolder: () => ipcRenderer.invoke('workspace:new-folder'),
  openFile: () => ipcRenderer.invoke('workspace:open-file'),
  readFile: (filePath) => ipcRenderer.invoke('workspace:read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('workspace:write-file', filePath, content)
});

contextBridge.exposeInMainWorld('markItWindow', {
  getState: () => ipcRenderer.invoke('window:get-state'),
  onStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('window:state', listener);
    return () => ipcRenderer.removeListener('window:state', listener);
  }
});
