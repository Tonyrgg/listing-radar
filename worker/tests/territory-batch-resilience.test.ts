import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, mkdir, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { SimulationProvider, simulationSource } from "../src/territory/providers.js";
import { effectiveSource, type Street } from "../src/territory/model.js";
import { choosePropertyCandidate } from "../src/import-v2/identity.js";
import { ImportV2Error } from "../src/import-v2/errors.js";
import { assess } from "../src/territory/reconcile.js";
import type { SourceProperty } from "../src/import-v2/model.js";

const street: Street = { id: "resilience", name: "Via Perrese", sisterName: "VIA PERRESE", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "v2-resilience-")); dirs.push(dir);
  const store = await TerritoryStore.open(dir, [street]);
  class Scan extends SimulationProvider {
    override async scan(s: Street, id: string, _cp: unknown, sink: (source: SourceProperty) => Promise<void>) {
      for (let i = 1; i <= 3; i++) await sink(simulationSource(s, i, id)); return true;
    }
  }
  const scan = new TerritoryApplication(store, new Scan(store, 0)); await scan.start(street.id, "scan"); await scan.waitForIdle();
  return { dir, store, keys: scan.detail(street.id).units.map(u => u.key) };
}
describe("V2: duplicati e continuita del batch", () => {
  it("preferisce la visura, poi il primo; non sceglie un altro sub o una sezione diversa", () => {
    const source = simulationSource(street, 1, "source");
    const first = { id: "first", displayName: source.fullAddress, fullAddress: source.fullAddress, cadastral: source.cadastral };
    const registry = { ...first, id: "registry", importedFromRegistry: true, fullAddress: "Indirizzo precedente", cadastral: { ...source.cadastral, income: 10 } };
    expect(assess(source, [first, registry], true)).toMatchObject({ kind: "update", candidateId: "registry", candidateIds: ["first", "registry"] });
    expect(choosePropertyCandidate(source, [first, registry], true).candidate?.id).toBe("registry");
    expect(choosePropertyCandidate(source, [first, { ...first, id: "second" }], true).candidate?.id).toBe("first");
    expect(() => choosePropertyCandidate(source, [first, { ...first, id: "second" }])).toThrow();
    expect(choosePropertyCandidate(source, [{ ...registry, cadastral: { ...registry.cadastral, subaltern: "2" } }, first], true).candidate?.id).toBe("first");
    expect(assess(source, [{ ...registry, cadastral: { ...registry.cadastral, urbanSection: "A" } }, { ...first, cadastral: { ...first.cadastral, urbanSection: "B" } }], true).kind).toBe("review");
    expect(assess(source, [first, registry], false).kind).toBe("unknown");
    const blank = { ...source, cadastral: { ...source.cadastral, subaltern: "" } };
    expect(choosePropertyCandidate(blank, [{ ...first, cadastral: blank.cadastral }, { ...registry, cadastral: blank.cadastral }], true).candidate?.id).toBe("registry");
    expect(() => choosePropertyCandidate(blank, [first], true)).toThrow();
  });
  it("aggiorna solo la scheda preferita e registra scelta e alternative nello storico", async () => {
    const { store, keys } = await setup(); const source = effectiveSource(store.read().units[keys[0]!]!);
    await store.change(s => { for (const id of ["first", "registry"]) s.virtualCrm[id] = { id, displayName: source.fullAddress, fullAddress: source.fullAddress, cadastral: source.cadastral, importedFromRegistry: id === "registry", owners: [] }; });
    const other = store.read().virtualCrm.first;
    const app = new TerritoryApplication(store, new SimulationProvider(store, 0)); await app.enqueue(keys); await app.startQueue(keys); await app.waitForIdle();
    expect(store.read().runs.at(-1)).toMatchObject({ state: "completed", handled: 3 });
    expect(store.read().units[keys[0]!]!.crmId).toBe("registry");
    expect(store.read().virtualCrm.first).toEqual(other);
    expect(store.read().units[keys[0]!]!.journal!.some(e => e.assessment?.candidateId === "registry" && e.assessment.candidateIds?.length === 2)).toBe(true);
    expect(Object.keys(store.read().virtualCrm)).toHaveLength(4);
  });
  it("accantona una ricerca non confermata e importa tutti gli immobili successivi", async () => {
    const { store, keys, dir } = await setup(); let attempts = 0;
    class FailedSearch extends SimulationProvider {
      override async candidates(s: Street, source: SourceProperty) {
        if (source.cadastral.subaltern === "1") { attempts++; throw new ImportV2Error("Ricerca immobili non confermata", "transient_portal", { retryable: true }); }
        return super.candidates(s, source);
      }
    }
    const app = new TerritoryApplication(store, new FailedSearch(store, 0)); await app.enqueue(keys); await app.startQueue(keys); await app.waitForIdle();
    expect(attempts).toBe(2);
    expect(store.read().runs.at(-1)).toMatchObject({ state: "completed", handled: 3, error: null, skipped: { [keys[0]!]: { reason: "Ricerca immobili non confermata" } } });
    expect(Object.keys(store.read().runs.at(-1)!.imports!)).toEqual(keys.slice(1));
    expect(app.importQueue().entries.map(e => e.key)).toEqual([keys[0]]);
    expect(Object.keys(store.read().virtualCrm)).toHaveLength(2);
    expect((await TerritoryStore.open(dir, [street])).read().runs.at(-1)!.skipped).toEqual(store.read().runs.at(-1)!.skipped);
  });
  it.each(["verification_failed", "global_portal"] as const)("conserva una creazione incerta (%s), prosegue e recupera poi senza duplicarla", async kind => {
    const { store, keys } = await setup();
    class Uncertain extends SimulationProvider {
      override async port() {
        const port = await super.port(), create = port.createProperty.bind(port);
        port.createProperty = async (...args) => { const saved = await create(...args); if (args[0].source.cadastral.subaltern === "1") throw new ImportV2Error("Risposta persa dopo creazione", kind, { global: kind === "global_portal" }); return saved; };
        return port;
      }
    }
    const app = new TerritoryApplication(store, new Uncertain(store, 0)); await app.enqueue(keys); await app.startQueue(keys); await app.waitForIdle();
    expect(store.read().runs.at(-1)).toMatchObject({ state: "completed", handled: 3 });
    expect(Object.keys(store.read().runs.at(-1)!.imports!)).toEqual(keys.slice(1));
    const cp = Object.values(store.read().checkpoints).find(c => c.stage !== "completed")!;
    expect(cp.stage).toBe("property_resolved"); expect(app.importQueue().entries[0]!.editLocked).toBe(true);
    expect(app.quarantineList()[0]!.checkpoint!.plan!.fingerprint).toBe(cp.plan!.fingerprint);
    expect(Object.keys(store.read().virtualCrm)).toHaveLength(3);
    const next = new TerritoryApplication(store, new SimulationProvider(store, 0)); await next.startQueue([keys[0]!]); await next.waitForIdle();
    expect(Object.keys(store.read().virtualCrm)).toHaveLength(3); expect(next.importQueue().entries).toHaveLength(0);
    expect(next.quarantineList()).toHaveLength(0); expect(next.unitDetail(keys[0]!).memory.statistics.verifiedImports).toBe(1);
  });
  it.each(["global_portal", "global_session"] as const)("attende %s e riparte nella stessa run con il cursore invariato", async kind => {
    const { store, keys } = await setup(); let unavailable = true, resets = 0;
    class Offline extends SimulationProvider {
      async resetConnection() { resets++; unavailable = false; }
      override async candidates(s: Street, source: SourceProperty) {
        if (unavailable) throw new ImportV2Error("Sessione scaduta", kind, { global: true });
        return super.candidates(s, source);
      }
    }
    const waits: unknown[] = []; let app: TerritoryApplication;
    app = new TerritoryApplication(store, new Offline(store, 0), () => { if (app.snapshot().activeRun?.waiting) waits.push(app.snapshot().activeRun); }, 1);
    await app.enqueue(keys); const id = await app.startQueue(keys); await app.waitForIdle();
    expect(waits).toContainEqual(expect.objectContaining({ id, state: "running", waiting: "Sessione scaduta", handled: 0, endedAt: null }));
    expect(resets).toBe(1); expect(store.read().runs.at(-1)).toMatchObject({ id, state: "completed", waiting: null, handled: 3 });
    expect(Object.keys(store.read().runs.at(-1)!.imports!)).toHaveLength(3);
  });
  it("rispetta l'interruzione esplicita anche mentre Chrome manca", async () => {
    const { store, keys } = await setup();
    class Offline extends SimulationProvider { override async candidates(): Promise<never> { throw new ImportV2Error("Chrome chiuso", "global_portal", { global: true }); } }
    let app: TerritoryApplication; app = new TerritoryApplication(store, new Offline(store, 0), () => { if (app.snapshot().activeRun?.waiting) app.pause(); }, 1);
    await app.enqueue(keys); await app.startQueue(keys); await app.waitForIdle();
    expect(store.read().runs.at(-1)).toMatchObject({ state: "stopped", handled: 0, waiting: null });
    expect(app.importQueue().entries).toHaveLength(3); expect(Object.keys(store.read().virtualCrm)).toHaveLength(0);
  });
  it("non scrive altri immobili se non puo conservare il checkpoint sul disco", async () => {
    const { store, keys, dir } = await setup(); let writes = 0;
    class BrokenDisk extends SimulationProvider {
      override async port() {
        const port = await super.port(), create = port.createProperty.bind(port);
        port.createProperty = async (...args) => {
          const result = await create(...args); writes++;
          const ledger = path.join(dir, "territory-ledger.json");
          await rename(ledger, path.join(dir, "saved-ledger.json")); await mkdir(ledger);
          return result;
        }; return port;
      }
    }
    const app = new TerritoryApplication(store, new BrokenDisk(store, 0), () => {}, 1);
    await app.enqueue(keys); await app.startQueue(keys); await app.waitForIdle();
    expect(writes).toBe(1); expect(app.snapshot().error).toContain("Memoria locale non salvata");
    expect(store.read().units[keys[1]!]!.crmId).toBeNull();
    expect(Object.values(store.read().checkpoints)[0]!.stage).toBe("property_resolved");
  });
  it("alla riapertura archivia l'attesa interrotta conservando coda e checkpoint", async () => {
    const { store, keys, dir } = await setup();
    const app = new TerritoryApplication(store, new SimulationProvider(store, 0)); await app.enqueue(keys);
    await store.change(s => { s.runs.push({ id: "interrupted-wait", streetId: street.id, operation: "apply", origin: "simulation", state: "running", startedAt: new Date().toISOString(), endedAt: null, handled: 0, total: keys.length, itemKeys: keys, error: null, waiting: "Chrome chiuso", queueEntryIds: Object.fromEntries(keys.map(key => [key, s.importQueue![key]!.id])) }); });
    const prior = store.read().checkpoints;
    const reopened = await TerritoryStore.open(dir, [street]);
    expect(reopened.read().runs.at(-1)).toMatchObject({ state: "stopped", waiting: null, handled: 0 });
    expect(reopened.read().checkpoints).toEqual(prior); expect(Object.keys(reopened.read().importQueue!)).toEqual(keys);
  });
});
