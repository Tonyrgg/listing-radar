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
  const widePaths = () => page.evaluate(() => [...window.checkedPaths].filter(p => p._map && p.options.weight > 4).length);
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
    // Keep both targets outside each other's click-opened popup.
    if (targets.some(t => Math.abs(t.x - candidate.x) < 340)) continue;
    await page.mouse.move(candidate.x, candidate.y); await page.waitForTimeout(60);
    assert.equal(await page.locator('#hover').isVisible(), false, 'Hover does not open a popup');
    if (await widePaths() !== 1) continue;
    await page.mouse.click(candidate.x, candidate.y);
    const id = await page.evaluate(() => !document.querySelector('#hover').hidden && document.querySelector('#hover [data-open]')?.dataset.open);
    if (id === candidate.id) targets.push(candidate);
    if (await page.locator('#hover').isVisible()) await page.locator('#hover .preview-close').click();
    if (targets.length === 2) break;
    await page.mouse.move(10, 130);
  }
  assert.equal(targets.length, 2, 'Two distinct streets reachable with the pointer');
  for (const target of [...targets, ...targets].reverse()) {
    await page.mouse.move(target.x, target.y); await page.waitForTimeout(60);
    assert.equal(await page.locator('#hover').isVisible(), false, 'Rapid hover never opens a popup');
    assert.equal(await widePaths(), 1, 'Only the hovered street is wide');
  }
  await page.mouse.click(targets[0].x, targets[0].y);
  assert.equal(await page.locator('#hover [data-open]').getAttribute('data-open'), targets[0].id, 'Click opens the street popup');
  await page.mouse.move(targets[1].x, targets[1].y); await page.waitForTimeout(60);
  assert.equal(await page.locator('#hover [data-open]').getAttribute('data-open'), targets[0].id, 'Hover elsewhere does not replace the selected popup');
  assert.equal(await widePaths(), 1);
  await page.mouse.click(targets[1].x, targets[1].y);
  assert.equal(await page.locator('#hover [data-open]').getAttribute('data-open'), targets[1].id, 'Another click changes the popup street');
  await page.locator('#hover .preview-close').click();
  await page.mouse.move(10, 130);
  assert.equal(await widePaths(), 0, 'Leaving the map clears all wide strokes');
  assert.equal(await page.locator('#hover').isVisible(), false, 'A closed popup stays closed');
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
    assert.equal(await page.locator('#hover').isVisible(), false, 'Hover does not open a popup');
    await page.mouse.click(point.x, point.y);
    if (await page.evaluate(id => !document.querySelector('#hover').hidden && document.querySelector('#hover [data-open]')?.dataset.open === id, rawStreet.id)) { networkPointer = point; break; }
    if (await page.locator('#hover').isVisible()) await page.locator('#hover .preview-close').click();
  }
  assert.ok(networkPointer, 'Popup al clic disponibile sul tracciato della rete mai acquisito');
  await page.screenshot({ path: path.join(output, '00-network-click.png') });
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
  // Actual pointer events on the map, including the quick flag in the clicked popup.
  let hovered = false;
  for (const point of await mapPoints(page, street.geometry)) {
    await page.mouse.move(point.x, point.y);
    assert.equal(await page.locator('#hover').isVisible(), false, 'Hover does not open a popup');
    await page.mouse.click(point.x, point.y);
    hovered = await page.evaluate(id => !document.querySelector('#hover').hidden && document.querySelector('#hover [data-open]')?.dataset.open === id, street.id);
    if (hovered) break;
    if (await page.locator('#hover').isVisible()) await page.locator('#hover .preview-close').click();
  }
  assert.ok(hovered, "Il clic deve aprire il riepilogo della via");
  await page.screenshot({ path: path.join(output, "02-click-popup.png") });
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
  // Mixed dates across acquisitions, entirely fictional and in the temporary ledger.
  const mixed = structuredClone(ledger), mixedKeys = [], currentTime = Date.now();
  const ago = days => new Date(currentTime - days * 86400000).toISOString();
  const prototype = Object.values(mixed.units).find(u => u.streetIds.includes(street.id));
  for (const [key, unit] of Object.entries(mixed.units)) if (unit.streetIds.includes(street.id)) delete mixed.units[key];
  for (let i = 0; i < 100; i++) {
    const unit = structuredClone(prototype), source = structuredClone(unit.observations.at(-1).source);
    source.cadastral.subaltern = String(i + 1000); source.sourcePropertyId = `mixed:${i}`; source.jobId = 'mixed-new'; source.category = i < 70 ? 'A/3' : 'C/6';
    unit.key = ['BITONTO', source.cadastral.urbanSection || '', source.cadastral.sheet, source.cadastral.parcel, source.cadastral.subaltern].join('|');
    unit.observations = [{ at: ago(5), runId: 'mixed-new', streetId: street.id, source, origin: 'simulation' }];
    unit.importedAt = null; unit.crmId = null; unit.assessment = null;
    mixed.units[unit.key] = unit; mixedKeys.push(unit.key);
  }
  mixed.runs = mixed.runs.filter(r => r.streetId !== street.id);
  const scanRecord = { id: 'mixed-old', streetId: street.id, origin: 'simulation', operation: 'scan', state: 'completed', startedAt: ago(150), endedAt: ago(150), itemKeys: mixedKeys, handled: 100, total: 100, error: null };
  mixed.runs.push(scanRecord, { ...scanRecord, id: 'mixed-new', startedAt: ago(5), endedAt: ago(5) });
  for (const [id, keys, days, cohort] of [['mixed-old-apply', mixedKeys.slice(33, 50), 120, 'mixed-old'], ['mixed-new-apply', mixedKeys.slice(0, 33), 1, 'mixed-new']]) mixed.runs.push({ ...scanRecord, id, operation: 'apply', acquisitionRunId: cohort, startedAt: ago(days), endedAt: ago(days), itemKeys: keys, handled: keys.length, imports: Object.fromEntries(keys.map(key => [key, { crmId: `mixed:${key}`, at: ago(days) }])) });
  await writeFile(path.join(dataDirectory, 'territory-ledger.json'), JSON.stringify(mixed));
  page = await launch();
  const distribution = (await page.evaluate(id => window.territory.detail(id), street.id)).street.progress.distribution;
  assert.deepEqual([distribution.recent, distribution.stale, distribution.never, distribution.percent], [33, 17, 50, 50]);
  await page.evaluate(() => {
    window.checkedPaths = new Set();
    const original = L.Path.prototype.setStyle;
    L.Path.prototype.setStyle = function (style) { window.checkedPaths.add(this); return original.call(this, style); };
  });
  await page.locator('#search').fill(street.name); await page.locator(`[data-street="${street.id}"]`).click();
  const summary = page.locator('.detail-header .import-summary');
  await summary.filter({ hasText: '50% · 50/100' }).waitFor();
  assert.ok((await summary.textContent()).includes('33% · 33'));
  assert.ok((await summary.textContent()).includes('17% · 17'));
  assert.ok((await summary.textContent()).includes('50% · 50'));
  await page.locator('#detail-close').click(); await page.mouse.move(10, 130);
  await page.locator('#tools').evaluate(el => { el.open = true; }); await page.locator('#refresh').click();
  await page.waitForTimeout(500);
  const verifyPixels = async () => {
    const samples = await page.evaluate(() => {
      const layer = [...window.checkedPaths].find(p => p._map && new Set((p.options.importGradient || []).map(s => s.color)).size === 3);
      const ctx = layer._renderer._ctx, bounds = layer._renderer._bounds, scale = L.Browser.retina ? 2 : 1;
      return [.15, .4, .75].map(fraction => {
        const distance = fraction * layer._importMetrics.total;
        const edge = layer._importMetrics.edges.find(e => e.start + e.length >= distance);
        const offset = (distance - edge.start) / edge.length;
        const point = { x: edge.a.x + (edge.b.x - edge.a.x) * offset, y: edge.a.y + (edge.b.y - edge.a.y) * offset };
        const pixel = [...ctx.getImageData(Math.round((point.x - bounds.min.x) * scale), Math.round((point.y - bounds.min.y) * scale), 1, 1).data];
        const token = fraction < .33 ? '--lr-ok' : fraction < .5 ? '--lr-danger' : '--lr-data-muted';
        const color = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
        return { pixel, color, weight: layer.options.weight };
      });
    });
    for (const { pixel, color, weight } of samples) {
      const expected = color.slice(1).match(/.{2}/g).map(x => parseInt(x, 16));
      assert.ok(expected.every((c, i) => Math.abs(c - pixel[i]) < 4) && pixel[3] > 180, `Colore reale del canvas ${pixel} corrisponde al token ${color}`);
      assert.equal(weight, 4, 'La via è visibile a 4 px senza hover');
    }
  };
  await verifyPixels();
  await page.screenshot({ path: path.join(output, '08-map-gradient-33-17-50.png') });
  await page.evaluate(() => [...window.checkedPaths].find(p => p._map)._map.panBy([40, 20], { animate: false }));
  await page.waitForTimeout(100); await verifyPixels();
  await page.evaluate(() => [...window.checkedPaths].find(p => p._map)._map.setZoom(16, { animate: false }));
  await page.waitForTimeout(100); await verifyPixels();
  await application.close(); application = null;
  await writeFile(path.join(output, "result.json"), JSON.stringify({ ok: true, streets: snapshot.streets.length, geometry: snapshot.streets.filter(s => s.geometry).length, setupBeforeAcquisition: true, networkAssociationPersisted: true, rapidHoverReset: true, popupOnlyOnClick: true, selectedPopupSurvivesHover: true, pinnedPreviewThin: true, modalCloseThin: true, mixedGradient: [33, 17, 50], canvasPixelsAndPanZoom: true, units: restored.units.length, applied: 3, manualCorrections: 2, persisted: true, errors, dataDirectory }, null, 2));
  console.log(`Collaudo Electron superato. Schermate: ${output}`);
} catch (error) {
  if (application) {
    const page = await application.firstWindow();
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    console.error(await page.evaluate(() => ({ feedback: document.querySelector("#feedback")?.textContent, errors: [] })).catch(() => ({})));
  }
  throw error;
} finally { if (application) await application.close(); }
