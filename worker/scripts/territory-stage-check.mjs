import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { streetSearchReady, openStreet, openStreetSettings } from "./fixtures/street-search.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, "../.runtime/territory-stage-check");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), "territory-stage-"));
const env = { ...process.env, TERRITORY_LAB_DATA_DIR: profile, TERRITORY_LAB_VISUAL_CHECK: "1" };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ args: [path.join(root, "dist-territory/territory/main.js")], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await streetSearchReady(page); return page;
}
try {
  let page = await launch();
  const snapshot = await page.evaluate(() => window.territory.snapshot());
  const street = snapshot.streets.find(s => s.catalogKind === "network" && s.geometry && !s.needsReview && s.name.includes("Mazzini")) || snapshot.streets.find(s => s.geometry && s.name.includes("CASTELLUCCI"));
  await openStreet(page, street);
  assert.equal(await page.locator("#detail-dialog").getAttribute("data-street-phase"), "unacquired");
  assert.equal(await page.locator('[data-operation="scan"]').count(), 1, "Una sola acquisizione disponibile");
  assert.equal(await page.locator('#tab-units, #tab-history, #apply, [data-operation="compare"], .import-summary, #unit-filter').count(), 0, "Nessuna funzione o statistica vuota");
  assert.equal(await page.locator(".street-settings").evaluate(element => element.open), false);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.screenshot({ path: path.join(output, `01-unacquired-${theme}.png`) });
  }
  for (const width of [1600, 1024, 390]) {
    await page.setViewportSize({ width, height: 760 });
    const bounds = await page.locator("#detail-dialog").boundingBox();
    assert.ok(bounds.height < 620, "La via vuota ha una scheda compatta");
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= 761);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false);
    await page.screenshot({ path: path.join(output, `02-unacquired-${width}.png`) });
  }
  await openStreetSettings(page);
  await page.locator('[data-disclosure="notes"] > summary').click();
  await page.locator("#street-note").fill("Nota prima di acquisire");
  await page.getByRole("button", { name: "Salva note", exact: true }).click();
  await page.waitForFunction(async id => (await window.territory.detail(id)).memory.note === "Nota prima di acquisire", street.id);
  assert.equal(await page.locator("#tab-units").count(), 0);
  await app.close(); app = null;
  // A failed read before the first property has a resume view, not fabricated data.
  const file = path.join(profile, "territory-ledger.json"), ledger = JSON.parse(await readFile(file, "utf8"));
  const at = new Date().toISOString();
  ledger.runs.push({ id: "first-interrupted", streetId: street.id, operation: "scan", origin: "simulation", state: "paused", startedAt: at, endedAt: null, error: "Prima lettura interrotta", handled: 0, total: null, itemKeys: [] });
  await writeFile(file, JSON.stringify(ledger));
  page = await launch(); await openStreet(page, street);
  assert.equal(await page.locator("#detail-dialog").getAttribute("data-street-phase"), "interrupted");
  assert.equal(await page.locator('[data-operation="scan"]').count(), 0, "La ripresa prevale su una nuova acquisizione");
  assert.equal(await page.locator("#resume").textContent(), "Riprendi acquisizione");
  assert.equal(await page.locator('#tab-units, .import-summary').count(), 0);
  await page.screenshot({ path: path.join(output, "03-interrupted.png") });
  await page.locator("#feedback .toast-close").click();
  await page.locator("#resume").click();
  await page.waitForFunction(async id => (await window.territory.detail(id)).units.length === 6 && !(await window.territory.snapshot()).activeRun, street.id);
  await page.getByRole("tab", { name: "Immobili 6", exact: true }).waitFor();
  assert.equal(await page.locator("#detail-dialog").getAttribute("data-street-phase"), "populated");
  assert.equal(await page.locator(".unit").count(), 6);
  assert.equal((await page.evaluate(id => window.territory.detail(id), street.id)).memory.note, "Nota prima di acquisire");
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.screenshot({ path: path.join(output, "04-acquired.png") });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ ok: true, compactUnacquired: true, singleAction: true, noEmptyFunctions: true, pausedBeforeData: true, populatedTransition: true, notePreserved: true, responsive: true, errors }, null, 2));
  console.log("Stati della scheda via verificati: iniziale, interrotta, acquisita e responsive.");
} finally { if (app) await app.close(); }
