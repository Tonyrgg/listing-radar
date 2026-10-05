import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, copyFile, writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(os.tmpdir(), 'territory-online-ui-'));
const first = path.join(directory, 'first'); await mkdir(first);
const source = path.join(process.env.APPDATA, 'ListingRadarTerritoryLab-live');
for (const name of ['territory-ledger.json', 'history-snapshot.json']) await copyFile(path.join(source, name), path.join(first, name));
const cloudFile = path.join(directory, 'fake-cloud.json');
const output = path.resolve(root, '../.runtime/territory-online-ui-check'); await mkdir(output, { recursive: true });
let application; const errors = [];
async function launch(profile) {
  const env = { ...process.env, WORKER_V2_TEST_ROOT: root, TERRITORY_ONLINE_TEST_DIR: profile, TERRITORY_ONLINE_CLOUD_FILE: cloudFile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ args: [path.join(root, 'scripts/fixtures/online-memory-host.cjs')], env });
  const page = await application.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
  await page.locator('.street-row').first().waitFor(); return page;
}
async function memoryUntil(page, predicate) {
  const deadline = Date.now() + 25000;
  let status;
  while (Date.now() < deadline) {
    status = await page.evaluate(() => window.territory.syncStatus());
    if (predicate(status)) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Stato memoria non raggiunto: ${JSON.stringify(status)}`);
}
async function synced(page, revision) { await memoryUntil(page, m => m.revision === revision && !m.pending && !m.syncing && !m.error); }
try {
  let page = await launch(first); await synced(page, 1);
  const snapshot = await page.evaluate(() => window.territory.snapshot());
  assert.equal(snapshot.streets.reduce((n, s) => n + s.count, 0), 928);
  const streetId = snapshot.streets[0].id;
  await page.evaluate(id => window.territory.annotate({ streetId: id, note: 'Nota sincronizzata automaticamente', attention: true }), streetId);
  await synced(page, 2);
  const identity = await readFile(path.join(first, 'online-config.json'), 'utf8'); assert.ok(!identity.includes('dummy-key'));
  assert.equal(JSON.parse(await readFile(cloudFile, 'utf8')).state.memories[streetId].note, 'Nota sincronizzata automaticamente');
  await writeFile(`${cloudFile}.offline`, 'offline');
  await page.evaluate(id => window.territory.annotate({ streetId: id, note: 'Correzione conservata senza rete', attention: true }), streetId);
  await memoryUntil(page, m => Boolean(m.error) && !m.syncing);
  assert.equal((await page.evaluate(id => window.territory.detail(id), streetId)).memory.note, 'Correzione conservata senza rete');
  await page.locator('#cloud-memory').click();
  await page.locator('#memory-push').click();
  await page.waitForFunction(() => document.querySelector('#memory-result').textContent && !document.querySelector('#memory-push').disabled);
  const syncError=await page.locator('#memory-result').textContent();
  assert.ok(!syncError.includes('Error invoking remote method'),'L’errore mostra il messaggio utile senza dettagli IPC');
  assert.equal((await page.evaluate(id => window.territory.detail(id), streetId)).memory.note, 'Correzione conservata senza rete');
  await page.screenshot({ path: path.join(output, '01-offline-memory.png') });
  await page.locator('#memory-close').click();
  await application.close(); application = null;
  await unlink(`${cloudFile}.offline`);
  page = await launch(first); await synced(page, 3);
  await application.close(); application = null;
  const second = path.join(directory, 'second'); await mkdir(second);
  page = await launch(second); await synced(page, 3);
  const restored = await page.evaluate(() => window.territory.snapshot());
  assert.equal(restored.streets.reduce((n, s) => n + s.count, 0), 928);
  assert.equal(restored.historyIssues, 180);
  assert.equal((await page.evaluate(id => window.territory.detail(id), streetId)).memory.note, 'Correzione conservata senza rete');
  assert.equal((await page.evaluate(() => window.territory.testSettings())).selected.length, 0);
  await page.locator('#cloud-memory').click(); await page.screenshot({ path: path.join(output, '02-online-memory.png') });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, automaticUpload: true, offlineChangesPreserved: true, restartSync: true, emptyDeviceRecovered: true, restoredUnits: 928, credentialsExcluded: true, crmWritesEnabled: false, errors }, null, 2));
  console.log('Memoria online verificata: upload automatico, offline, riavvio e recupero da profilo vuoto.');
} finally { if (application) await application.close(); }
