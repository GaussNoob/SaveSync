const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('saveSync', {
  selectFolder: () => ipcRenderer.invoke('savesync:select-folder'),
  getPathForFile: file => webUtils.getPathForFile(file),
  openExternal: url => ipcRenderer.invoke('savesync:open-external', url)
});
