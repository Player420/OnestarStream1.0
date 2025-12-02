// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('OneStar', {
  ping: () => ipcRenderer.invoke('ping'),
});
