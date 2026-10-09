import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { streetSearchReady, selectStreet } from "./fixtures/street-search.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, "../.runtime/territory-search-check");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), "territory-search-"));
const env = { ...process.env, TERRITORY_LAB_DATA_DIR: profile, TERRITORY_LAB_VISUAL_CHECK: "1" };
delete env.ELECTRON_RUN_AS_NODE;
let application;
const errors = [];
try {
  application = await electron.launch({ args: [path.join(root, "dist-territory/territory/main.js")], env });
  const page = await application.firstWindow(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await streetSearchReady(page);
  await page.setViewportSize({ width: 1600, height: 960 });
  const snapshot = await page.evaluate(() => window.territory.snapshot());
  const street = snapshot.streets.find(s => s.geometry && s.name.includes("CASTELLUCCI"));
  const unlocated = snapshot.streets.find(s => !s.geometry && !s.needsReview);
  assert.equal(await page.locator("#catalog").count(), 0);
  assert.equal(await page.evaluate(() => document.querySelector("#map").clientWidth === document.querySelector(".workspace").clientWidth), true);
  await page.evaluate(() => {
    window.searchCheckPaths = new Set(); const original = L.Path.prototype.setStyle;
    L.Path.prototype.setStyle = function(style) { window.searchCheckPaths.add(this); return original.call(this, style); };
  });
  await page.locator("#tools").evaluate(element => { element.open = true; });
  await page.locator("#refresh").click();
  await page.waitForFunction(() => window.searchCheckPaths.size > 500);
  const mapState = () => page.evaluate(() => {
    const paths = [...window.searchCheckPaths].filter(p => p._map), map = paths[0]._map;
    return { zoom: map.getZoom(), paths: paths.length, center: map.getCenter(), wide: paths.filter(p => p.options.weight > 4).length };
  });
  const baseline = await mapState();
  const elapsed = await page.evaluate(name => new Promise((resolve, reject) => {
    const input = document.querySelector("#search"), list = document.querySelector("#streets");
    input.focus(); let started;
    const observer = new MutationObserver(() => {
      if (list.querySelector("[data-street]")) { observer.disconnect(); resolve(performance.now() - started); }
    });
    input.value = "Questo risultato non deve comparire"; input.dispatchEvent(new Event("input", { bubbles: true }));
    setTimeout(() => {
      started = performance.now(); observer.observe(list, { childList: true });
      input.value = name; input.dispatchEvent(new Event("input", { bubbles: true }));
    }, 80);
    setTimeout(() => { observer.disconnect(); reject(new Error("Debounce non conclusa")); }, 3000);
  }), street.name);
  assert.ok(elapsed >= 240 && elapsed < 2000, "Risultati solo dopo la debounce dell'ultimo testo");
  assert.equal((await mapState()).paths, baseline.paths, "La ricerca non rimuove le altre vie dalla mappa");
  await page.screenshot({ path: path.join(output, "01-search-results.png") });
  await page.locator(`[data-street="${street.id}"]`).click();
  assert.equal(await page.locator("#detail-dialog").isVisible(), false);
  assert.equal(await page.locator("#hover [data-open]").getAttribute("data-open"), street.id);
  assert.equal(await page.locator("#street-search-menu").isVisible(), false);
  const selected = await mapState();
  assert.ok(selected.zoom > baseline.zoom, "La selezione ingrandisce il tracciato");
  assert.equal(selected.wide, 0, "La ricerca non lascia un'evidenziazione hover permanente");
  await page.screenshot({ path: path.join(output, "02-zoom-popup.png") });
  await page.locator("#clear-search").click();
  assert.equal(await page.locator("#search").inputValue(), "");
  assert.equal(await page.evaluate(() => document.activeElement.id), "search");
  assert.equal((await mapState()).zoom, selected.zoom);
  await selectStreet(page, unlocated);
  assert.equal((await mapState()).zoom, selected.zoom, "Nessuna posizione inventata per una via senza tracciato");
  assert.ok((await page.locator("#hover").textContent()).includes("Tracciato non disponibile"));
  await page.locator("#hover .preview-close").click();
  await page.locator("#search").fill(street.name); await page.locator(`[data-street="${street.id}"]`).waitFor();
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  assert.equal(await page.locator("#hover [data-open]").getAttribute("data-open"), street.id);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.screenshot({ path: path.join(output, `03-map-${theme}.png`) });
  }
  for (const width of [1024, 650, 390]) {
    await page.setViewportSize({ width, height: 760 });
    await page.locator("#search").fill(street.name); await page.locator(`[data-street="${street.id}"]`).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false);
    const bounds = await page.locator("#street-search-menu").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 760);
    await page.screenshot({ path: path.join(output, `04-search-${width}.png`) });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#street-search-menu").isVisible(), false);
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ ok: true, debounceMs: elapsed, fullMapPreserved: true, zoomAndPopup: true, keyboard: true, clearInput: true, unlocatedStreet: true, responsive: true, errors }, null, 2));
  console.log("Ricerca vie verificata: debounce, zoom, popup, tastiera, X e mappa completa.");
} finally { if (application) await application.close(); }
