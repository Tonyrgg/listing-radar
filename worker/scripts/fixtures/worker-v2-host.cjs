// Runs the real desktop entry against temporary files, with portal access disabled.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
app.setPath('userData', process.env.WORKER_V2_DESKTOP_TEST_DIR);
BrowserWindow.prototype.show = function () {};
const originalRead = fs.readFileSync, originalExists = fs.existsSync;
const sensitive = filename => /^\.env/.test(path.basename(String(filename))) || path.basename(String(filename)) === 'worker-config.json';
fs.existsSync = function (filename) { return !sensitive(filename) && originalExists.apply(this, arguments); };
fs.readFileSync = function (filename) { if (sensitive(filename)) throw Object.assign(new Error('Configuration excluded from test'), { code: 'ENOENT' }); return originalRead.apply(this, arguments); };
syncBuiltinESMExports();
// Only the synthetic queue fixture auto-answers the native confirmation.
// Its portal connection is disabled; cloned user data never uses this flag.
if (process.env.WORKER_V2_CONFIRM_FIXTURE_IMPORT === '1') {
  dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
}
global.__testWorkBrowserChecks = [];
global.fetch = async input => {
  // Opening an already running work browser must reuse it, without spawning Chrome.
  if (String(input) === 'http://127.0.0.1:65531/json/version') {
    global.__testWorkBrowserChecks.push(String(input));
    return { ok: true };
  }
  throw new Error('External services excluded from integration test');
};
void (async () => {
  const { TerritoryApplication } = await import(pathToFileURL(path.join(process.env.WORKER_V2_TEST_ROOT, 'dist-desktop/territory/application.js')).href);
  const original = TerritoryApplication.prototype.snapshot;
  global.__v2SnapshotReads = 0;
  TerritoryApplication.prototype.snapshot = function (...args) { global.__v2SnapshotReads++; return original.apply(this, args); };
  await import(pathToFileURL(path.join(process.env.WORKER_V2_TEST_ROOT, 'dist-desktop/desktop/main.js')).href);
})();
