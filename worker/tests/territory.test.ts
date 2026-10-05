import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { SimulationProvider, simulationSource } from "../src/territory/providers.js";
import { LiveProvider, validateLiveConfig, type LiveConfig } from "../src/territory/live-provider.js";
import { effectiveSource, unitKey, type Street } from "../src/territory/model.js";
import { assess } from "../src/territory/reconcile.js";

const street: Street = { id: "123", name: "Via di prova", sisterName: "VIA DI PROVA", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function setup(provider?: (store: TerritoryStore) => SimulationProvider) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "territory-regression-")); directories.push(directory);
  const store = await TerritoryStore.open(directory, [street]);
  const app = new TerritoryApplication(store, provider?.(store) ?? new SimulationProvider(store, 0));
  return { app, store, directory };
}
async function run(app: TerritoryApplication, operation: "scan" | "compare" | "apply", keys: string[] = [], resume?: string) {
  await app.start(street.id, operation, keys, resume); await app.waitForIdle();
}
describe("Territorio: un solo flusso, memoria separata", () => {
  it("non deduce mai un'assenza da una ricerca incompleta o da duplicati", () => {
    const source = simulationSource(street, 1, "run");
    expect(assess(source, [], false).kind).toBe("unknown");
    const candidate = { id: "a", displayName: source.fullAddress, fullAddress: source.fullAddress, cadastral: source.cadastral };
    expect(assess(source, [candidate, { ...candidate, id: "b" }], true).kind).toBe("review");
    expect(assess(source, [{ ...candidate, cadastral: null }], true).kind).toBe("review");
    expect(assess(source, [], true).kind).toBe("create");
  });
  it("crea e aggiorna nello stesso processo e una seconda applicazione non duplica", async () => {
    const { app, store } = await setup();
    await run(app, "scan"); await run(app, "compare");
    expect(app.detail(street.id).units.map(u => u.assessment?.kind)).toEqual(["create", "create", "update", "review", "review", "unknown"]);
    const keys = app.detail(street.id).units.filter(u => ["create", "update"].includes(u.assessment!.kind)).map(u => u.key);
    await run(app, "apply", keys);
    expect(store.read().runs.at(-1)?.error).toBeNull();
    expect(store.read().runs.at(-1)?.state).toBe("completed");
    expect(keys.map(k => store.read().units[k]!.assessment?.kind)).toEqual(["synced", "synced", "synced"]);
    const ids = Object.keys(store.read().virtualCrm).sort();
    await run(app, "apply", keys);
    expect(Object.keys(store.read().virtualCrm).sort()).toEqual(ids);
    expect(Object.keys(store.read().virtualPeople)).toHaveLength(1);
    expect(store.read().runs.at(-1)?.state).toBe("completed");
  });
  it("non riusa un checkpoint concluso per ignorare un nuovo aggiornamento", async () => {
    const { app, store } = await setup(); await run(app, "scan"); await run(app, "compare");
    const unit = app.detail(street.id).units[0]!;
    await run(app, "apply", [unit.key]);
    expect(store.read().runs.at(-1)?.error).toBeNull();
    const previousVersion = effectiveSource(store.read().units[unit.key]!).sourcePropertyId;
    await store.change(state => { state.virtualCrm[state.units[unit.key]!.crmId!]!.fullAddress = "Indirizzo cambiato nel CRM"; });
    await run(app, "compare", [unit.key]); await run(app, "apply", [unit.key]);
    expect(effectiveSource(store.read().units[unit.key]!).sourcePropertyId).not.toBe(previousVersion);
    expect(store.read().virtualCrm[store.read().units[unit.key]!.crmId!]!.fullAddress).toBe(unit.source.fullAddress);
  });
  it("conserva correzioni, acquisizioni e annotazioni dopo la riapertura", async () => {
    const { app, store, directory } = await setup(); await run(app, "scan");
    const key = Object.keys(store.read().units)[0]!;
    await app.correct(key, { address: "Via di prova 22", category: "A/2" }, "Confermato a mano");
    await app.annotate(street.id, "Verifica al prossimo giro", true);
    await run(app, "scan");
    const reopened = await TerritoryStore.open(directory, [street]);
    expect(Object.keys(reopened.read().units)).toHaveLength(6);
    expect(reopened.read().units[key]!.observations).toHaveLength(2);
    expect(effectiveSource(reopened.read().units[key]!).fullAddress).toBe("Via di prova 22");
    expect(effectiveSource(reopened.read().units[key]!).category).toBe("A/2");
    expect(reopened.read().units[key]!.note).toBe("Confermato a mano");
    expect(reopened.read().memories[street.id]!.attention).toBe(true);
    expect(reopened.read().runs).toHaveLength(2);
  });
  it("riprende un'acquisizione senza ripetere gli immobili già conservati", async () => {
    const { app, store } = await setup(s => new SimulationProvider(s, 15));
    const id = await app.start(street.id, "scan"); app.pause(); await app.waitForIdle();
    expect(store.read().runs[0]!.state).toBe("paused");
    await run(app, "scan", [], id);
    expect(store.read().runs).toHaveLength(1);
    expect(store.read().runs[0]!.state).toBe("completed");
    expect(Object.values(store.read().units).every(u => u.observations.length === 1)).toBe(true);
  });
  it("conserva la lettura riparata di una riga anomala nella stessa acquisizione", async () => {
    let repair = false;
    const { store } = await setup();
    class RepairScan extends SimulationProvider {
      override async scan(s: Street, id: string, _checkpoint: unknown, sink: (source: ReturnType<typeof simulationSource>) => Promise<void>) {
        const source = simulationSource(s, 1, id);
        if (!repair) source.owners = [];
        await sink(source); const done = repair; repair = true; return done;
      }
    }
    const app = new TerritoryApplication(store, new RepairScan(store, 0));
    const id = await app.start(street.id, "scan"); await app.waitForIdle();
    await run(app, "scan", [], id);
    const unit = Object.values(store.read().units)[0]!;
    expect(unit.observations).toHaveLength(2);
    expect(effectiveSource(unit).owners).toHaveLength(1);
    expect(store.read().runs[0]!.handled).toBe(1);
  });
  it("rilegge il CRM e blocca l'applicazione se la ricerca ora fallisce", async () => {
    const { app, store } = await setup(); await run(app, "scan"); await run(app, "compare");
    const key = Object.keys(store.read().units)[0]!;
    class FailedSearch extends SimulationProvider { override async candidates() { return { rows: [], complete: false }; } }
    const secondApp = new TerritoryApplication(store, new FailedSearch(store, 0));
    await run(secondApp, "apply", [key]);
    expect(store.read().runs.at(-1)?.state).toBe("paused");
    expect(store.read().units[key]!.assessment?.kind).toBe("unknown");
    expect(Object.keys(store.read().virtualPeople)).toHaveLength(0);
  });
  it("riprende dopo un errore successivo al salvataggio senza duplicare la scheda", async () => {
    const { store } = await setup();
    let failed = false;
    class UncertainSave extends SimulationProvider {
      override async port() {
        const port = await super.port(); const create = port.createProperty.bind(port);
        port.createProperty = async (...args) => { const property = await create(...args); if (!failed) { failed = true; throw new Error("Risposta persa dopo salvataggio"); } return property; };
        return port;
      }
    }
    const app = new TerritoryApplication(store, new UncertainSave(store, 0));
    await run(app, "scan"); await run(app, "compare");
    const key = Object.keys(store.read().units)[0]!;
    await run(app, "apply", [key]);
    const last = store.read().runs.at(-1)!;
    if (last.state === "paused") await run(app, "apply", [key], last.id);
    expect(store.read().runs.at(-1)?.error).toBeNull();
    expect(store.read().runs.at(-1)?.state).toBe("completed");
    expect(Object.values(store.read().virtualCrm).filter(p => p.cadastral?.subaltern === "1")).toHaveLength(1);
  });
  it("recupera un arresto e impedisce di sovrascrivere un piano parziale", async () => {
    const { app, store, directory } = await setup(); await run(app, "scan"); await run(app, "compare");
    const key = Object.keys(store.read().units)[0]!; await run(app, "apply", [key]);
    await store.change(state => { state.runs.at(-1)!.state = "running"; state.checkpoints[effectiveSource(state.units[key]!).sourcePropertyId]!.stage = "people_synced"; });
    const reopened = await TerritoryStore.open(directory, [street]);
    expect(reopened.read().runs.at(-1)?.state).toBe("paused");
    const recovered = new TerritoryApplication(reopened, new SimulationProvider(reopened, 0));
    await expect(recovered.start(street.id, "scan")).rejects.toThrow("import parziale");
    await expect(recovered.correct(key, { address: "Altro indirizzo" }, "")).rejects.toThrow("Import parziale");
    expect(JSON.parse(await readFile(path.join(directory, "territory-ledger.json"), "utf8")).version).toBe(1);
  });
});
describe("Prove reali: confini espliciti", () => {
  const source = simulationSource(street, 1, "run");
  const config: LiveConfig = { cdpUrl: "http://127.0.0.1:9223", sisterTabMatch: "sister", crmTabMatch: "tecnocloud", allowedCadastralKeys: [unitKey(source)], allowedTaxCodes: [source.owners[0]!.taxCode], allowCreate: false };
  it("esclude Chrome quotidiano, CF non concordati e creazioni non concordate", () => {
    expect(() => validateLiveConfig({ ...config, cdpUrl: "http://127.0.0.1:9222" })).toThrow("9223");
    const provider = new LiveProvider(config, () => false);
    expect(provider.canWrite(unitKey(source), source)).toBe(true);
    expect(provider.canWrite(unitKey(source), { ...source, owners: [{ ...source.owners[0]!, taxCode: "ALTRO" }] })).toBe(false);
    expect(() => provider.authorizeWrite(source, "create")).toThrow("solo aggiornamenti");
    expect(() => provider.authorizeWrite(source, "update")).not.toThrow();
    expect(() => new LiveProvider({ ...config, allowedCadastralKeys: [], allowedTaxCodes: [] }, () => false).authorizeWrite(source, "update")).toThrow("fuori");
  });
});
