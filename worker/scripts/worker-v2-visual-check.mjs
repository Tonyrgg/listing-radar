import { streetSearchReady, openStreet, openStreetSettings } from "./fixtures/street-search.mjs";
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { hydrateUnitMemory } from '../dist-desktop/territory/unit-memory.js';
import { resolveRecognizedHistory } from '../dist-desktop/territory/history.js';
import { TerritoryStore } from '../dist-desktop/territory/store.js';
import { simulationSource } from '../dist-desktop/territory/providers.js';
import { unitKey } from '../dist-desktop/territory/model.js';

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
  const shell = await application.firstWindow(); shell.setDefaultTimeout(20000);
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
  const profile = path.join(directory, 'territory-simulation');
  let { shell, page } = await launch(profile, true);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal(await page.evaluate(() => typeof window.propertyWorker), 'undefined', 'Il renderer V2 non riceve i comandi del worker quotidiano');
  assert.equal(await shell.evaluate(() => typeof window.territory), 'undefined', 'La shell non riceve i comandi del dossier');
  const snapshot = await page.evaluate(() => window.territory.snapshot());
  assert.equal(snapshot.integrated, true); assert.equal(snapshot.origin, 'simulation');
  assert.equal(snapshot.streets.length, 2043);
  const street = snapshot.streets.find(s => s.geometry && s.name.includes('CASTELLUCCI'));
  await openStreet(page, street);
  await openStreetSettings(page); await page.locator('[data-disclosure="notes"]').evaluate(el => { el.open = true; });
  await page.locator('#street-note').fill('Nota aperta durante cambio sezione');
  await shell.locator('[data-scroll="refinement"]').click();
  assert.equal(await shell.locator('#refinement').isVisible(), true);
  // Instrument only the fixture main process. Hidden renderer updates must not
  // calculate the map, even while ordinary imports feed the V2 memory.
  await page.waitForTimeout(500);
  await application.evaluate(() => { global.__v2SnapshotReads = 0; });
  await application.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.at(-1);
    for (let i = 0; i < 10; i++) view.webContents.send('territory:changed');
  });
  await page.waitForTimeout(500);
  assert.equal(await application.evaluate(() => global.__v2SnapshotReads), 0, 'La vista nascosta non ricalcola la mappa');
  await shell.locator('[data-scroll="worker-v2"]').click();
  await page.waitForTimeout(500);
  assert.ok(await application.evaluate(() => global.__v2SnapshotReads) > 0, 'Il ritorno alla mappa recupera gli aggiornamenti');
  assert.equal(await page.locator('#street-note').inputValue(), 'Nota aperta durante cambio sezione');
  await page.getByRole('button', { name: 'Salva note', exact: true }).click();
  await page.locator('#detail-close').click();
  await shell.locator('#themeToggle').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: path.join(output, '01-integrated-map.png') });
  await shell.screenshot({ path: path.join(output, '00-worker-navigation.png') });
  await page.evaluate(id => window.territory.start({ streetId: id, operation: 'scan' }), street.id);
  const rejected = await shell.evaluate(async () => {
    try { await window.propertyWorker.startStreetRun({ street: 'Via Test', dryRun: true }); return false; }
    catch (error) { return error.message.includes('già in esecuzione'); }
  });
  assert.equal(rejected, true, 'Una run V2 impedisce un secondo motore quotidiano');
  const stop = await shell.evaluate(() => window.propertyWorker.stopAll());
  assert.equal(stop.stopped, true);
  assert.equal((await page.evaluate(() => window.territory.snapshot())).activeRun, null);
  assert.equal(await readFile(path.join(desktop, 'sister-street-run.json'), 'utf8'), legacyCheckpoint, 'Arrestare V2 conserva il checkpoint quotidiano in pausa');
  const bounds = await shell.locator('#workerV2Viewport').boundingBox();
  const nativeBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.at(-1).getBounds());
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.at(-1).getVisible()), true, 'La vista nativa è montata e visibile nella finestra');
  assert.equal(nativeBounds.x, Math.round(bounds.x)); assert.equal(nativeBounds.width, Math.round(bounds.width));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 760));
  await shell.waitForFunction(() => innerWidth <= 1080);
  await shell.waitForTimeout(200);
  const compactBounds = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; return { viewport: window.contentView.children.at(-1).getBounds(), size: window.getContentSize() };
  });
  assert.ok(compactBounds.viewport.x + compactBounds.viewport.width <= compactBounds.size[0] && compactBounds.viewport.y + compactBounds.viewport.height <= compactBounds.size[1], 'La mappa resta nella finestra ridimensionata');
  await application.close(); application = null;
  assert.equal((JSON.parse(await readFile(path.join(profile, 'territory-ledger.json'), 'utf8'))).memories[street.id].note, 'Nota aperta durante cambio sezione');
  ({ shell, page } = await launch(profile, true));
  assert.equal((await page.evaluate(id => window.territory.detail(id), street.id)).memory.note, 'Nota aperta durante cambio sezione');
  await application.close(); application = null;
  // Verify recovered user data only in a temporary copy, never enable CRM writes.
  const historical = path.join(directory, 'territory-history'); await mkdir(historical);
  const original = path.join(process.env.APPDATA, 'ListingRadarTerritoryLab-live');
  await copyFile(path.join(original, 'territory-ledger.json'), path.join(historical, 'territory-ledger.json'));
  const expectedLedger = JSON.parse(await readFile(path.join(historical, 'territory-ledger.json'), 'utf8'));
  const priorUnitKeys = Object.keys(expectedLedger.units);
  resolveRecognizedHistory(expectedLedger); hydrateUnitMemory(expectedLedger);
  const expectedUnitKeys = Object.keys(expectedLedger.units).sort();
  assert.ok(expectedUnitKeys.length > 0, 'La copia reale contiene immobili da recuperare');
  await copyFile(path.join(original, 'history-snapshot.json'), path.join(historical, 'history-snapshot.json'));
  await writeFile(path.join(historical, 'sync-config.json'), JSON.stringify({ url: 'http://127.0.0.1:54321', key: 'offline-test-key', workspaceId: '11111111-1111-4111-8111-111111111111', ownerId: '22222222-2222-4222-8222-222222222222', profileKind: 'live' }), { mode: 0o600 });
  ({ shell, page } = await launch(historical, false));
  const recovered = await page.evaluate(() => window.territory.snapshot());
  assert.equal(recovered.origin, 'live');
  assert.equal(recovered.operational, true);
  assert.equal(await page.locator('#notice').isVisible(), false, 'Nessun banner di collaudo nel desktop');
  assert.equal(await page.locator('#test-settings').isVisible(), false, 'La lista di prova non limita il desktop operativo');
  const operationalUnits = await page.evaluate(() => window.territory.query({ query: {}, limit: 100 }));
  assert.ok(operationalUnits.units.some(unit => unit.canWrite), 'Immobili reali validi sono abilitati senza lista di collaudo');
  const config = JSON.parse(await readFile(path.join(historical, 'live-config.json'), 'utf8'));
  assert.equal(config.allowedCadastralKeys.length, 0); assert.equal(config.allowedTaxCodes.length, 0); assert.equal(config.allowCreate, false);
  assert.equal(config.cdpUrl, 'http://127.0.0.1:65531', 'V2 usa lo stesso collegamento Chrome configurato nel desktop');
  const ledger = JSON.parse(await readFile(path.join(historical, 'territory-ledger.json'), 'utf8'));
  assert.deepEqual(Object.keys(ledger.units).sort(), expectedUnitKeys, 'Il recupero conserva tutte le identità della copia, anche dopo nuove acquisizioni quotidiane');
  assert.ok(priorUnitKeys.every(key => ledger.units[key]), 'Nessuna identità precedente viene persa');
  await page.locator('#open-browser').waitFor({ state: 'visible' });
  await page.locator('#open-browser').click();
  await page.getByText('Chrome di lavoro è già aperto. Verifica l’accesso a SISTER e Tecnocloud.', { exact: true }).waitFor();
  await shell.evaluate(() => window.propertyWorker.openChrome());
  assert.equal(await application.evaluate(() => global.__testWorkBrowserChecks.length), 2, 'V2 e Lavorazioni usano lo stesso avvio Chrome, riutilizzando il browser aperto');
  // Real missing-browser failure, confined to the cloned profile and closed fixture port.
  const unavailableStreet = recovered.streets.find(s => s.geometry && s.catalogKind !== 'network' && !s.needsReview);
  await openStreet(page, unavailableStreet);
  await page.locator('[data-operation="scan"]').click();
  await page.locator('#feedback[data-tone="warning"] [data-toast-browser]').waitFor();
  assert.equal(await page.locator('#detail-dialog > #feedback').count(), 1, 'Il toast resta sopra la modale');
  assert.equal(await page.locator('#feedback .toast-message').getAttribute('role'), 'alert');
  assert.equal(await page.locator('.local-error').count(), 0, 'Chrome non aperto non aggiunge paragrafi nella scheda');
  assert.ok(!(await page.locator('#feedback').textContent()).includes('remote-debugging-port'));
  await page.screenshot({ path: path.join(output, '02-chrome-warning-toast.png') });
  const browserChecksBeforeToast = await application.evaluate(() => global.__testWorkBrowserChecks.length);
  await page.locator('#feedback [data-toast-browser]').click();
  await page.getByText('Chrome di lavoro è già aperto. Verifica l’accesso a SISTER e Tecnocloud.', { exact: true }).waitFor();
  assert.equal(await application.evaluate(() => global.__testWorkBrowserChecks.length), browserChecksBeforeToast + 1, 'Il toast usa l’avvio Chrome condiviso una sola volta');
  await page.locator('#feedback .toast-close').click();
  await page.locator('#detail-refresh').click();
  assert.equal(await page.locator('#feedback').isVisible(), false, 'L’avviso chiuso non ricompare a ogni aggiornamento');
  await page.locator('#detail-close').click();
  await page.locator('#cloud-memory').click();
  await page.locator('#memory-push').click();
  await page.waitForFunction(() => document.querySelector('#memory-result').textContent.includes('non raggiungibile'));
  await page.locator('#memory-close').click();
  assert.equal((await page.evaluate(() => window.territory.snapshot())).streets.length, recovered.streets.length, 'La memoria offline non impedisce la consultazione locale');
  await page.screenshot({ path: path.join(output, '02-recovered-real-profile.png') });
  await application.close(); application = null;
  // Synthetic data only: an import against the closed fixture port must wait,
  // rather than claim completion. Never enqueue the recovered user's units.
  const waitingProfile = path.join(directory, 'territory-waiting');
  const waitingStore = await TerritoryStore.open(waitingProfile, [street]);
  const source = simulationSource(street, 1, 'waiting-fixture'), key = unitKey(source);
  await waitingStore.change(state => { state.units[key] = { key, streetIds: [street.id], observations: [{ at: new Date().toISOString(), runId: source.jobId, source, streetId: street.id, origin: 'sister' }], corrections: {}, note: '', assessment: null, crmId: null, importedAt: null }; });
  ({ shell, page } = await launch(waitingProfile, false, true));
  await page.evaluate(key => window.territory.enqueue({ keys: [key] }), key);
  await page.locator('#queue-manager').click(); await page.locator('#queue-continue').click(); await page.locator('#queue-import').click();
  await page.waitForFunction(() => document.querySelector('#queue-run strong')?.textContent === 'In attesa di recupero');
  const waiting = (await page.evaluate(() => window.territory.snapshot())).activeRun;
  assert.equal(waiting.state, 'running'); assert.equal(waiting.endedAt, null); assert.equal(waiting.handled, 0); assert.ok(waiting.waiting);
  assert.equal(await page.locator('.queue-result').count(), 0, 'Una connessione mancante non conclude il batch');
  assert.ok((await page.locator('#queue-run').textContent()).includes('Riprovo automaticamente'));
  for (const width of [1600, 1024, 390]) {
    await page.setViewportSize({ width, height: 860 });
    assert.equal(await page.evaluate(() => document.querySelector('#detail-dialog').scrollWidth > document.querySelector('#detail-dialog').clientWidth + 1), false);
    await page.screenshot({ path: path.join(output, `03-queue-waiting-${width}.png`) });
  }
  await page.locator('#queue-pause').click();
  await page.locator('.queue-result h3').filter({ hasText: 'Lavoro interrotto' }).waitFor();
  const stopped = (await page.evaluate(() => window.territory.queue())).runs.at(-1);
  assert.equal(stopped.id, waiting.id); assert.equal(stopped.state, 'stopped'); assert.equal(stopped.waiting, null);
  assert.equal((await page.evaluate(() => window.territory.queue())).entries.length, 1);
  assert.equal((await readFile(path.join(desktop, 'sister-street-run.json'), 'utf8')), legacyCheckpoint);
  await application.close(); application = null;
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, singleWindow: true, isolatedRenderers: true, switchingPreservesDraft: true, legacyConcurrencyBlocked: true, pausePreservesRun: true, legacyPausedCheckpointPreserved: true, restoredUnits: expectedUnitKeys.length, sharedMemoryOfflineSupported: true, chromeWarningToast: true, toastOpensSharedBrowser: true, dismissedWarningStaysClosed: true, syntheticQueueWaitsForChrome: true, waitingImportCanBeInterrupted: true, realWritesEnabled: false, errors }, null, 2));
  console.log(`Worker V2 integrato e coda in attesa verificati: ${output}`);
} catch (error) {
  if (application) for (const [i, page] of application.context().pages().entries()) await page.screenshot({ path: path.join(output, `failure-${i}.png`) }).catch(() => {});
  throw error;
} finally { if (application) await application.close(); }
