// Offline diagnostic. Always runs against a disposable copy, never the user ledger.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { TerritoryStore } from '../dist-territory/territory/store.js';
import { TerritoryApplication } from '../dist-territory/territory/application.js';
import { TerritorySync } from '../dist-territory/territory/sync.js';
import { streetSummary } from '../dist-territory/territory/model.js';
import { unitRecordHtml } from '../dist-territory/territory/renderer/unit-card.js';

if (process.argv.length !== 3) throw new Error('Uso: node scripts/territory-performance-check.mjs <directory-profilo>');
const source = path.resolve(process.argv[2], 'territory-ledger.json'), original = await readFile(source);
const directory = await mkdtemp(path.join(os.tmpdir(), 'territory-perf-'));
const digest = data => createHash('sha256').update(data).digest('hex');
async function measure(name, fn) {
  const ms = []; let result;
  for (let i = 0; i < 3; i++) { const at = performance.now(); result = await fn(); ms.push(Number((performance.now() - at).toFixed(1))); }
  return { name, ms, bytes: Buffer.byteLength(JSON.stringify(result)) };
}
try {
  await writeFile(path.join(directory, 'territory-ledger.json'), original, { mode: 0o600 });
  const store = await TerritoryStore.open(directory, []);
  const app = new TerritoryApplication(store, { origin: 'live', canWrite: () => true });
  const state = store.read(), counts = new Map();
  for (const u of Object.values(state.units)) for (const id of u.streetIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const street = state.streets.filter(s => !s.linkedOfficialId).sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))[0];
  const config = { url: 'http://127.0.0.1:54321', key: 'offline-diagnostic', workspaceId: '11111111-1111-4111-8111-111111111111', ownerId: '22222222-2222-4222-8222-222222222222', profileKind: 'live' };
  // status() reads only the local binding; never invoke push/pull or a browser.
  const sync = new TerritorySync(store, directory, config, {});
  const measurements = [await measure('snapshot', () => app.snapshot()), await measure('detail', () => app.detail(street.id)), await measure('queue', () => app.importQueue()), await measure('syncStatus', () => sync.status())];
  const units = app.detail(street.id).units.slice(0, 100);
  const options = { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' }, formatter = new Intl.DateTimeFormat('it-IT', options);
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const render = date => units.map(u => unitRecordHtml(u, { escape, date })).join('');
  const legacyDate = value => value ? new Date(value).toLocaleString('it-IT', options) : 'Non ancora acquisita';
  const cachedDate = value => value ? formatter.format(new Date(value)) : 'Non ancora acquisita';
  assert.equal(render(legacyDate), render(cachedDate));
  measurements.push(await measure('cardsLegacyDate', () => render(legacyDate)), await measure('cardsCachedDate', () => render(cachedDate)));
  assert.deepEqual(app.snapshot().streets, state.streets.filter(s => !s.linkedOfficialId).map(s => streetSummary(state, s)));
  assert.equal(digest(await readFile(source)), digest(original));
  console.log(JSON.stringify({ originalUnchanged: true, offline: true, units: Object.keys(state.units).length, streets: state.streets.length, ledgerBytes: original.length, measurements }, null, 2));
} finally {
  assert.ok(path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('territory-perf-'));
  await rm(directory, { recursive: true, force: true });
}
