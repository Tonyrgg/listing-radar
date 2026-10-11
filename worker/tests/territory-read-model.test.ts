import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { SimulationProvider } from "../src/territory/providers.js";
import { streetSummary, streetSummaries, type Street } from "../src/territory/model.js";

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const streets: Street[] = ["a", "b", "network:a"].map(id => ({ id, name: `Via ${id}`, sisterName: `VIA ${id}`, locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false }));
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "territory-read-model-")); directories.push(directory);
  const store = await TerritoryStore.open(directory, streets), app = new TerritoryApplication(store, new SimulationProvider(store, 0));
  await app.start("a", "scan"); await app.waitForIdle();
  await app.start("b", "scan"); await app.waitForIdle();
  return { app, store };
}
describe("Proiezioni della memoria V2", () => {
  it("l'indice conserva il riepilogo per vie collegate, proprietà condivise e quarantena", async () => {
    const { app, store } = await setup();
    const keys = app.detail("a").units.slice(0, 2).map(u => u.key);
    await app.enqueue(keys); await app.startQueue(keys); await app.waitForIdle();
    await store.change(s => {
      s.networkBindings = { "network:a": { officialId: "a", confirmedAt: new Date().toISOString() } };
      s.streets.find(st => st.id === "network:a")!.linkedOfficialId = "a";
      s.units[keys[0]!]!.streetIds = ["network:a", "b"];
      s.quarantine = { q: { id: "q", streetId: "a", unitKey: keys[1], runId: "q", at: new Date().toISOString(), reason: "Verifica", address: "Via a", cadastral: null, origin: "scan", resolvedAt: null } };
    });
    const state = store.read();
    expect(streetSummaries(state)).toEqual(state.streets.filter(s => !s.linkedOfficialId).map(s => streetSummary(state, s)));
  });
  it("riusa la mappa invariata, protegge la cache e aggiorna colori, commit e attività", async () => {
    const { app, store } = await setup();
    const read = vi.spyOn(store, "read");
    const first = app.snapshot(); app.snapshot(); expect(read).toHaveBeenCalledTimes(1);
    first.streets[0]!.name = "corrotto"; first.queueKeys.push("inventato");
    expect(app.snapshot().streets[0]!.name).not.toBe("corrotto");
    expect(app.snapshot().queueKeys).toEqual([]);
    const committed = store.revision;
    app.refreshAuthorization();
    expect(app.snapshot().presentationRevision).toBe(1);
    expect(store.revision).toBe(committed);
    expect(read).toHaveBeenCalledTimes(2);
    const at = Date.now(); vi.spyOn(Date, "now").mockReturnValue(at + 60001);
    app.snapshot(); expect(read).toHaveBeenCalledTimes(3);
    await app.annotate("a", "Nuova nota", true);
    expect(app.snapshot().streets.find(s => s.id === "a")!.attention).toBe(true);
    await app.start("b", "scan");
    expect(app.snapshot().activeRun?.operation).toBe("scan");
    await app.waitForIdle(); expect(app.snapshot().activeRun).toBe(null);
    const key = app.detail("a").units[0]!.key;
    await app.enqueue([key]); await app.startQueue([key]); await app.waitForIdle();
    const proof = store.read().units[key]!.importedAt!;
    vi.mocked(Date.now).mockReturnValue(Date.parse(proof) + 30 * 86400000);
    expect(app.snapshot().streets.find(s => s.id === "a")!.progress.distribution.recent).toBe(1);
    vi.mocked(Date.now).mockReturnValue(Date.parse(proof) + 31 * 86400000);
    expect(app.snapshot().streets.find(s => s.id === "a")!.progress.distribution.aging).toBe(1);
  });
});
