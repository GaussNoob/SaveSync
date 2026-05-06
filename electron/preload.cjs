const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('saveSync', {
  selectFolder: () => ipcRenderer.invoke('savesync:select-folder')
});
