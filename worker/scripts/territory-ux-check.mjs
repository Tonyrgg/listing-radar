import { streetSearchReady, openStreet, openStreetSettings } from "./fixtures/street-search.mjs";
import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, "../.runtime/territory-ux-check");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), "territory-ux-"));
const env = {
  ...process.env,
  TERRITORY_LAB_DATA_DIR: profile,
  TERRITORY_LAB_VISUAL_CHECK: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function until(page, predicate, value) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, value)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Stato UX non raggiunto entro 20 secondi");
}
try {
  app = await electron.launch({
    args: [path.join(root, "dist-territory/territory/main.js")],
    env,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await streetSearchReady(page);
  await page.evaluate(() => document.fonts.ready);
  let fonts = await page.evaluate(() =>
    [...document.fonts].map((f) => ({ family: f.family, status: f.status })),
  );
  assert.ok(
    fonts.some((f) => f.family === "Instrument Sans" && f.status === "loaded"),
    "Font dell’interfaccia distribuito e caricato",
  );
  assert.equal(await page.locator("#catalog").count(), 0, "Sidebar rimossa dal DOM");
  assert.equal(await page.locator("#street-search-menu").isVisible(), false);
  await page.locator("#search").focus();
  await page.locator("#more-streets").click();
  assert.equal(await page.locator(".street-row").count(), 80, "Il catalogo resta sfogliabile nella tendina");
  const snapshot = await page.evaluate(() => window.territory.snapshot());
  const street = snapshot.streets.find(
    (s) => s.geometry && s.name.includes("CASTELLUCCI"),
  );
  await page.locator("#search").fill(street.name);
  await page.locator('[data-street="' + street.id + '"]').waitFor();
  await page.keyboard.press("ArrowDown");
  const activeOption = await page.locator("#search").getAttribute("aria-activedescendant");
  assert.equal(await page.locator("#" + activeOption).getAttribute("data-street"), street.id);
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#detail-dialog").isVisible(), false, "La ricerca apre il popup, non la modale");
  await page.locator('#hover [data-open="' + street.id + '"]').click();
  assert.equal(await page.locator("#tab-units").count(), 0, "Prima di acquisire non ci sono tab vuote");
  await openStreetSettings(page); await page.locator('[data-disclosure="options-scan"] > summary').click();
  await page.locator("#scan-floor-mode").selectOption("exact");
  await page.locator("#scan-floor").fill("0");
  await page.locator("#scan-min-civic").fill("2");
  await page.locator("#scan-max-civic").fill("12");
  await page.evaluate(id => window.territory.annotate({ streetId: id, note: "Opzioni in preparazione", attention: false }), street.id);
  await until(page, () => document.querySelector("#street-note")?.value === "Opzioni in preparazione");
  assert.equal(await page.locator("#scan-floor").inputValue(), "0");
  assert.equal(await page.locator("#scan-max-civic").inputValue(), "12");
  await page.locator("#scan-floor-mode").selectOption("any");
  await page.locator('[data-operation="scan"]').click();
  // Hidden Electron throttles animation frames to 1 fps: the 720 ms fixture
  // ends before Playwright's two-frame stability wait. Check visibility and
  // send a real pointer click immediately, then verify the persisted pause.
  await page.locator("#detail-pause").waitFor({ state: "visible" });
  const pauseBounds = await page.locator("#detail-pause").boundingBox();
  assert.ok(pauseBounds && pauseBounds.width >= 44 && pauseBounds.height >= 44);
  await page.mouse.click(pauseBounds.x + pauseBounds.width / 2, pauseBounds.y + pauseBounds.height / 2);
  await until(
    page,
    async (id) => {
      const d = await window.territory.detail(id);
      return d.runs.at(-1)?.state === "paused";
    },
    street.id,
  );
  await page.locator("#resume").click();
  await until(
    page,
    async (id) => {
      const d = await window.territory.detail(id);
      return d.runs.at(-1)?.state === "completed" && d.units.length === 6;
    },
    street.id,
  );
  await page.locator("#select-all").click();
  assert.equal(await page.locator("[data-unit-select]:checked").count(), 6, "Tutti selezionabili prima del confronto");
  assert.equal(await page.locator("#apply").isDisabled(), true, "Nessun import senza un piano valido");
  await page.locator("#clear-selection").click();
  await page.locator('[data-operation="compare"]').click();
  const scanRun = await page.evaluate(async id => (await window.territory.detail(id)).runs.find(r => r.operation === "scan"), street.id);
  assert.equal(scanRun.settings.filters.minCivicNumber, 2);
  assert.equal(scanRun.settings.filters.maxCivicNumber, 12);
  await until(
    page,
    async (id) => {
      const d = await window.territory.detail(id);
      return (
        d.runs.at(-1)?.operation === "compare" &&
        d.runs.at(-1)?.state === "completed"
      );
    },
    street.id,
  );
  assert.equal(await page.locator("#tab-dossier").count(), 0);
  await page.locator("#tab-history").focus(); await page.keyboard.press("Home");
  assert.equal(await page.locator("#tab-units").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#detail-body").getAttribute("aria-labelledby"), "tab-units");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#detail-body")).overflowY), "visible", "Un solo scroll per la modale");
  const disclosure = page.locator(".unit").first().locator("details").first();
  await disclosure.locator(":scope > summary").click();
  await disclosure.locator(":scope > summary").focus();
  await page.evaluate(
    (id) =>
      window.territory.annotate({
        streetId: id,
        note: "Refresh mentre leggo un immobile",
        attention: false,
      }),
    street.id,
  );
  await page.waitForTimeout(450);
  assert.equal(
    await disclosure.getAttribute("open"),
    "",
    "Un aggiornamento conserva il dettaglio aperto",
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.tagName),
    "SUMMARY",
    "Il focus resta sul record letto",
  );
  await page.locator("#unit-filter").selectOption("ready");
  assert.equal(await page.locator(".unit").count(), 3);
  await page.locator("#select-all").click();
  assert.equal(
    await page.locator("#selection-count").textContent(),
    "3 immobili selezionati",
  );
  assert.ok(
    (await page.locator("#selection-plan").textContent()).includes(
      "2 nuove schede · 1 aggiornamento",
    ),
  );
  await page.locator("#unit-filter").selectOption("review");
  await page.locator('[data-disclosure="options-apply"] > summary').click();
  await page.locator("#import-policy").selectOption("existing_only");
  assert.equal(await page.locator("#apply").isDisabled(), true);
  assert.ok((await page.locator("#selection-help").textContent()).includes("deseleziona"));
  await page.locator("#import-policy").selectOption("create_update");
  await page.locator("#import-activity").selectOption("plain");
  assert.ok((await page.locator("#selection-help").textContent()).includes("attività da eseguire"));
  assert.equal(await page.locator(".unit").count(), 2);
  assert.ok(
    (await page.locator("#selection-plan").textContent()).includes(
      "3 fuori dai filtri",
    ),
    "Gli immobili nascosti selezionati sono espliciti",
  );
  await page.locator("#unit-filter").selectOption("selected");
  const deselectKey = await page
    .locator("[data-unit-select]")
    .first()
    .getAttribute("data-unit-select");
  await page.locator(`[data-unit-select="${deselectKey}"]`).click();
  assert.equal(
    await page.locator(".unit").count(),
    2,
    "Deselezionare aggiorna il filtro Solo selezionati",
  );
  await page.locator("#clear-selection").click();
  assert.equal(await page.locator("#apply").isDisabled(), true);
  await page.locator("#unit-filter").selectOption("ready");
  await page.locator("#select-all").click();
  await page.screenshot({ path: path.join(output, "import-options.png") });
  await page.locator("#apply").click();
  await until(page, async id => {
    const run = (await window.territory.detail(id)).runs.at(-1);
    return run.operation === "apply" && run.state === "completed";
  }, street.id);
  const importedRun = await page.evaluate(async id => (await window.territory.detail(id)).runs.at(-1), street.id);
  assert.equal(importedRun.handled, 3);
  assert.equal(importedRun.settings.activityMode, "plain");
  assert.equal(importedRun.settings.includeCoOwners, true);
  const ledger = JSON.parse(await readFile(path.join(profile, "territory-ledger.json"), "utf8"));
  assert.equal(Object.keys(ledger.virtualActivities).length, 3);
  await page.locator("#tab-history").click();
  assert.ok((await page.locator(".runs-list").textContent()).includes("attività da eseguire"));
  await page.locator("#tab-units").click();
  await page.locator("#unit-filter").selectOption("");
  await page.locator("#unit-search").fill("LAB");
  assert.equal(await page.locator(".unit").count(), 6);
  await page.locator("#unit-search").fill("nessun immobile corrispondente");
  await page.locator("#unit-empty-action").click();
  assert.equal(await page.locator(".unit").count(), 6);
  const edit = page.locator(".unit").first().locator("[data-edit]");
  await page
    .locator(".unit")
    .first()
    .getByText("Correggi i dati conservati", { exact: true })
    .click();
  await edit.locator('[name="address"]').fill("Correzione non ancora salvata");
  assert.equal(await page.locator("#draft-status").isVisible(), true);
  await page.locator("#tab-history").click();
  assert.equal(
    await edit.locator('[name="address"]').inputValue(),
    "Correzione non ancora salvata",
  );
  await edit.locator("[data-cancel]").click();
  assert.equal(await page.locator("#draft-status").isVisible(), false);
  await page.locator("#tab-history").click();
  await page.locator("#tab-history").focus();
  await page.keyboard.press("Home");
  assert.equal(
    await page.locator("#tab-units").getAttribute("aria-selected"),
    "true",
  );
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    await page.screenshot({ path: path.join(output, `dossier-${theme}.png`) });
  }
  for (const [width, height] of [
    [1600, 960],
    [1024, 760],
    [800, 600],
    [390, 760],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth > innerWidth ||
          document.documentElement.scrollHeight > innerHeight,
      ),
      false,
      `Nessuno scroll esterno ${width}×${height}`,
    );
    const rect = await page.locator("#detail-dialog").boundingBox();
    assert.ok(
      rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= width + 1 &&
        rect.y + rect.height <= height + 1,
    );
    await page.screenshot({ path: path.join(output, `dossier-${width}.png`) });
  }
  await page.locator("#detail-close").click();

  await page.setViewportSize({ width: 1600, height: 960 });
  const first = await page.evaluate(async id => (await window.territory.detail(id)).units[0], street.id);
  await page.evaluate(key => window.territory.correct({ key, correction: { address: "Via Luigi Castellucci N. 2 Piano 1" }, note: "Piano di prova" }), first.key);
  await page.locator("#query-manager").click(); await page.locator("#query-form").waitFor();
  await page.locator("#zone-form").evaluate(form => { form.closest("details").open = true; });
  await page.locator("#zone-name").fill("Zona test UX");
  await page.locator("#zone-street-search").fill(street.name);
  await page.locator('#zone-street-list input[value="' + street.id + '"]').check();
  await page.locator("#zone-form button").click();
  await until(page, async () => (await window.territory.queryCatalog()).zones.some(z => z.name === "Zona test UX"));
  const zone = await page.evaluate(async () => (await window.territory.queryCatalog()).zones.find(z => z.name === "Zona test UX"));
  async function chooseFilter(id, value, search) {
    await page.locator(id + " summary").click();
    if (search) await page.locator(id + ' input[type="search"]').fill(search);
    await page.locator(id + ' input[type="checkbox"][value="' + value + '"]').check();
    await page.locator(id + " summary").click();
  }
  await chooseFilter("#q-zones", zone.id);
  await chooseFilter("#q-owners", first.source.owners[0].taxCode, first.source.owners[0].taxCode);
  await chooseFilter("#q-floors", "1");
  await chooseFilter("#q-categories", "A/3");
  await page.locator("#q-preview").click();
  await until(page, () => document.querySelectorAll("[data-query-unit]").length === 1);
  await page.locator(".query-save > summary").click();
  await page.locator("#q-name").fill("Primi piani zona test"); await page.locator("#q-save").click();
  await until(page, async () => (await window.territory.queryCatalog()).saved.length === 1);
  await page.locator("[data-query-select]").focus();
  await page.keyboard.press("Space");
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.dataset.querySelect)), true, "La selezione conserva il focus da tastiera");
  assert.equal(await page.locator("[data-query-select]:checked").count(), 1, "Selezione da tastiera");
  await page.locator("[data-query-unit] h3").click();
  assert.equal(await page.locator("[data-query-select]:checked").count(), 0);
  await page.locator("[data-query-unit] .owner-name strong").first().click();
  assert.equal(await page.locator("[data-query-select]:checked").count(), 1, "Clic sulla card seleziona l’immobile");
  assert.equal(await page.locator("#q-apply").isDisabled(), true);
  await page.locator("#q-compare").click();
  await until(page, async () => !(await window.territory.snapshot()).activeRun && !(document.querySelector("#q-apply")?.disabled));
  assert.equal(await page.locator(".query-card .unit-owners strong").count(), first.source.owners.length);
  await chooseFilter("#q-localities", "Bitonto");
  assert.equal(await page.locator("#q-compare").isDisabled(), true, "Filtri cambiati richiedono nuovi risultati");
  assert.equal(await page.locator("#q-apply").isDisabled(), true);
  await page.locator("#q-localities summary").click();
  await page.locator("#q-localities [data-remove]").click();
  await page.locator("#q-localities summary").click();
  assert.equal(await page.locator("#q-apply").isDisabled(), false, "Ripristinare i filtri riabilita il risultato corrente");
  await page.locator("#q-owners summary").click();
  await page.locator('#q-owners input[type="search"]').fill("Nessun proprietario con questo nome");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#q-owners details").getAttribute("open"), "", "Invio nella ricerca non avvia una query");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#q-owners details").getAttribute("open"), null);
  assert.equal(await page.locator("#q-owners .filter-chip").count(), 1, "La ricerca non cancella la selezione");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.screenshot({ path: path.join(output, "query-" + theme + ".png") });
  }
  await page.screenshot({ path: path.join(output, "query-combined.png") });
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 760 });
    assert.equal(await page.evaluate(() => document.querySelector("#detail-dialog").scrollWidth > document.querySelector("#detail-dialog").clientWidth + 1), false, "Query senza overflow orizzontale");
    await page.screenshot({ path: path.join(output, "query-" + width + ".png") });
  }
  await page.locator("#detail-close").click(); await page.locator("#query-manager").click();
  assert.equal(await page.locator("#q-saved option").count(), 2, "Query salvata disponibile alla riapertura");
  assert.equal(await page.locator("#q-zones .picker-option").count(), 1, "Zona conservata");
  const missingId = await page.evaluate(() => window.territory.saveQuery({ name: "Proprietario non più presente", query: { ownerTaxCodes: ["BNCLGU80A01A662C"] } }));
  await page.locator("#detail-close").click(); await page.locator("#query-manager").click();
  await page.locator("#q-saved").selectOption(missingId);
  await until(page, () => document.querySelector(".query-results-heading h3")?.textContent === "0 immobili trovati");
  assert.ok((await page.locator("#q-owners .picker-value").textContent()).includes("Non più in archivio"), "Un criterio salvato mancante non scompare o diventa Tutti");
  assert.equal(await page.locator("#q-apply").isDisabled(), true);
  await page.locator("#q-reset").click();
  await until(page, () => document.querySelectorAll("[data-query-unit]").length === 6);

  await page.locator("#detail-close").click();
  // Two co-owners are readable without opening any disclosure.
  await page.setViewportSize({ width: 1600, height: 960 });
  const owners = [
    { ...first.source.owners[0], sharePercentage: 50 },
    { ...first.source.owners[0], fullName: "Verdi Luisa", taxCode: "VRDLSU80A01A662B", sharePercentage: 50 },
  ];
  await page.evaluate(({ key, owners }) => window.territory.correct({ key, correction: { owners }, note: "Due intestatari di prova" }), { key: first.key, owners });
  await openStreet(page, street);
  const property = page.locator('[data-unit="' + first.key + '"]');
  await property.locator(".unit-owners").waitFor();
  assert.equal(await property.locator(".owner-name strong").count(), 2);
  assert.equal(await property.locator(".owner-share").first().textContent(), "50%");
  assert.equal(await property.locator(".unit-comparison .status").textContent(), "Confronto da eseguire");
  await property.locator('[data-disclosure$=":record"] > summary').click();
  await property.locator('[data-disclosure$=":lifecycle"] > summary').click();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await property.scrollIntoViewIfNeeded();
    await page.evaluate(() => { const card = document.querySelector("[data-unit]"); const dialog = document.querySelector("#detail-dialog"); dialog.scrollTop += card.getBoundingClientRect().top - dialog.getBoundingClientRect().top - 84; });
    await page.screenshot({ path: path.join(output, "owners-details-" + theme + ".png") });
  }
  await page.setViewportSize({ width: 390, height: 760 });
  assert.equal(await page.evaluate(() => document.querySelector("#detail-dialog").scrollWidth > document.querySelector("#detail-dialog").clientWidth + 1), false, "Intestatari e storico senza overflow");
  await page.screenshot({ path: path.join(output, "owners-details-mobile.png") });
  await page.locator("#detail-close").click();
  await page.locator("#search").fill("nessuna via corrispondente");
  await page.locator("#search-empty").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#street-search-menu").isVisible(), false);
  await page.locator("#clear-search").click();
  assert.equal(await page.locator("#search").inputValue(), "");
  assert.equal(await page.locator("#clear-search").isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), "search");
  await page.screenshot({ path: path.join(output, "map-mobile.png") });
  assert.deepEqual(errors, []);
  fonts = await page.evaluate(() =>
    [...document.fonts].map((f) => ({ family: f.family, status: f.status })),
  );
  assert.ok(
    fonts.some((f) => f.family === "IBM Plex Mono" && f.status === "loaded"),
    "Font dei dati catastali distribuito e caricato",
  );
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        ok: true,
        fonts,
        keyboard: true,
        readingContext: true,
        filteredSelection: true,
        dirtyProtection: true,
        pauseInModal: true,
        operationOptionsPersisted: true,
        existingOnlySelectionGuard: true, combinedQueries: true, streetZones: true, selectBeforeComparison: true,
        importWithPendingActivities: true,
        responsive: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "UX V2 verificata: font, tastiera, lettura, selezione filtrata, modifiche protette, pausa e layout.",
  );
} finally {
  if (app) await app.close();
}
