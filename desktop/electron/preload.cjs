/**
 * Electron desktop-shell module.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  async getUpdaterStatus() {
    return ipcRenderer.invoke('desktop:get-updater-status');
  },
  async checkForUpdates() {
    return ipcRenderer.invoke('desktop:check-for-updates');
  },
  onUpdaterStatus(listener) {
    const handler = (_event, payload) => {
      listener(payload);
    };

    ipcRenderer.on('desktop:updater-status', handler);
    return () => {
      ipcRenderer.removeListener('desktop:updater-status', handler);
    };
  },
  async quitAndInstallUpdate() {
    return ipcRenderer.invoke('desktop:quit-and-install-update');
  },
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
