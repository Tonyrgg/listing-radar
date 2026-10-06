const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
app.setPath('userData', process.env.WORKER_MEMORY_DESKTOP_DIR);
global.fetch = async () => { throw new Error('External services excluded from memory integration test'); };
app.whenReady().then(async () => {
  const { WorkerV2Host } = await import(pathToFileURL(path.join(process.env.WORKER_MEMORY_ROOT, 'dist-desktop/desktop/worker-v2.js')).href);
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  const host = new WorkerV2Host(window, { profileDirectory: process.env.WORKER_MEMORY_PROFILE, assetDirectory: path.join(process.env.WORKER_MEMORY_ROOT, 'dist-desktop/territory'), beforeStart: () => { throw new Error('Portal runs excluded from memory test'); }, afterIdle: () => {}, changed: () => {} });
  global.memoryTest = { host, window };
  await window.loadURL('data:text/html,<title>Acquisition memory test</title>');
});
