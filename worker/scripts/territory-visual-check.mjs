import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(workerRoot, "..", ".runtime", "territory-ui-check");
await mkdir(output, { recursive: true });
const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "territory-visual-"));
const env = { ...process.env, TERRITORY_LAB_DATA_DIR: dataDirectory, TERRITORY_LAB_VISUAL_CHECK: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
let application;
async function launch() {
  application = await electron.launch({ args: [path.join(workerRoot, "dist-territory/territory/main.js")], env });
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", e => errors.push(e.message));
  await page.waitForFunction(() => Boolean(window.territory && document.querySelector(".street-row")), null, { timeout: 15000 });
  return page;
}
async function until(page, predicate, value) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await page.evaluate(predicate, value)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("Il laboratorio non ha raggiunto lo stato atteso entro 20 secondi");
}
async function idle(page, operation) {
  await until(page, async op => { const s = await window.territory.snapshot(); return !s.activeRun && s.streets.some(street => street.count === 6); }, operation);
}
async function mapPoints(page, geometry) {
  await page.waitForTimeout(400); // Leaflet finishes its fitBounds transition.
  return page.evaluate(geometry => {
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    const positions = lines.flat().map(([lon, lat]) => L.latLng(lat, lon));
    const bounds = L.latLngBounds(positions), rect = document.querySelector('#map').getBoundingClientRect();
    const nw = L.CRS.EPSG3857.latLngToPoint(bounds.getNorthWest(), 0), se = L.CRS.EPSG3857.latLngToPoint(bounds.getSouthEast(), 0);
    const zoom = Math.min(17, Math.floor(Math.log2(Math.min((rect.width - 90) / Math.abs(se.x - nw.x), (rect.height - 90) / Math.abs(se.y - nw.y)))));
    const scale = 2 ** zoom, center = nw.add(se).divideBy(2).multiplyBy(scale);
    return lines.flatMap(line => line.slice(1).map(([lon, lat], i) => {
      const point = L.CRS.EPSG3857.latLngToPoint(L.latLng((lat + line[i][1]) / 2, (lon + line[i][0]) / 2), zoom);
      return { x: rect.x + rect.width / 2 + point.x - center.x, y: rect.y + rect.height / 2 + point.y - center.y };
    })).filter(p => p.x > rect.x + 50 && p.x < rect.right - 50 && p.y > rect.y + 60 && p.y < rect.bottom - 60).slice(0, 30);
  }, geometry);
}
try {
  let page = await launch();
  const snapshot = await page.evaluate(() => window.territory.snapshot());
  assert.equal(snapshot.origin, "simulation");
  assert.equal(snapshot.network.official, 1118);
  assert.ok(snapshot.network.paths > 500);
  assert.equal(snapshot.streets.every(s => s.count === 0 && s.registeredAt), true, 'Tutte le schede esistono prima di acquisizioni e import');
  assert.equal(await page.locator('#detail-dialog').isVisible(), false, 'La mappa parte senza pannello o modale aperta');
  // Observe real Leaflet paths without adding a debug interface to the product.
  await page.evaluate(() => {
    window.checkedPaths = new Set();
    const original = L.Path.prototype.setStyle;
    L.Path.prototype.setStyle = function (style) { window.checkedPaths.add(this); return original.call(this, style); };
  });
  await page.locator('#tools').evaluate(el => { el.open = true; });
  await page.locator('#refresh').click();
  await page.waitForFunction(() => window.checkedPaths.size > 500);
  const widePaths = () => page.evaluate(() => [...window.checkedPaths].filter(p => p._map && p.options.weight > 2).length);
  assert.equal(await widePaths(), 0, 'Ogni via parte sottile, anche se selezionata');
  const candidates = await page.evaluate(streets => {
    const map = [...window.checkedPaths].find(p => p._map)._map;
    const rect = document.querySelector('#map').getBoundingClientRect();
    return streets.filter(s => s.geometry).flatMap(s => {
      const line = s.geometry.type === 'LineString' ? s.geometry.coordinates : s.geometry.coordinates[0];
      const a = line[0], b = line[1]; if (!b) return [];
      const point = map.latLngToContainerPoint([(a[1] + b[1]) / 2, (a[0] + b[0]) / 2]);
      return point.x > 80 && point.x < rect.width - 330 && point.y > 100 && point.y < rect.height - 100 ? [{ id: s.id, x: rect.x + point.x, y: rect.y + point.y }] : [];
    });
  }, snapshot.streets);
  const targets = [];
  for (const candidate of candidates) {
    // Keep both targets outside each other's popup, which correctly captures the pointer.
    if (targets.some(t => Math.abs(t.x - candidate.x) < 340)) continue;
    await page.mouse.move(candidate.x, candidate.y); await page.waitForTimeout(60);
    const id = await page.locator('#hover [data-open]').getAttribute('data-open').catch(() => null);
    if (id === candidate.id) targets.push(candidate);
    if (targets.length === 2) break;
    await page.mouse.move(10, 130); await page.waitForTimeout(300);
  }
  assert.equal(targets.length, 2, 'Due vie distinte raggiungibili con il puntatore');
  for (const target of [...targets, ...targets].reverse()) {
    await page.mouse.move(target.x, target.y); await page.waitForTimeout(60);
    assert.equal(await page.locator('#hover [data-open]').getAttribute('data-open'), target.id);
    assert.equal(await widePaths(), 1, 'Il passaggio rapido lascia larga soltanto la via sotto il cursore');
  }
  await page.mouse.move(10, 130);
  assert.equal(await widePaths(), 0, 'Uscendo dalla mappa tutte le vie tornano sottili subito');
  await page.waitForTimeout(350);
  assert.equal(await page.locator('#hover').isVisible(), false, 'Il popup scompare dopo l’uscita');
  await page.screenshot({ path: path.join(output, '00-map-full.png') });
  await page.locator('#tools').evaluate(el => { el.open = true; });
  await page.locator('#network-setup').click();
  await page.getByRole('heading', { name: 'Rete delle vie', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, '00-network-setup.png') });
  await page.locator('#detail-close').click();
  const rawStreet = snapshot.streets.find(s => {
    if (s.catalogKind !== 'network' || s.needsReview || s.locality !== 'Bitonto') return false;
    const points = s.geometry.type === 'LineString' ? s.geometry.coordinates : s.geometry.coordinates.flat();
    return Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])) < .002 && Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])) < .002;
  });
  assert.ok(rawStreet, 'La rete iniziale include un tracciato mai acquisito');
  const emptyOfficial = snapshot.streets.find(s => s.catalogKind !== 'network' && !s.needsReview && !s.geometry);
  await page.locator('#catalog-filters').evaluate(el => { el.open = true; });
  await page.locator('#catalog-kind').selectOption('network');
  await page.locator('#search').fill(rawStreet.name);
  await page.locator(`[data-street="${rawStreet.id}"]`).click();
  assert.equal(await page.locator('#detail-dialog').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#detail-dialog').isVisible(), false);
  const networkPoints = await mapPoints(page, rawStreet.geometry);
  let networkPointer = null;
  for (const point of networkPoints) {
    await page.mouse.move(point.x, point.y);
    if (await page.evaluate(id => !document.querySelector('#hover').hidden && document.querySelector('#hover [data-open]')?.dataset.open === id, rawStreet.id)) { networkPointer = point; break; }
  }
  assert.ok(networkPointer, 'Hover disponibile sul tracciato della rete mai acquisito');
  await page.screenshot({ path: path.join(output, '00-network-hover.png') });
  await page.mouse.click(networkPointer.x, networkPointer.y);
  assert.equal(await page.locator('#detail-dialog').isVisible(), false, 'Il clic sulla mappa apre il riepilogo, non la scheda');
  await page.mouse.move(310, 140);
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#hover').isVisible(), true, 'Il riepilogo selezionato resta disponibile');
  assert.equal(await widePaths(), 0, 'Il riepilogo fissato non mantiene larga la via');
  await page.locator('#hover [data-open]').click();
  await page.getByRole('heading', { name: rawStreet.name, exact: true }).waitFor();
  assert.equal((await page.evaluate(id => window.territory.detail(id), rawStreet.id)).units.length, 0);
  await page.locator('#street-note').fill('Dossier iniziale, prima di qualsiasi analisi');
  await page.locator('#detail-close').click();
  assert.equal(await page.locator('#detail-dialog').isVisible(), true, 'Chiudi conserva la modifica aperta');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#detail-dialog').isVisible(), true, 'Escape conserva la modifica aperta');
  await page.locator('#detail-refresh').click();
  assert.equal(await page.locator('#street-note').inputValue(), 'Dossier iniziale, prima di qualsiasi analisi');
  await page.getByRole('button', { name: 'Salva annotazioni', exact: true }).click();
  await until(page, async id => (await window.territory.detail(id)).memory.note.includes('Dossier iniziale'), rawStreet.id);
  await page.locator('[data-disclosure="network-link"]>summary').click();
  await page.locator('#network-official').fill(`${emptyOfficial.name} · Codvia ${emptyOfficial.id}`);
  await page.getByRole('button', { name: 'Conferma associazione', exact: true }).click();
  await until(page, async id => Boolean((await window.territory.detail(id)).street.geometry), emptyOfficial.id);
  await page.getByText('Annotazioni precedenti sul tracciato', { exact: true }).click();
  await page.locator(`[data-street="${emptyOfficial.id}"]`).waitFor();
  assert.equal(await page.locator(`[data-street="${rawStreet.id}"]`).count(), 0, 'Il tracciato associato apre una sola scheda');
  assert.ok((await page.locator('#detail-body').textContent()).includes('Dossier iniziale, prima di qualsiasi analisi'));
  assert.equal((await page.evaluate(() => window.territory.snapshot())).activeRun, null);
  await page.screenshot({ path: path.join(output, '00-network-linked.png') });
  await page.locator('#detail-close').click();
  await page.locator('#catalog-filters').evaluate(el => { el.open = true; });
  await page.locator('#catalog-kind').selectOption('');
  const street = snapshot.streets.find(s => s.geometry && s.name.includes("CASTELLUCCI")) ?? snapshot.streets.find(s => s.geometry);
  await page.locator("#search").fill(street.name);
  await page.locator(`[data-street="${street.id}"]`).click();
  await page.locator(".detail-header h2").waitFor();
  await page.screenshot({ path: path.join(output, "01-map.png") });
  await page.locator('#detail-close').click();
  assert.equal(await widePaths(), 0, 'Chiudere la scheda e ripristinare il focus non lascia vie larghe');
  // Actual pointer events on the map, including the quick flag in the hover panel.
  let hovered = false;
  for (const point of await mapPoints(page, street.geometry)) {
    await page.mouse.move(point.x, point.y);
    hovered = await page.evaluate(id => !document.querySelector('#hover').hidden && document.querySelector('#hover [data-open]')?.dataset.open === id, street.id);
    if (hovered) break;
  }
  assert.ok(hovered, "Il passaggio del mouse deve aprire il riepilogo della via");
  await page.screenshot({ path: path.join(output, "02-hover.png") });
  await page.locator("#hover [data-attention]").click();
  await until(page, async id => (await window.territory.detail(id)).memory.attention, street.id);
  await page.locator('#hover [data-open]').click();
  await page.locator("#street-note").fill("Annotazione salvata durante il collaudo");
  await page.getByRole("button", { name: "Salva annotazioni", exact: true }).click();
  await page.getByRole("button", { name: "Acquisisci via", exact: true }).click();
  await idle(page, "scan");
  await page.getByRole("button", { name: "Confronta gestionale", exact: true }).click();
  await until(page, async id => { const d = await window.territory.detail(id); return d.runs.at(-1)?.operation === "compare" && d.runs.at(-1)?.state === "completed"; }, street.id);
  await page.getByRole("tab", { name: "Immobili 6", exact: true }).click();
  await page.getByRole("button", { name: "Seleziona pronti", exact: true }).click();
  await page.getByRole("button", { name: "Prova piano (3)", exact: true }).click();
  await until(page, async id => { const d = await window.territory.detail(id); return d.runs.at(-1)?.operation === "apply" && d.runs.at(-1)?.state !== "running"; }, street.id);
  const detail = await page.evaluate(id => window.territory.detail(id), street.id);
  assert.equal(detail.runs.at(-1).state, "completed", detail.runs.at(-1).error);
  assert.equal(detail.units.filter(u => u.assessment.kind === "synced").length, 3);
  assert.equal(detail.street.progress.percent, 50);
  assert.equal(detail.street.progress.tone, 'recent');
  await page.waitForFunction(() => document.querySelector('.detail-header .import-summary')?.textContent.includes('50% · 3/6'));
  await page.screenshot({ path: path.join(output, "03-unified-process.png") });
  await page.locator('#detail-close').click();
  await page.locator('.street-percent-label').filter({ hasText: '50%' }).first().waitFor();
  await page.screenshot({ path: path.join(output, '03-map-import-progress.png') });
  await page.locator(`[data-street="${street.id}"]`).click();
  await page.getByRole('tab', { name: 'Immobili 6', exact: true }).click();
  const units = page.locator(".unit");
  await units.nth(0).getByText("Correggi i dati conservati", { exact: true }).click();
  await units.nth(1).getByText("Correggi i dati conservati", { exact: true }).click();
  const firstEdit = units.nth(0).locator("form[data-edit]");
  const secondEdit = units.nth(1).locator("form[data-edit]");
  await firstEdit.locator('[name="address"]').fill(`${street.name} 20`);
  await secondEdit.locator('[name="address"]').fill(`${street.name} 22`);
  await firstEdit.getByRole("button", { name: "Salva correzioni", exact: true }).click();
  await until(page, async id => (await window.territory.detail(id)).units[0].source.fullAddress.endsWith(" 20"), street.id);
  assert.equal(await secondEdit.locator('[name="address"]').inputValue(), `${street.name} 22`, "Salvare una scheda non perde le modifiche in un'altra");
  await page.getByRole("button", { name: "Seleziona pronti", exact: true }).click();
  assert.equal(await secondEdit.locator('[name="address"]').inputValue(), `${street.name} 22`);
  await secondEdit.getByRole("button", { name: "Salva correzioni", exact: true }).click();
  await until(page, async id => (await window.territory.detail(id)).units[1].source.fullAddress.endsWith(" 22"), street.id);
  await page.getByRole("tab", { name: "Storico", exact: true }).click();
  await page.screenshot({ path: path.join(output, "04-history.png") });
  for (const width of [1024, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: path.join(output, `05-responsive-${width}.png`) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `Nessun overflow orizzontale a ${width}px`);
    const modalBounds = await page.locator('#detail-dialog').boundingBox();
    assert.ok(modalBounds.x >= 0 && modalBounds.x + modalBounds.width <= width + 1 && modalBounds.y >= 0 && modalBounds.y + modalBounds.height <= 901, `Modale nel viewport a ${width}px`);
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#detail-dialog').isVisible(), false);
  await page.screenshot({ path: path.join(output, '06-map-mobile.png') });
  await application.close(); application = null;
  page = await launch();
  const restored = await page.evaluate(id => window.territory.detail(id), street.id);
  const restoredLink = await page.evaluate(id => window.territory.detail(id), rawStreet.id);
  assert.equal(restoredLink.street.id, emptyOfficial.id);
  assert.equal(restoredLink.linkedNotes[0].note, 'Dossier iniziale, prima di qualsiasi analisi');
  assert.equal(restored.memory.note, "Annotazione salvata durante il collaudo");
  assert.equal(restored.units.length, 6);
  assert.equal(restored.units.filter(u => u.assessment?.kind === "synced").length, 1);
  assert.equal(restored.units[0].source.fullAddress, `${street.name} 20`);
  assert.equal(restored.units[1].source.fullAddress, `${street.name} 22`);
  assert.equal(restored.street.progress.percent, 50, 'Le correzioni non cancellano le prove degli import');
  assert.equal(errors.length, 0, errors.join("\n"));
  const ledger = JSON.parse(await readFile(path.join(dataDirectory, "territory-ledger.json"), "utf8"));
  assert.equal(Object.keys(ledger.virtualPeople).length, 1);
  await application.close(); application = null;
  for (const [days, tone] of [[35, 'aging'], [95, 'stale']]) {
    const shifted = structuredClone(ledger), shift = value => value ? new Date(Date.parse(value) - days * 86400000).toISOString() : value;
    for (const run of shifted.runs) { run.startedAt = shift(run.startedAt); run.endedAt = shift(run.endedAt); for (const proof of Object.values(run.imports || {})) proof.at = shift(proof.at); }
    for (const unit of Object.values(shifted.units)) { unit.importedAt = shift(unit.importedAt); for (const observation of unit.observations) observation.at = shift(observation.at); }
    await writeFile(path.join(dataDirectory, 'territory-ledger.json'), JSON.stringify(shifted));
    page = await launch();
    const aged = await page.evaluate(id => window.territory.detail(id), street.id);
    assert.equal(aged.street.progress.tone, tone); assert.equal(aged.street.progress.percent, 50);
    await page.locator('#search').fill(street.name); await page.locator(`[data-street="${street.id}"]`).click();
    assert.equal(await page.locator('.detail-header .import-summary').getAttribute('data-import-tone'), tone);
    await page.locator('#detail-close').click();
    await page.locator('.street-percent-label').filter({ hasText: '50%' }).first().waitFor();
    await page.screenshot({ path: path.join(output, `07-map-${tone}.png`) });
    await application.close(); application = null;
  }
  await writeFile(path.join(output, "result.json"), JSON.stringify({ ok: true, streets: snapshot.streets.length, geometry: snapshot.streets.filter(s => s.geometry).length, setupBeforeAcquisition: true, networkAssociationPersisted: true, rapidHoverReset: true, pinnedPreviewThin: true, modalCloseThin: true, units: restored.units.length, applied: 3, manualCorrections: 2, persisted: true, errors, dataDirectory }, null, 2));
  console.log(`Collaudo Electron superato. Schermate: ${output}`);
} catch (error) {
  if (application) {
    const page = await application.firstWindow();
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    console.error(await page.evaluate(() => ({ feedback: document.querySelector("#feedback")?.textContent, errors: [] })).catch(() => ({})));
  }
  throw error;
} finally { if (application) await application.close(); }
