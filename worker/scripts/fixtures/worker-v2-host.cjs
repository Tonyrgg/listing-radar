// Runs the real desktop entry against temporary files, with portal access disabled.
const { app, BrowserWindow } = require('electron');
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
global.fetch = async () => { throw new Error('External services excluded from integration test'); };
void import(pathToFileURL(path.join(process.env.WORKER_V2_TEST_ROOT, 'dist-desktop/desktop/main.js')).href);
