const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  async getServerStatus() {
    return ipcRenderer.invoke('desktop:get-server-status');
  },
  onServerStatus(listener) {
    const handler = (_event, payload) => {
      listener(payload);
    };

    ipcRenderer.on('desktop:server-status', handler);
    return () => {
      ipcRenderer.removeListener('desktop:server-status', handler);
    };
  },
});
