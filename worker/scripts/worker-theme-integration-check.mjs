import { streetSearchReady } from "./fixtures/street-search.mjs";
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../.runtime/worker-v2-ui-check');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(path.join(os.tmpdir(), 'territory-integrated-'));
const desktop = path.join(directory, 'desktop'); await mkdir(desktop);
const legacyCheckpoint = JSON.stringify({ version: 4, strategy: 'bulk_exact_variants', importJobId: null, municipality: 'BITONTO', requestedStreet: 'Via conservata nel worker quotidiano', mode: 'dry_run', status: 'paused', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null, nextCivicNumber: 1, currentVariantIndex: 0, emptyWindow: 3, consecutiveEmptyByVariant: {}, variants: [], results: [], totalRawRecords: 0, totalAcceptedOccurrences: 0, totalAcceptedProperties: 0, uniquePropertyKeys: [], totalOwnersRead: 0, totalSkippedPropertyRows: 0, lastError: null, inferredLastUsefulCivic: null });
await writeFile(path.join(desktop, 'sister-street-run.json'), legacyCheckpoint);
let application;
const errors = [];
async function launch(profile, simulation, confirmFixtureImport = false) {
  const env = { ...process.env, WORKER_V2_TEST_ROOT: root, WORKER_V2_DESKTOP_TEST_DIR: desktop, TERRITORY_LAB_DATA_DIR: profile, WORKER_V2_SIMULATION: simulation ? '1' : '0', SISTER_KEEPALIVE_ENABLED: 'false', CHROME_CDP_URL: 'http://127.0.0.1:65531' };
  delete env.ELECTRON_RUN_AS_NODE;
  env.WORKER_V2_CONFIRM_FIXTURE_IMPORT = confirmFixtureImport ? '1' : '0';
  application = await electron.launch({ args: [path.join(root, 'scripts/fixtures/worker-v2-host.cjs')], env });
  let diagnostics='';application.process().stderr?.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-5000);});
  const shell = await application.firstWindow({timeout:10000}).catch(error=>{throw new Error(error.message+' '+diagnostics);}); shell.setDefaultTimeout(20000);
  shell.on('pageerror', error => errors.push(error.message));
  await shell.locator('[data-scroll="worker-v2"]').waitFor();
  await shell.waitForFunction(() => document.querySelector('#versionLabel').textContent !== 'v—');
  await shell.locator('[data-scroll="worker-v2"]').click();
  let page;
  for (let i = 0; i < 100; i++) {
    page = application.context().pages().find(p => p.url().endsWith('/territory/renderer/index.html'));
    if (page) break; await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'La sezione usa un renderer dedicato nella stessa finestra');
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await streetSearchReady(page);
  return { shell, page };
}
try {
 const {shell,page}=await launch(path.join(directory,'territory-theme-only'),true);
 async function colors(view){return view.evaluate(async()=>{await document.fonts.ready;const c=getComputedStyle(document.documentElement);return{canvas:c.getPropertyValue('--lr-canvas').trim(),surface:c.getPropertyValue('--lr-surface').trim(),ink:c.getPropertyValue('--lr-ink').trim(),accent:c.getPropertyValue('--lr-accent').trim(),font:getComputedStyle(document.body).fontFamily};});}
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 const darkShell=await colors(shell),darkView=await colors(page);assert.deepEqual(darkShell,darkView);
 await shell.locator('#themeToggle').click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 const lightShell=await colors(shell),lightView=await colors(page);assert.deepEqual(lightShell,lightView);
 await shell.locator('#themeToggle').click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 assert.equal(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,darkShell,darkView,lightShell,lightView,oneWindow:true,errors}));
 await writeFile(path.join(output,'theme-result.json'),JSON.stringify({ok:true,darkShell,darkView,lightShell,lightView,errors},null,2));
}finally{if(application)await application.close();}

