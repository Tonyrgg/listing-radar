import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { streetSearchReady, openStreet } from './fixtures/street-search.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../.runtime/territory-queue-check');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), 'territory-queue-ui-'));
const env = { ...process.env, TERRITORY_LAB_DATA_DIR: profile, TERRITORY_LAB_VISUAL_CHECK: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const errors = []; let app, page;
async function launch() {
  app = await electron.launch({ args: [path.join(root, 'dist-territory/territory/main.js')], env });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
  await streetSearchReady(page);
}
async function until(fn, value) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await page.evaluate(fn, value)) return; await new Promise(r => setTimeout(r, 80)); }
  throw new Error('Stato della coda non raggiunto');
}
async function filter(id, value) {
  await page.locator(id + ' details').evaluate(el => el.open = true);
  await page.locator(id + ' input[type=checkbox][value="' + value + '"]').check();
}
try {
  await launch();
  const snapshot = await page.evaluate(() => window.territory.snapshot());
  const streets = ['CASTELLUCCI', 'TOGLIATTI'].map(name => snapshot.streets.find(s => s.geometry && !s.needsReview && s.name.includes(name)));
  assert.ok(streets.every(Boolean));
  await page.locator('#queue-manager').click(); assert.equal(await page.locator('.queue-empty').count(), 1);
  await page.locator('#detail-close').click();
  for (const street of streets) {
    await page.evaluate(id => window.territory.start({ streetId: id, operation: 'scan' }), street.id);
    await until(async id => (await window.territory.detail(id)).runs.at(-1)?.state === 'completed' && !(await window.territory.snapshot()).activeRun, street.id);
  }
  const units = await page.evaluate(async ids => (await Promise.all(ids.map(id => window.territory.detail(id)))).map(d => d.units), streets.map(s => s.id));
  const first = units[0][0], second = units[1][0];
  const denied = await page.evaluate(async key => { try { await window.territory.start({ operation: "apply", streetId: "unused", selected: [key] }); return ""; } catch (e) { return e.message; } }, first.key);
  assert.ok(denied.includes("coda"), "Il main process impedisce import diretti fuori dalla coda");
  await page.evaluate(({ unit, street }) => window.territory.correct({ key: unit.key, correction: { address: street.name + ' N. 12/A Piano 1', category: 'A/3' }, note: '' }), { unit: first, street: streets[0] });
  await openStreet(page, streets[0]);
  assert.equal(await page.locator('#apply, [data-disclosure="options-apply"]').count(), 0, 'Nessun import nella scheda via');
  await page.locator('[data-disclosure=unit-filters]').evaluate(el => el.open = true);
  await filter('#unit-floors', '1'); await filter('#unit-categories', 'A/3'); await filter('#unit-owners', first.source.owners[0].taxCode);
  await page.locator('#unit-min-civic').fill('12'); await page.locator('#unit-min-civic').press('Tab');
  await page.locator('#unit-max-civic').fill('12'); await page.locator('#unit-max-civic').press('Tab');
  assert.equal(await page.locator('[data-unit]').count(), 1, 'Filtri combinati in scheda via');
  await page.locator('#unit-min-civic').fill('20'); await page.locator('#unit-min-civic').press('Tab');
  assert.equal(await page.locator('#unit-min-civic').inputValue(), '12', 'Un intervallo invalido non modifica i filtri applicati');
  assert.equal(await page.locator('[data-unit]').count(), 1);
  await page.locator('#select-all').click(); await page.locator('#enqueue').click();
  await until(async () => (await window.territory.snapshot()).queueCount === 1);
  await page.locator('#detail-close').click();
  await openStreet(page, streets[1]); await page.locator('[data-unit-select="' + second.key + '"]').check(); await page.locator('#enqueue').click();
  await until(async () => (await window.territory.snapshot()).queueCount === 2);
  const ledgerBefore = JSON.parse(await readFile(path.join(profile, 'territory-ledger.json'), 'utf8'));
  const queueBefore = await page.evaluate(() => window.territory.queue());
  assert.equal(new Set(queueBefore.entries.map(e => e.streetId)).size, 2);
  const entryId = queueBefore.entries[0].id;
  assert.equal(await page.evaluate(key => window.territory.enqueue({ keys: [key] }), first.key), 0);
  await app.close(); app = null; await launch();
  await page.locator('#queue-manager').click(); await page.locator('#queue-content').waitFor();
  assert.equal((await page.evaluate(() => window.territory.queue())).entries[0].id, entryId, 'Coda conservata dopo riavvio');
  const form = page.locator('[data-edit="' + first.key + '"]');
  await form.evaluate(el => el.closest('details').open = true);
  await form.locator('[name=address]').fill(streets[0].name + ' N. 14 Piano 2');
  await form.locator('[name=note]').fill('Nota permanente dalla coda');
  await page.locator('#queue-clear').click(); assert.equal(await form.locator('[name=note]').inputValue(), 'Nota permanente dalla coda', 'Selezione non perde modifiche');
  await form.getByRole('button', { name: 'Salva correzioni', exact: true }).click();
  await until(async key => (await window.territory.unitDetail(key)).note === 'Nota permanente dalla coda', first.key);
  await page.locator('[data-queue-remove="' + first.key + '"]').click();
  await until(async () => (await window.territory.queue()).entries.length === 1);
  assert.equal((await page.evaluate(key => window.territory.unitDetail(key), first.key)).note, 'Nota permanente dalla coda');
  await page.locator('#detail-close').click(); await page.locator('#query-manager').click(); await page.locator('#query-form').waitFor();
  assert.equal(await page.locator('#q-apply, #q-policy').count(), 0, 'Nessun import nelle query');
  await page.locator('[data-query-select="' + first.key + '"]').check(); await page.locator('#q-enqueue').click();
  await until(async () => (await window.territory.queue()).entries.length === 2);
  await page.locator('#detail-close').click(); await page.locator('#queue-manager').click();
  const ledger = JSON.parse(await readFile(path.join(profile, 'territory-ledger.json'), 'utf8'));
  assert.deepEqual(ledger.virtualCrm, ledgerBefore.virtualCrm, 'Accodare e correggere non scrive nel CRM');
  assert.equal(await page.locator('[data-unit-select]:checked').count(), 2);
  for (const [width, theme] of [[1600, 'dark'], [1024, 'light'], [390, 'dark']]) {
    await page.setViewportSize({ width, height: 860 }); await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('#detail-dialog').scrollWidth > document.querySelector('#detail-dialog').clientWidth + 1), false, 'Coda senza overflow');
    const button = await page.locator('#queue-import').boundingBox(), modal = await page.locator('#detail-dialog').boundingBox();
    assert.ok(button.y + button.height <= modal.y + modal.height, 'Il comando import resta interamente visibile');
    await page.screenshot({ path: path.join(output, 'queue-' + width + '.png') });
  }
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.locator('#queue-search').fill(first.key);
  assert.equal(await page.locator('[data-unit]').count(), 1, 'Ricerca catastale nella coda');
  assert.ok((await page.locator('.queue-selection strong').textContent()).includes('1 fuori dalla ricerca'));
  await page.locator('#queue-search').fill(''); await page.locator('#queue-import').click();
  await until(async () => !(await window.territory.snapshot()).activeRun && (await window.territory.queue()).entries.length === 0);
  const after = await page.evaluate(() => window.territory.queue());
  assert.equal(after.runs.at(-1).state, 'completed'); assert.equal(Object.keys(after.runs.at(-1).imports).length, 2);
  assert.equal((await page.evaluate(key => window.territory.unitDetail(key), first.key)).source.fullAddress, streets[0].name + ' N. 14 Piano 2');
  await page.locator('#detail-close').click(); await openStreet(page, streets[0]);
  assert.ok((await page.locator('[data-unit="' + first.key + '"] h3').textContent()).includes('14 Piano 2'));
  await page.locator('#detail-close').click();
  await page.evaluate(async keys => {
    await window.territory.enqueue({ keys });
    await window.territory.start({ queue: true, operation: "apply", selected: keys, settings: { activityMode: "none", includeCoOwners: true, importPolicy: "create_update" } });
    await window.territory.pause();
  }, [first.key, second.key]);
  await until(async () => !(await window.territory.snapshot()).activeRun);
  await app.close(); app = null; await launch();
  await page.locator('#queue-manager').click();
  await page.locator('[data-queue-resume]').waitFor();
  assert.equal(await page.locator('#queue-import').isDisabled(), true, 'Una ripresa conserva il suo piano');
  await page.locator('[data-queue-resume]').click();
  await until(async () => !(await window.territory.snapshot()).activeRun && !(await window.territory.queue()).entries.length);
  const resumed = await page.evaluate(() => window.territory.queue());
  assert.equal(resumed.runs.at(-1).state, 'completed');
  assert.equal(Object.keys(resumed.runs.at(-1).imports).length, 2);
  await page.locator('#detail-close').click();
  await page.setViewportSize({ width: 390, height: 760 });
  assert.equal(await page.evaluate(() => document.querySelector('.map-toolbar').getBoundingClientRect().right <= innerWidth), true);
  await page.screenshot({ path: path.join(output, 'map-390.png') });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, persistentQueue: true, multiStreet: true, permanentEdits: true, combinedStreetFilters: true, queryEnqueue: true, noPrematureWrites: true, verifiedImportsRemoved: true, errors }, null, 2));
  console.log('Coda persistente, filtri, correzioni permanenti e import centralizzato verificati in Electron simulato.');
} finally { if (app) await app.close(); }
