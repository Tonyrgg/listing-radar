const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('territory', Object.freeze({
  openBrowser: () => ipcRenderer.invoke('territory:open-browser'),
  onAppearance: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('territory:appearance', listener); return () => ipcRenderer.removeListener('territory:appearance', listener); },
  snapshot: () => ipcRenderer.invoke('territory:snapshot'),
  testSettings: () => ipcRenderer.invoke('territory:test-settings'),
  configureTests: value => ipcRenderer.invoke('territory:configure-tests', value),
  detail: id => ipcRenderer.invoke('territory:detail', id),
  bindNetwork: value => ipcRenderer.invoke('territory:bind-network', value),
  historyReview: () => ipcRenderer.invoke('territory:history-review'),
  associate: value => ipcRenderer.invoke('territory:associate', value),
  syncStatus: () => ipcRenderer.invoke('territory:sync-status'),
  sync: direction => ipcRenderer.invoke('territory:sync', direction),
  annotate: value => ipcRenderer.invoke('territory:annotate', value),
  correct: value => ipcRenderer.invoke('territory:correct', value),
  start: value => ipcRenderer.invoke('territory:start', value),
  pause: () => ipcRenderer.invoke('territory:pause'),
  onChange: callback => { const listener = () => callback(); ipcRenderer.on('territory:changed', listener); return () => ipcRenderer.removeListener('territory:changed', listener); }
}));
