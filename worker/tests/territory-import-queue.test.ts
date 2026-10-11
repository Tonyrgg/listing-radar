import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { SimulationProvider } from "../src/territory/providers.js";
import { hydrateImportQueue } from "../src/territory/import-queue.js";
import { buildPlan } from "../src/import-v2/identity.js";
import { effectiveSource, type Street } from "../src/territory/model.js";
import type { SourceProperty } from "../src/import-v2/model.js";

const streets: Street[] = ["a", "b"].map(id => ({ id, name: `Via ${id}`, sisterName: `VIA ${id}`, locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false }));
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "territory-queue-")); directories.push(directory);
  const store = await TerritoryStore.open(directory, streets);
  let failure = false, phase = "";
  const routes: string[] = [];
  class Provider extends SimulationProvider {
    beginOperation(operation: string) { phase = operation; }
    override async candidates(street: Street, source: SourceProperty) {
      if (phase === "apply") { routes.push(street.id); if (failure && street.id === "b") { failure = false; throw new Error("Browser interrotto"); } }
      return super.candidates(street, source);
    }
  }
  const app = new TerritoryApplication(store, new Provider(store, 0));
  for (const s of streets) { await app.start(s.id, "scan"); await app.waitForIdle(); }
  const keys = streets.map(s => app.detail(s.id).units[0]!.key);
  return { app, store, directory, keys, routes, interrupt: () => { failure = true; } };
}
describe("Coda centrale degli import V2", () => {
  it("svuota anche casi bloccati e conserva dati, piani incerti e prove dopo il riavvio", async () => {
    const { app, store, directory, keys } = await setup();
    await app.enqueue(keys);
    await store.change(state => {
      const source = effectiveSource(state.units[keys[0]!]!);
      const plan = buildPlan(source);
      state.checkpoints[source.sourcePropertyId] = { itemId: "uncertain", jobId: source.jobId, propertyId: source.sourcePropertyId, stage: "property_synced", plan, people: [], syncedPeople: [], propertyResolution: null, crmPropertyId: "uncertain-crm", attempts: 0, nextAttemptAt: null, lastError: null, updatedAt: "2026-10-11T10:00:00Z" };
      state.importQueue!.missing = { id: "missing", key: "missing", streetId: "a", addedAt: "2026-10-11T10:00:00Z" };
    });
    const before = store.read(), queue = app.importQueue();
    expect(queue.entries.filter(e => e.problem)).toHaveLength(2);
    expect(await app.clearQueue(queue.revision)).toBe(3);
    const after = store.read();
    expect(after.checkpoints).toEqual(before.checkpoints);
    expect(after.runs).toEqual(before.runs);
    expect(after.virtualCrm).toEqual(before.virtualCrm);
    for (const key of keys) {
      const { journal: oldJournal, ...oldData } = before.units[key]!;
      const { journal: newJournal, ...newData } = after.units[key]!;
      expect(newData).toEqual(oldData);
      expect(newJournal!.slice(0, oldJournal!.length)).toEqual(oldJournal);
      expect(newJournal!.at(-1)!.kind).toBe("queue_removed");
    }
    const reopened = await TerritoryStore.open(directory, streets);
    expect(reopened.read().importQueue).toEqual({});
    expect(reopened.read().checkpoints).toEqual(before.checkpoints);
    await app.enqueue([keys[1]!]);
    expect(app.importQueue().entries[0]!.id).not.toBe(before.importQueue![keys[1]!]!.id);
  });
  it("non svuota una coda cambiata dopo la conferma o occupata da un lavoro", async () => {
    const { app, store, keys } = await setup();
    await app.enqueue([keys[0]!]); const revision = app.importQueue().revision;
    await app.enqueue([keys[1]!]); const before = store.read();
    await expect(app.clearQueue(revision)).rejects.toThrow("cambiata");
    expect(store.read()).toEqual(before);
    await app.startQueue(keys);
    await expect(app.clearQueue(store.revision)).rejects.toThrow("corso");
    await app.waitForIdle();
    expect(await app.clearQueue(store.revision)).toBe(0);
  });
  it("conserva ordine e identità senza duplicare immobili o avviare scritture", async () => {
    const { app, store, directory, keys } = await setup();
    const before = store.read().virtualCrm;
    expect(await app.enqueue([keys[0]!], "a")).toBe(1);
    const first = app.importQueue().entries[0]!;
    expect(await app.enqueue(keys)).toBe(1);
    expect(await app.enqueue(keys)).toBe(0);
    expect(app.importQueue().entries.map(e => e.key)).toEqual(keys);
    expect(app.importQueue().entries[0]!.id).toBe(first.id);
    expect(store.read().virtualCrm).toEqual(before);
    const reopened = await TerritoryStore.open(directory, streets);
    expect(Object.keys(reopened.read().importQueue!)).toEqual(keys);
  });
  it("le correzioni dalla coda sono permanenti e la rimozione conserva memoria e storico", async () => {
    const { app, store, directory, keys } = await setup();
    await app.enqueue(keys); const id = app.importQueue().entries[0]!.id;
    await app.correct(keys[0]!, { address: "Via a N. 20 Piano 1", category: "C/6" }, "Nota permanente");
    expect(app.importQueue().entries[0]!.unit!.source.fullAddress).toBe("Via a N. 20 Piano 1");
    expect(app.importQueue().entries[0]!.id).toBe(id);
    await app.dequeue([keys[0]!]);
    expect(app.detail("a").units.find(u => u.key === keys[0])!.note).toBe("Nota permanente");
    const reopened = await TerritoryStore.open(directory, streets);
    expect(effectiveSource(reopened.read().units[keys[0]!]!).category).toBe("C/6");
    expect(reopened.read().units[keys[0]!]!.journal!.some(e => e.kind === "queue_removed")).toBe(true);
  });
  it("rifiuta batch invalidi senza aggiungere parzialmente o confondere le vie", async () => {
    const { app, keys } = await setup();
    await expect(app.enqueue([keys[0]!, "inesistente"])).rejects.toThrow("selezione");
    await expect(app.enqueue([keys[0]!], "b")).rejects.toThrow("via");
    expect(app.importQueue().entries).toHaveLength(0);
    await expect(app.startQueue(keys)).rejects.toThrow("coda");
  });
  it("importa più vie nello stesso canale e rimuove solo i successi verificati", async () => {
    const { app, store, keys, routes } = await setup();
    await app.enqueue(keys); await app.startQueue(keys); await app.waitForIdle();
    expect(app.importQueue().entries).toHaveLength(0);
    expect(store.read().runs.at(-1)!.state).toBe("completed");
    expect(store.read().runs.at(-1)!.handled).toBe(2);
    expect(Object.keys(store.read().runs.at(-1)!.imports!)).toEqual(keys);
    expect(routes).toEqual(["a", "b"]);
  });
  it("chiude il batch interrotto e lascia liberi gli immobili non iniziati", async () => {
    const { app, keys, interrupt, store } = await setup();
    await app.enqueue(keys); interrupt(); const runId = await app.startQueue(keys); await app.waitForIdle();
    expect(store.read().runs.at(-1)).toMatchObject({ state: "stopped", handled: 1 });
    expect(store.read().runs.at(-1)!.endedAt).not.toBeNull();
    expect(app.unitDetail(keys[0]!).memory.statistics.verifiedImports).toBe(1);
    expect(app.unitDetail(keys[1]!).memory.statistics.verifiedImports).toBe(0);
    expect(app.snapshot().streets.find(s => s.id === "a")!.status).not.toBe("paused");
    expect(app.importQueue().entries[0]).toMatchObject({ key: keys[1], locked: false, editLocked: false });
    await app.dequeue([keys[1]!]); await app.correct(keys[1]!, { category: "A/2" }, "Nuova selezione");
    await app.enqueue([keys[1]!]);
    await expect(app.startQueue([], undefined, runId)).rejects.toThrow("terminato");
    const id = await app.startQueue([keys[1]!]); await app.waitForIdle();
    expect(id).not.toBe(runId);
    expect(app.importQueue().entries).toHaveLength(0);
    expect(store.read().runs.find(r => r.id === runId)!.state).toBe("stopped");
    expect(app.unitDetail(keys[0]!).memory.statistics.verifiedImports).toBe(1);
    expect(app.unitDetail(keys[1]!).memory.statistics.verifiedImports).toBe(1);
  });
  it("recupera gli import precedenti interrotti nella coda mantenendo il piano originale", async () => {
    const { app, keys, interrupt, store, directory } = await setup();
    interrupt(); const runId = await app.startQuery({}, "apply", keys); await app.waitForIdle();
    const sources = store.read().runs.at(-1)!.applySources;
    const reopened = await TerritoryStore.open(directory, streets);
    const next = new TerritoryApplication(reopened, new SimulationProvider(reopened, 0));
    expect(next.importQueue().entries.map(e => e.key)).toEqual([keys[1]]);
    expect(reopened.read().runs.at(-1)!.applySources).toEqual(sources);
    expect(reopened.read().runs.find(r => r.id === runId)!.state).toBe("stopped");
    await next.startQueue([keys[1]!]); await next.waitForIdle();
    expect(next.importQueue().entries).toHaveLength(0);
  });
  it("conserva le anomalie senza rimuoverle dalla coda e permette di correggerle", async () => {
    const { app, keys, store, directory } = await setup();
    await app.enqueue([keys[0]!]);
    const source = app.unitDetail(keys[0]!).source;
    await app.correct(keys[0]!, { owners: source.owners.map(o => ({ ...o, taxCode: "" })) }, "CF da completare");
    expect(app.importQueue().readyKeys).toHaveLength(0);
    await expect(app.startQueue([keys[0]!])).rejects.toThrow("Dati");
    expect(app.importQueue().entries).toHaveLength(1);
    await app.correct(keys[0]!, { owners: source.owners }, "CF corretto");
    expect(app.importQueue().readyKeys).toEqual([keys[0]]);
    await app.startQueue([keys[0]!]); await app.waitForIdle();
    expect(app.importQueue().entries).toHaveLength(0);
    expect((await TerritoryStore.open(directory, streets)).read().importQueue).toEqual({});
    expect(store.read().units[keys[0]!]!.note).toBe("CF corretto");
  });
  it("ripara la coda dopo una prova di successo già conservata senza avanzamento", async () => {
    const { app, keys, store } = await setup();
    await app.enqueue(keys);
    const firstId = store.read().importQueue![keys[0]!]!.id;
    await app.startQueue(keys); await app.waitForIdle();
    await store.change(state => {
      const run = state.runs.at(-1)!;
      run.state = "paused"; run.handled = 0;
      state.importQueue![keys[0]!] = { id: firstId, key: keys[0]!, streetId: "a", addedAt: run.startedAt };
      hydrateImportQueue(state);
    });
    expect(app.importQueue().entries).toHaveLength(0);
    const crm = store.read().virtualCrm;
    await expect(app.startQueue([], undefined, store.read().runs.at(-1)!.id)).rejects.toThrow("terminato");
    expect(store.read().virtualCrm).toEqual(crm);
    expect(store.read().runs.at(-1)!.state).toBe("stopped");
  });

  it("un piano incerto senza opzioni recuperabili blocca solo quel caso", async () => {
    const { app, keys, store } = await setup();
    await app.enqueue([keys[0]!]); await app.startQueue([keys[0]!]); await app.waitForIdle();
    await store.change(state => {
      const cp = Object.values(state.checkpoints)[0]!;
      delete state.checkpoints[cp.propertyId];
      cp.propertyId = "orphan-source";
      cp.plan = buildPlan({ ...cp.plan!.source, sourcePropertyId: cp.propertyId });
      cp.stage = "property_synced";
      state.checkpoints[cp.propertyId] = cp;
    });
    await app.enqueue(keys);
    const before = store.read().checkpoints;
    expect(app.importQueue().readyKeys).toEqual([keys[1]]);
    expect(app.importQueue().entries[0]).toMatchObject({ editLocked: true, problem: expect.stringContaining("Opzioni originali") });
    await expect(app.startQueue([keys[0]!])).rejects.toThrow("piani");
    await app.startQueue([keys[1]!]); await app.waitForIdle();
    expect(store.read().checkpoints["orphan-source"]).toEqual(before["orphan-source"]);
    expect(app.unitDetail(keys[1]!).memory.statistics.verifiedImports).toBe(1);
    await app.dequeue([keys[0]!]);
    expect(store.read().checkpoints["orphan-source"]).toEqual(before["orphan-source"]);
  });

  it("una prova precedente non rimuove un nuovo inserimento nella coda", async () => {
    const { app, keys, store, directory } = await setup();
    const key = keys[0]!;
    await app.enqueue([key]); const oldEntry = store.read().importQueue![key]!.id;
    await app.startQueue([key]); await app.waitForIdle();
    await app.enqueue([key]); const newEntry = store.read().importQueue![key]!.id;
    expect(newEntry).not.toBe(oldEntry);
    const reopened = await TerritoryStore.open(directory, streets);
    expect(reopened.read().importQueue![key]!.id).toBe(newEntry);
    const next = new TerritoryApplication(reopened, new SimulationProvider(reopened, 0));
    await next.startQueue([key]); await next.waitForIdle();
    expect(next.importQueue().entries).toHaveLength(0);
    expect(next.unitDetail(key).memory.statistics.verifiedImports).toBe(2);
    expect(Object.values(reopened.read().virtualCrm).filter(p => p.cadastral?.parcel === "a" && p.cadastral.subaltern === "1")).toHaveLength(1);
  });

});
