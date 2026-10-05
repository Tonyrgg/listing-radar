import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
  await page.locator(".street-row").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  let fonts = await page.evaluate(() =>
    [...document.fonts].map((f) => ({ family: f.family, status: f.status })),
  );
  assert.ok(
    fonts.some((f) => f.family === "Instrument Sans" && f.status === "loaded"),
    "Font dell’interfaccia distribuito e caricato",
  );
  await page.locator("#more-streets").click();
  assert.equal(
    await page.locator(".street-row").count(),
    400,
    "L’intero catalogo è sfogliabile",
  );
  const snapshot = await page.evaluate(() => window.territory.snapshot());
  const street = snapshot.streets.find(
    (s) => s.geometry && s.name.includes("CASTELLUCCI"),
  );
  await page.locator("#search").fill(street.name);
  await page.locator(`[data-street="${street.id}"]`).focus();
  await page.keyboard.press("Enter");
  await page.locator("#tab-dossier").waitFor();
  await page.locator('[data-operation="scan"]').click();
  await page.locator("#detail-pause").click();
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
  await page.locator('[data-operation="compare"]').click();
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
  await page.locator("#open-units").waitFor();
  assert.ok(
    (await page.locator(".work-card").textContent()).includes(
      "Controlla gli esiti",
    ),
    "I pronti conducono al controllo anche con una ricerca incompleta",
  );
  await page.locator("#tab-dossier").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.locator("#tab-units").getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "tab-units",
  );
  assert.equal(
    await page.locator("#detail-body").getAttribute("aria-labelledby"),
    "tab-units",
  );
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
    await page.locator("#tab-dossier").getAttribute("aria-selected"),
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
  await page.locator("#toggle-list").click();
  await page.locator("#search").fill("nessuna via corrispondente");
  await page.locator("#close-list").click();
  assert.equal(await page.locator("#catalog").isVisible(), false);
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "toggle-list",
  );
  await page.locator("#toggle-list").click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#catalog").isVisible(), false);
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
