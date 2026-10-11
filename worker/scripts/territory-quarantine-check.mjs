import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { streetSearchReady, openStreet } from "./fixtures/street-search.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, "../.runtime/territory-quarantine-check");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), "territory-quarantine-ui-"));
const env = { ...process.env, TERRITORY_LAB_DATA_DIR: profile, TERRITORY_LAB_VISUAL_CHECK: "1" };
delete env.ELECTRON_RUN_AS_NODE;
let app; const errors = [];
async function until(page, predicate, value) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await page.evaluate(predicate, value)) return; await new Promise(resolve => setTimeout(resolve, 80)); }
  throw new Error("Stato quarantena non raggiunto entro 20 secondi");
}
try {
  app = await electron.launch({ args: [path.join(root, "dist-territory/territory/main.js")], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message));
  await streetSearchReady(page);
  const street = (await page.evaluate(() => window.territory.snapshot())).streets.find(s => s.geometry && !s.needsReview && s.name.includes("CASTELLUCCI"));
  await openStreet(page, street); await page.locator('[data-operation="scan"]').click();
  await until(page, async id => (await window.territory.detail(id)).runs.at(-1)?.state === "completed", street.id);
  const detail = await page.evaluate(id => window.territory.detail(id), street.id);
  assert.equal(detail.units.length, 5); assert.equal(detail.quarantine.length, 1);
  await until(page, () => document.querySelector(".detail-header .status")?.textContent.includes("conclusa"));
  assert.ok((await page.locator(".acquisition-state, .detail-header .status").textContent()).includes("conclusa"));
  assert.equal(await page.locator("#resume").count(), 0);
  const keys = detail.units.filter(u => ["1", "2", "3", "4"].includes(u.source.cadastral.subaltern)).map(u => u.key);
  const originalBad = detail.quarantine.find(q => q.source?.owners[0]?.taxCode === "DA_COMPLETARE");
  await page.evaluate(key => window.territory.correct({ key, correction: {}, note: "Nota confermata da conservare" }), originalBad.unitKey);
  for (const key of keys) await page.locator(`[data-unit-select="${key}"]`).check();
  assert.equal(await page.locator("#enqueue").isDisabled(), false);
  await page.locator("#enqueue").click();
  await page.locator("#detail-close").click(); await page.locator("#queue-manager").click();
  await page.locator("[data-disclosure=queue-options]").evaluate(el => el.open = true);
  await page.locator("#queue-activity").selectOption("plain");
  await page.locator("#queue-import").click();
  await until(page, async id => (await window.territory.detail(id)).runs.at(-1)?.operation === "apply" && (await window.territory.detail(id)).runs.at(-1)?.state === "completed", street.id);
  const applied = await page.evaluate(id => window.territory.detail(id), street.id);
  assert.equal(Object.keys(applied.runs.at(-1).imports).length, 3); assert.equal(applied.quarantine.length, 2);
  await page.locator("#detail-close").click(); await openStreet(page, street);
  await until(page, () => document.querySelector("#tab-quarantine")?.textContent.includes("Quarantena 2"));
  assert.equal(await page.locator("#resume").count(), 0);
  await page.locator("#tab-quarantine").click();
  assert.equal(await page.locator(".quarantine-item").count(), 2);
  await page.locator("#tab-quarantine").focus(); await page.keyboard.press("End");
  assert.equal(await page.locator("#tab-history").getAttribute("aria-selected"), "true");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.locator("#tab-quarantine").getAttribute("aria-selected"), "true");
  for (const width of [1600, 1024, 390]) {
    await page.setViewportSize({ width, height: 860 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector("#detail-dialog").scrollWidth > document.querySelector("#detail-dialog").clientWidth + 1), false);
    await page.screenshot({ path: path.join(output, `quarantine-${width}.png`) });
  }
  await page.setViewportSize({ width: 1600, height: 960 });
  const item = applied.quarantine.find(q => q.source?.owners[0]?.taxCode === "DA_COMPLETARE");
  const form = page.locator(`[data-quarantine-edit="${item.id}"]`);
  await form.locator("xpath=..").locator("summary").click();
  await form.locator('[name="cf-0"]').fill("RSSMRA80A01A662A");
  assert.equal(await page.locator("#draft-status").isVisible(), true);
  await form.getByRole("button", { name: "Salva e rimetti in lavorazione", exact: true }).click();
  await until(page, async id => (await window.territory.detail(id)).quarantine.length === 1, street.id);
  await page.locator("#tab-units").click(); assert.equal(await page.locator(".unit").count(), 5);
  const unit = await page.evaluate(key => window.territory.unitDetail(key), item.unitKey);
  assert.equal(unit.observations[0].source.owners[0].taxCode, "DA_COMPLETARE");
  assert.equal(unit.source.owners[0].taxCode, "RSSMRA80A01A662A");
  assert.equal(unit.note, "Nota confermata da conservare");
  await page.locator("#detail-close").click(); await page.locator("#tools > summary").click(); await page.locator("#quarantine-open").click();
  assert.equal(await page.locator(".quarantine-item").count(), 1);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ ok: true, acquisitionConcluded: true, unifiedApply: true, threeImports: true, ambiguousQuarantined: true, correctionReleasesUnit: true, originalsPreserved: true, globalQuarantine: true, responsive: true, errors }, null, 2));
  console.log("Quarantena, confronto e import nello stesso avvio verificati in Electron simulato.");
} finally { if (app) await app.close(); }
