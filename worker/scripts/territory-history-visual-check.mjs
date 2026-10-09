import { streetSearchReady, openStreet } from "./fixtures/street-search.mjs";
import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, "..", ".runtime/territory-history-ui-check");
await mkdir(output, { recursive: true });
const original = path.join(process.env.APPDATA, "ListingRadarTerritoryLab-live");
const ledger = JSON.parse(await readFile(path.join(original, "territory-ledger.json"), "utf8"));
const historySnapshot = JSON.parse(await readFile(path.join(original, "history-snapshot.json"), "utf8"));
const config = JSON.parse(await readFile(path.join(original, "sync-config.json"), "utf8"));
config.workspaceId = randomUUID(); config.ownerId = randomUUID();
const liveConfig = JSON.parse(await readFile(path.join(original, "live-config.json"), "utf8"));
liveConfig.allowedCadastralKeys = []; liveConfig.allowedTaxCodes = []; liveConfig.allowCreate = false;
const directories = [];
const errors = [];
let application;
async function launch(withLedger = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "territory-history-visual-"));
  directories.push(`${directory}-live`); await mkdir(`${directory}-live`);
  for (const [file, value] of [["sync-config.json", config], ["live-config.json", liveConfig], ...(withLedger ? [["territory-ledger.json", ledger], ["history-snapshot.json", historySnapshot]] : [])]) await writeFile(path.join(`${directory}-live`, file), JSON.stringify(value), { mode: 0o600 });
  const env = { ...process.env, TERRITORY_LAB_DATA_DIR: directory, TERRITORY_LAB_VISUAL_CHECK: "1" }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ args: [path.join(root, "dist-territory/territory/main.js"), "--territory-live"], env });
  const page = await application.firstWindow(); page.setDefaultTimeout(20000);
  page.on("pageerror", e => errors.push(e.message));
  await streetSearchReady(page);
  return page;
}
async function until(page, predicate, argument) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await page.evaluate(predicate, argument)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("Stato atteso non raggiunto");
}
async function memory(page, direction) {
  if (await page.locator('#detail-dialog').isVisible()) await page.locator('#detail-close').click();
  await page.locator("#cloud-memory").click();
  await page.locator(`#memory-${direction}`).click();
  await until(page, () => !document.querySelector('#memory-close').disabled && !document.querySelector('#memory-result').textContent.includes('in corso'));
  const message = await page.locator("#memory-result").textContent();
  assert.ok(/Memoria (condivisa aggiornata|caricata|recuperata)|coincidono/.test(message), message);
  await page.locator("#memory-close").click();
}
try {
  let page = await launch(true);
  await memory(page, "push");
  await application.close(); application = null;
  page = await launch();
  assert.equal((await page.evaluate(() => window.territory.snapshot())).streets.reduce((n, s) => n + s.count, 0), 0);
  await memory(page, "pull");
  const restored = await page.evaluate(() => window.territory.snapshot());
  assert.equal(restored.origin, "live"); assert.equal(restored.streets.reduce((n, s) => n + s.count, 0), 928);
  assert.equal(restored.historyIssues, 180);
  assert.ok(restored.streets.some(s => s.progress.imported > 0 && s.progress.lastImportedAt), 'Lo storico recupera import datati, senza usare la data del recupero');
  const review = await page.evaluate(() => window.territory.historyReview());
  assert.equal(review.filter(r => r.canAssociate).length, 147);
  // All authorisations below affect a temporary profile only; never apply to CRM.
  await page.locator('#tools').evaluate(el => { el.open = true; });
  await page.locator('#test-settings').click();
  const settings = await page.evaluate(() => window.territory.testSettings());
  const testRecord = settings.records.find(r => r.eligible);
  assert.ok(testRecord, 'Lo storico deve offrire almeno una scheda valida per il collaudo');
  await page.locator('#test-search').fill(testRecord.key);
  await page.locator(`[data-test-key="${testRecord.key}"]`).check();
  await page.locator('#test-save').click();
  assert.equal((await page.evaluate(() => window.territory.testSettings())).selected.length, 0, 'La scelta senza consenso non abilita scritture');
  await page.locator('#detail-refresh').click();
  assert.equal(await page.locator(`[data-test-key="${testRecord.key}"]`).isChecked(), true, 'Aggiornare non perde una scelta aperta');
  await page.locator('#test-consent').check();
  await page.locator('#test-save').click();
  await until(page, async key => (await window.territory.testSettings()).selected.includes(key), testRecord.key);
  const selectedConfig = JSON.parse(await readFile(path.join(directories.at(-1), 'live-config.json'), 'utf8'));
  assert.equal(selectedConfig.allowedCadastralKeys.length, 1);
  assert.equal(selectedConfig.allowCreate, false);
  assert.deepEqual(selectedConfig.allowedTaxCodes.sort(), [...new Set(testRecord.owners.map(o => o.taxCode.trim().toUpperCase()))].sort());
  await page.screenshot({ path: path.join(output, '00-test-settings.png') });
  await page.locator('#test-revoke').click();
  await until(page, async () => (await window.territory.testSettings()).selected.length === 0);
  const row = review.find(r => r.canAssociate);
  const street = restored.streets.find(s => !s.needsReview && s.geometry);
  await page.locator('#detail-close').click();
  await page.locator('#tools').evaluate(el => { el.open = true; });
  await page.locator("#history-review").click();
  await page.locator("#history-search").fill(row.address);
  await page.locator(`[data-associate="${row.propertyId}"]`).click();
  await page.locator("#history-street").fill(`${street.name} · Codvia ${street.id}`);
  assert.equal(await page.locator("#history-search").isDisabled(), true, "Il filtro non scarta un'associazione aperta");
  await page.locator("#detail-refresh").click();
  assert.equal(await page.locator("#history-street").inputValue(), `${street.name} · Codvia ${street.id}`);
  await page.getByRole("button", { name: "Conferma associazione", exact: true }).click();
  await until(page, async () => (await window.territory.snapshot()).historyIssues === 179);
  const current = await page.evaluate(() => window.territory.historyReview());
  assert.ok(!current.some(r => r.propertyId === row.propertyId));
  await page.locator('#detail-close').click();
  await openStreet(page, street);
  await page.getByRole("tab", { name: "Storico", exact: true }).click();
  await page.screenshot({ path: path.join(output, "01-history.png") });
  await memory(page, "push");
  for (const width of [1024, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Overflow ${width}`);
    await page.locator("#cloud-memory").click();
    await page.screenshot({ path: path.join(output, `02-memory-${width}.png`) });
    await page.locator("#memory-close").click();
  }
  await application.close(); application = null;
  page = await launch(); await memory(page, "pull");
  assert.equal((await page.evaluate(() => window.territory.snapshot())).historyIssues, 179);
  const finalLedger = JSON.parse(await readFile(path.join(directories.at(-1), "territory-ledger.json"), "utf8"));
  assert.equal(finalLedger.historicalStreetMappings[row.propertyId], street.id);
  assert.equal(Object.keys(finalLedger.checkpoints).length, 0);
  assert.equal(finalLedger.runs.length, 0);
  assert.equal(errors.length, 0, errors.join("\n"));
  await writeFile(path.join(output, "result.json"), JSON.stringify({ ok: true, recoveredUnits: 928, issues: 180, manualAssociations: 1, restoredAssociation: true, testSelectionSavedAndRevoked: true, crmWrites: 0, errors, directories }, null, 2));
  console.log(`Collaudo dello storico e memoria locale superato. Schermate: ${output}`);
} catch (error) {
  if (application) { const page = await application.firstWindow(); await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {}); }
  throw error;
} finally { if (application) await application.close(); }
