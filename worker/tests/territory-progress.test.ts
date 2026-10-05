import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importAge, importProgress } from "../src/territory/progress.js";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { SimulationProvider, simulationSource, type ScanSink } from "../src/territory/providers.js";
import { unitKey, type TerritoryState, type Street, type Run } from "../src/territory/model.js";

const now = Date.parse("2026-10-05T12:00:00Z"), day = 86400000;
const ago = (days: number) => new Date(now - days * day).toISOString();
const street: Street = { id: "20", name: "Via della prova", sisterName: "VIA DELLA PROVA", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
function fixture(count = 10) {
  const state: TerritoryState = { version: 1, streets: [street], memories: {}, units: {}, runs: [], events: [], checkpoints: {}, virtualCrm: {}, virtualPeople: {} };
  const keys = Array.from({ length: count }, (_, index) => {
    const source = simulationSource(street, index + 1, "scan"); const key = unitKey(source);
    state.units[key] = { key, streetIds: [street.id], observations: [{ at: ago(6), runId: "scan", streetId: street.id, source, origin: "simulation" }], corrections: {}, note: "", assessment: null, importedAt: null, crmId: null }; return key;
  });
  const scan: Run = { id: "scan", streetId: street.id, operation: "scan", origin: "simulation", state: "completed", startedAt: ago(6), endedAt: ago(6), total: null, handled: count, itemKeys: keys, error: null };
  state.runs.push(scan);
  return { state, keys, scan };
}
function apply(state: TerritoryState, keys: string[], days = 5, cohort = "scan") {
  state.runs.push({ id: `apply:${state.runs.length}`, streetId: street.id, operation: "apply", origin: "simulation", state: "completed", startedAt: ago(days), endedAt: ago(days), total: keys.length, handled: keys.length, itemKeys: keys, error: null, acquisitionRunId: cohort, imports: Object.fromEntries(keys.map(key => [key, { at: ago(days), crmId: `crm:${key}` }])) });
}
describe("Età e percentuale import nell'ultima acquisizione", () => {
  it("rispetta 30/31 e 90/91 giorni, senza colorare date mancanti o future", () => {
    for (const [days, tone] of [[0, "recent"], [30, "recent"], [31, "aging"], [59, "aging"], [60, "aging"], [90, "aging"], [91, "stale"]] as const) expect(importAge(ago(days), now)).toEqual({ ageDays: days, tone });
    for (const date of [null, "non-data", ago(-1)]) expect(importAge(date, now)).toEqual({ ageDays: null, tone: "never" });
  });
  it("3 import verificati su 10, cinque giorni fa, sono 30% e verde", () => {
    const { state, keys } = fixture(); apply(state, keys.slice(0, 3));
    expect(importProgress(state, [street.id], now)).toMatchObject({ total: 10, imported: 3, percent: 30, ageDays: 5, tone: "recent", lastImportedAt: ago(5) });
  });
  it("più applicazioni della stessa acquisizione sommano unità distinte, non tentativi", () => {
    const { state, keys } = fixture(); apply(state, keys.slice(0, 3)); apply(state, [keys[0]!], 4); apply(state, [keys[3]!], 3);
    expect(importProgress(state, [street.id], now)).toMatchObject({ imported: 4, percent: 40, ageDays: 3 });
  });
  it("un confronto o una correzione non cambia il colore dell'import né il denominatore", () => {
    const { state, keys, scan } = fixture(); scan.startedAt = ago(100); apply(state, keys.slice(0, 3), 95);
    state.runs.push({ ...scan, id: "compare", operation: "compare", startedAt: ago(1), itemKeys: keys.slice(0, 2), total: 2 });
    state.units[keys[0]!]!.assessment = null; state.units[keys[0]!]!.corrections.address = "Valore confermato";
    expect(importProgress(state, [street.id], now)).toMatchObject({ percent: 30, total: 10, tone: "stale", ageDays: 95 });
  });
  it("la nuova acquisizione azzera la copertura anche su immobili importati in precedenza", () => {
    const { state, keys, scan } = fixture(); apply(state, keys.slice(0, 3));
    state.units[keys[0]!]!.importedAt = ago(1);
    state.runs.push({ ...scan, id: "scan-new", startedAt: ago(2), endedAt: ago(2), itemKeys: keys.slice(0, 5) });
    expect(importProgress(state, [street.id], now)).toMatchObject({ acquisitionRunId: "scan-new", total: 5, imported: 0, percent: 0, lastImportedAt: null, tone: "never" });
  });
  it("una lettura parziale non torna alla run vecchia e non inventa il totale", () => {
    const { state, keys, scan } = fixture(); apply(state, keys.slice(0, 3));
    state.runs.push({ ...scan, id: "scan-partial", state: "paused", startedAt: ago(1), itemKeys: keys.slice(0, 2) });
    apply(state, [keys[0]!], 0, "scan-partial");
    expect(importProgress(state, [street.id], now)).toMatchObject({ observed: 2, total: null, percent: null, imported: 1, tone: "recent" });
  });
  it("gestisce zero immobili e vie mai acquisite senza dividere per zero", () => {
    const { state } = fixture(0);
    expect(importProgress(state, [street.id], now)).toMatchObject({ total: 0, percent: null, tone: "never" });
    state.runs = [];
    expect(importProgress(state, [street.id], now)).toMatchObject({ acquisitionRunId: null, total: null, percent: null });
  });
  it("calcola lo storico per via, senza distribuire i totali del job su tutte le vie", () => {
    const { state, keys } = fixture(); state.runs = [];
    for (const unit of Object.values(state.units)) { const o = unit.observations[0]!; o.runId = "history:old"; o.origin = "sister"; }
    for (const key of keys.slice(0, 3)) Object.assign(state.units[key]!.observations[0]!, { importedAt: ago(5), crmId: key, importVerified: true });
    state.history = [{ id: "old", streetIds: [street.id, "other"], street: street.name, status: "completed", at: ago(1), acquiredAt: ago(6), acquisitionComplete: true, completedAt: ago(1), acquired: 100, imported: 90, associated: 100, issues: [] }];
    expect(importProgress(state, [street.id], now)).toMatchObject({ total: 10, imported: 3, percent: 30, ageDays: 5 });
    state.history[0]!.issues.push({ propertyId: "unknown", address: null, reason: "Non assegnata" });
    expect(importProgress(state, [street.id], now).percent).toBeNull();
    state.history[0]!.issues[0]!.address = "Via estranea 2";
    expect(importProgress(state, [street.id], now).percent).toBe(30);
    state.history[0]!.issues[0]!.address = "Via della prova 22";
    expect(importProgress(state, [street.id], now).percent).toBeNull();
  });
  it("conserva una prova storica senza data, senza usare la data di recupero come ultimo import", () => {
    const { state, keys } = fixture(1); state.runs = [];
    Object.assign(state.units[keys[0]!]!.observations[0]!, { runId: "history:old", importVerified: true, crmId: "crm", importedAt: null });
    state.history = [{ id: "old", streetIds: [street.id], street: street.name, status: "completed", at: ago(0), acquiredAt: ago(6), acquisitionComplete: true, completedAt: null, acquired: 1, imported: 1, associated: 1, issues: [] }];
    expect(importProgress(state, [street.id], now)).toMatchObject({ percent: 100, lastImportedAt: null, tone: "never" });
  });
  it("il processo effettivo salva 3/10, resiste a correzioni e riapertura", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "territory-progress-test-")); directories.push(directory);
    const store = await TerritoryStore.open(directory, [street]);
    class TenProperties extends SimulationProvider { override async scan(s: Street, id: string, _checkpoint: unknown, sink: ScanSink) { for (let i = 1; i <= 10; i++) await sink(simulationSource(s, i, id)); return true; } }
    const app = new TerritoryApplication(store, new TenProperties(store, 0));
    await app.start(street.id, "scan"); await app.waitForIdle();
    await app.start(street.id, "compare"); await app.waitForIdle();
    const keys = app.detail(street.id).units.slice(0, 3).map(u => u.key);
    await app.start(street.id, "apply", keys); await app.waitForIdle();
    expect(app.detail(street.id).street.progress).toMatchObject({ imported: 3, total: 10, percent: 30, tone: "recent" });
    await app.correct(keys[0]!, { address: "Via della prova 22" }, "Correzione");
    const reopened = await TerritoryStore.open(directory, [street]);
    expect(importProgress(reopened.read(), [street.id])).toMatchObject({ percent: 30, imported: 3 });
    const next = new TerritoryApplication(reopened, new TenProperties(reopened, 0));
    await next.start(street.id, "scan"); await next.waitForIdle();
    expect(next.detail(street.id).street.progress).toMatchObject({ percent: 0, imported: 0, tone: "never" });
  });
});
