import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PropertyMemoryStore, type PropertyMemory } from "../src/import-v2/memory-store.js";
import type { ImportV2Store } from "../src/import-v2/ports.js";
import type { ImportV2Checkpoint } from "../src/import-v2/model.js";
import { buildPlan } from "../src/import-v2/identity.js";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { TerritoryImportStore } from "../src/territory/import-store.js";
import { SimulationProvider, simulationSource } from "../src/territory/providers.js";
import { effectiveSource, unitKey, type Street } from "../src/territory/model.js";
import { ensureMemoryUnit, hydrateUnitMemory, rememberCheckpoint, rememberHistoricalImport, unitMemory } from "../src/territory/unit-memory.js";
import { consumePropertyMemory, queuePropertyMemory } from "../src/territory/acquisition-inbox.js";

const street: Street = { id: "memory", name: "Via prova", sisterName: "VIA PROVA", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "unit-memory-")); directories.push(directory);
  const store = await TerritoryStore.open(directory, [street]);
  return { directory, store, app: new TerritoryApplication(store, new SimulationProvider(store, 0)) };
}
const source = () => simulationSource(street, 1, "old-job");
function checkpoint(): ImportV2Checkpoint {
  const plan = buildPlan(source());
  return { itemId: "item", jobId: plan.source.jobId, propertyId: plan.source.sourcePropertyId, plan, stage: "completed", people: [], syncedPeople: [], propertyResolution: { kind: "create", propertyId: null, evidence: {} }, crmPropertyId: "crm", attempts: 0, nextAttemptAt: null, lastError: null, updatedAt: "2026-10-07T10:00:00Z", activityEvidence: { activityId: null, outcome: "disabled" } };
}
const memory = (cp = checkpoint()): PropertyMemory => ({ version: 1, event: "stage_completed", at: cp.updatedAt, source: cp.plan!.source, checkpoint: cp });
describe("memoria individuale degli immobili", () => {
  it("conserva un successo prima dell'avanzamento della run e lo recupera dopo un'interruzione", async () => {
    const { store, app, directory } = await setup(); await app.start(street.id, "scan"); await app.waitForIdle();
    const unit = app.detail(street.id).units[0]!, src = effectiveSource(unit);
    await store.change(s => { s.runs.push({ id: "apply", streetId: street.id, operation: "apply", origin: "simulation", state: "running", startedAt: "2026-10-07T09:00:00Z", endedAt: null, error: null, handled: 0, total: 2, itemKeys: Object.keys(s.units).slice(0, 2) }); });
    const port = new TerritoryImportStore(store, street.id, "apply"), cp = await port.loadOrCreate(buildPlan(src));
    Object.assign(cp, { stage: "completed", crmPropertyId: "verified", updatedAt: "2026-10-07T10:00:00Z" }); await port.save(cp); await port.recordEvent(cp, "stage_completed");
    const reopened = await TerritoryStore.open(directory, [street]), state = reopened.read();
    expect(state.runs.at(-1)).toMatchObject({ state: "paused", handled: 0, imports: { [unit.key]: { crmId: "verified" } } });
    expect(unitMemory(state.units[unit.key]!).statistics.verifiedImports).toBe(1);
    expect(state.units[unit.key]!.journal!.filter(e => e.kind === "import_completed")).toHaveLength(1);
    expect(unitMemory(state.units[Object.keys(state.units)[1]!]!).statistics.verifiedImports).toBe(0);
  });
  it("deduplica i replay, distingue tentativi e successi e non perde una data conosciuta", async () => {
    const { store } = await setup(), cp = checkpoint(), fact = memory(cp);
    await store.change(s => { rememberCheckpoint(s, fact); rememberCheckpoint(s, fact); });
    await store.change(s => { const u = s.units[unitKey(fact.source)]!; rememberHistoricalImport(u, fact.source.jobId, fact.source, null, "crm"); hydrateUnitMemory(s); hydrateUnitMemory(s); });
    let unit = store.read().units[unitKey(fact.source)]!;
    expect(unitMemory(unit).statistics).toMatchObject({ acquisitions: 1, verifiedImports: 1, lastImportedAt: cp.updatedAt });
    expect(unit.importedAt).toBe(cp.updatedAt);
    const failed = { ...fact, event: "import_quarantined" as const, at: "2026-10-08T10:00:00Z", checkpoint: { ...cp, lastError: { kind: "verification_failed" as const, stage: "completed" as const, occurredAt: "2026-10-08T10:00:00Z", message: "Verifica fallita", retryable: false, global: false, details: {} } } };
    await store.change(s => { rememberCheckpoint(s, { ...failed, event: "stage_completed" }); rememberCheckpoint(s, failed); });
    unit = store.read().units[unitKey(fact.source)]!;
    expect(unitMemory(unit).statistics).toMatchObject({ verifiedImports: 1, reviews: 1 });
  });
  it("conserva dati originali, correzioni e versioni effettivamente importate", async () => {
    const { store, app, directory } = await setup();
    await app.start(street.id, "scan"); await app.waitForIdle(); const key = Object.keys(store.read().units)[0]!;
    await app.correct(key, { address: "Via prova 2 Piano 1" }, "Confermato a mano");
    await app.start(street.id, "compare", [key]); await app.waitForIdle(); await app.start(street.id, "apply", [key]); await app.waitForIdle();
    await app.start(street.id, "scan"); await app.waitForIdle();
    const state = (await TerritoryStore.open(directory, [street])).read(), unit = state.units[key]!;
    expect(unit.observations).toHaveLength(2); expect(unit.observations[0]!.source.fullAddress).toBe("Via prova 2");
    expect(effectiveSource(unit).fullAddress).toBe("Via prova 2 Piano 1");
    expect(unit.journal!.find(e => e.kind === "import_completed")?.source?.fullAddress).toBe("Via prova 2 Piano 1");
    expect(unit.journal!.find(e => e.kind === "import_completed")?.syncedPeople?.[0]?.crmPersonId).toBeTruthy();
    expect(unitMemory(unit).statistics).toMatchObject({ acquisitions: 2, corrections: 1, verifiedImports: 1 });
  });
  it("memorizza un immobile anche senza assegnare una geografia dubbia", async () => {
    const { store } = await setup(); await store.change(s => { ensureMemoryUnit(s, source(), "2026-10-07T10:00:00Z", "run"); });
    expect(Object.values(store.read().units)[0]!.streetIds).toEqual([]);
  });
  it("conserva anche il rifiuto di una fonte non valida quando l'identità catastale è nota", async () => {
    const { store, app } = await setup(); await app.start(street.id, "scan"); await app.waitForIdle();
    const unit = app.detail(street.id).units[0]!, invalid = { ...unit.source, owners: [] };
    const port = new TerritoryImportStore(store, street.id, store.read().runs[0]!.id);
    await port.quarantineSource(invalid, { kind: "invalid_source", stage: "queued", message: "Intestatari mancanti", retryable: false, global: false, occurredAt: "2026-10-08T11:00:00Z", details: {} });
    const memory = unitMemory(store.read().units[unit.key]!);
    expect(memory.statistics).toMatchObject({ reviews: 1, verifiedImports: 0 });
    expect(memory.events.find(e => e.kind === "import_quarantined")?.source?.owners).toEqual([]);
    expect(store.read().units[unit.key]!.observations[0]!.source.owners).toHaveLength(1);
  });
  it("la replica parte solo dopo la persistenza originale e non cambia l'esito CRM se fallisce", async () => {
    const cp = checkpoint(), persist = vi.fn(async () => {}), sink = vi.fn(async () => { throw new Error("Replica indisponibile"); });
    const base = { save: persist } as unknown as ImportV2Store, decorated = new PropertyMemoryStore(base, sink);
    await expect(decorated.save(cp)).resolves.toBeUndefined(); expect(sink).toHaveBeenCalledOnce();
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(sink.mock.invocationCallOrder[0]!);
    persist.mockRejectedValueOnce(new Error("Persistenza fallita")); await expect(decorated.save(cp)).rejects.toThrow("Persistenza fallita"); expect(sink).toHaveBeenCalledOnce();
  });
  it("conserva tutte le corsie, riprova dopo un guasto e separa le identità incomplete senza perdere i fatti", async () => {
    const { directory } = await setup(), a = memory(), b = memory(); b.at = "2026-10-07T11:00:00Z";
    const invalid = memory(); invalid.source.cadastral.subaltern = "";
    await Promise.all([a, b, a, invalid].map(f => queuePropertyMemory(directory, f)));
    await expect(consumePropertyMemory(directory, async () => { throw new Error("Occupato"); })).rejects.toThrow("Occupato");
    const seen: PropertyMemory[] = []; await consumePropertyMemory(directory, async f => { seen.push(f); });
    expect(seen.map(f => f.at)).toEqual([a.at, b.at]); expect(await readdir(path.join(directory, "property-unresolved"))).toHaveLength(1);
    expect(await consumePropertyMemory(directory, async () => { throw new Error("Replay"); })).toBe(0);
  });
});
