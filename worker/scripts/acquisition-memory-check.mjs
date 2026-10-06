import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(os.tmpdir(), 'territory-daily-memory-'));
const profile = path.join(directory, 'territory-live');
const desktop = path.join(directory, 'desktop'); await mkdir(desktop);
const snapshot = { version: 1, readOnly: true, source: 'https://example.test', exportedAt: '2026-10-06T12:00:00Z', skippedJobIds: [], jobs: [{
  job: { id: 'daily-job', mode: 'automatic', status: 'saved', current_step: 'properties_processed', last_completed_step: 'acquisition_reviewed', municipality: 'BITONTO', street: 'VIA PALMIRO TOGLIATTI', civic_number: null, sister_source_url: null, created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T11:00:00Z', acquisition: { acquisitionCheckpoint: { status: 'completed', results: [{ outcome: 'found', inventoryProperties: [1, 2].map(n => ({ municipality: 'BITONTO', sheet: '41', parcel: String(100 + n), subaltern: '1', address: `VIA PALMIRO TOGLIATTI n. ${n}`, category: 'A/3' })) }] } } },
  graph: { properties: [{ id: 'daily-property', job_id: 'daily-job', municipality: 'BITONTO', sheet: '41', parcel: '101', subaltern: '1', cadastral_key: 'BITONTO|41|101|1', address: 'VIA PALMIRO TOGLIATTI n. 1', census_zone: null, category: 'A/3', class: '2', consistency: '4 vani', cadastral_income: 200, raw_payload: {}, processing_status: 'normalized', crm_record_id: null }], people: [{ id: 'daily-person', job_id: 'daily-job', tax_code: 'RSSMRA70A01A893X', full_name: 'Rossi Mario', birth_date: null, birth_place: null, birth_province: null, right_type: 'Proprietà', share_percentage: 100, mobiles: [], landlines: [], emails: [] }], ownerships: [{ id: 'daily-link', property_id: 'daily-property', person_id: 'daily-person', right_type: 'Proprietà', share_percentage: 100 }] }, items: [], ignoredBusinessRows: [],
}] };
let app;
async function launch() {
  app = await electron.launch({ args: [path.join(root, 'scripts/fixtures/acquisition-memory-host.cjs')], env: { ...process.env, WORKER_MEMORY_ROOT: root, WORKER_MEMORY_PROFILE: profile, WORKER_MEMORY_DESKTOP_DIR: desktop } });
  await app.firstWindow();
  await app.evaluate(async () => { while (!global.memoryTest) await new Promise(resolve => setTimeout(resolve, 10)); });
}
try {
  await launch();
  await app.evaluate(async (_, snapshot) => { await global.memoryTest.host.remember(snapshot); }, snapshot);
  let state = JSON.parse(await readFile(path.join(profile, 'territory-ledger.json'), 'utf8'));
  assert.equal(Object.keys(state.units).length, 1); assert.equal(state.history.length, 1);
  assert.equal(await app.evaluate(() => global.memoryTest.window.contentView.children.at(-1).getVisible()), false, 'Daily acquisition populates memory without opening V2');
  const first = await app.evaluate(() => global.memoryTest.host.session.application.detail('280'));
  assert.equal(first.street.progress.total, 2); assert.equal(first.street.progress.imported, 0);
  await app.evaluate(async () => { await global.memoryTest.host.session.application.annotate('280', 'Conferma conservata', true); });
  snapshot.jobs[0].job.updated_at = '2026-10-06T12:00:00Z';
  snapshot.jobs[0].items.push({ id: 'daily-item', property_id: 'daily-property', stage: 'completed', status: 'completed', plan: null, checkpoint: { crmPropertyId: 'verified-crm-property' }, last_error: null, completed_at: '2026-10-06T11:30:00Z' });
  await app.evaluate(async (_, snapshot) => { await global.memoryTest.host.remember(snapshot); await global.memoryTest.host.remember(snapshot); }, snapshot);
  const second = await app.evaluate(() => global.memoryTest.host.session.application.detail('280'));
  assert.equal(second.street.progress.percent, 50); assert.equal(second.street.progress.imported, 1);
  assert.equal(second.memory.note, 'Conferma conservata');
  assert.equal(second.units[0].observations.length, 1, 'Same acquisition is not duplicated');
  await app.evaluate(async () => { await global.memoryTest.host.close(); global.memoryTest.window.destroy(); });
  await app.close(); app = undefined;
  await launch(); await app.evaluate(async () => { await global.memoryTest.host.remember(); });
  const restarted = await app.evaluate(() => global.memoryTest.host.session.application.detail('280'));
  assert.equal(restarted.street.progress.percent, 50); assert.equal(restarted.memory.note, 'Conferma conservata');
  await app.evaluate(async () => { await global.memoryTest.host.close(); global.memoryTest.window.destroy(); });
  console.log('Daily memory bridge verified: hidden V2, inventory denominator, verified imports, idempotency, notes, restart; external services excluded.');
} finally { await app?.close(); }
