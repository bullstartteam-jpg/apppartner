const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  fetchImage: (url) => ipcRenderer.invoke('fetch-image', url),
  s3Upload: (params) => ipcRenderer.invoke('s3-upload', params),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdaterStatus: (cb) => {
    const listener = (_e, status) => cb(status);
    ipcRenderer.on('updater-status', listener);
    return () => ipcRenderer.removeListener('updater-status', listener);
  },
});
