import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { SimulationProvider, simulationSource } from "../src/territory/providers.js";
import { effectiveSource, unitKey, type Street } from "../src/territory/model.js";
import { assess } from "../src/territory/reconcile.js";
import { ImportV2Error } from "../src/import-v2/errors.js";
import type { SourceProperty } from "../src/import-v2/model.js";
import { LiveProvider } from "../src/territory/live-provider.js";
import { SisterStreetRun, type SisterStreetRunCheckpoint } from "../src/services/sister-street-run.js";
const street: Street = { id: "q", name: "Via Mameli", sisterName: "VIA MAMELI", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function setup() { const dir = await mkdtemp(path.join(os.tmpdir(), "quarantine-")); dirs.push(dir); return { dir, store: await TerritoryStore.open(dir, [street]) }; }
async function execute(app: TerritoryApplication, operation: "scan" | "apply", keys: string[] = []) { await app.start(street.id, operation, keys); await app.waitForIdle(); }
describe("acquisizioni concluse e quarantena indipendente", () => {
  it("il provider reale conclude con esclusioni intenzionali e conserva da riprendere anomalie o risultati mancanti", async () => {
    const provider = new LiveProvider({ cdpUrl: "http://127.0.0.1:9223", sisterTabMatch: "sister", crmTabMatch: "crm", allowedCadastralKeys: [], allowedTaxCodes: [], allowCreate: false }, () => false);
    vi.spyOn(provider as unknown as { tabs(): Promise<unknown> }, "tabs").mockResolvedValue({ sisterPage: {} });
    const result = { status: "completed", totalSkippedPropertyRows: 2, lastError: null, results: [{ outcome: "found", recordLedger: [{ status: "skipped" }] }] } as SisterStreetRunCheckpoint;
    const run = vi.spyOn(SisterStreetRun.prototype, "run").mockResolvedValue(result);
    const args = [street, "run", undefined, async () => {}, async () => {}, () => false] as const;
    expect(await provider.scan(...args)).toBe(true);
    run.mockResolvedValue({ ...result, results: [{ outcome: "found", recordLedger: [{ status: "completed_with_anomalies" }] }] } as SisterStreetRunCheckpoint);
    expect(await provider.scan(...args)).toBe(false);
    run.mockResolvedValue({ ...result, results: undefined as never }); expect(await provider.scan(...args)).toBe(false);
    run.mockResolvedValue({ ...result, status: "paused" }); expect(await provider.scan(...args)).toBe(false);
    run.mockResolvedValue({ ...result, lastError: "Sessione scaduta" }); expect(await provider.scan(...args)).toBe(false);
  });
  it("conclude con sorgenti malformate, conserva originali e consente la correzione", async () => {
    const { dir, store } = await setup();
    class Scan extends SimulationProvider {
      override async scan(s: Street, id: string, _checkpoint: unknown, sink: (source: SourceProperty) => Promise<void>) {
        const valid = simulationSource(s, 1, id); await sink(valid);
        const bad = simulationSource(s, 2, id); bad.owners[0]!.taxCode = "ERRATO"; await sink(bad);
        const missing = simulationSource(s, 3, id); missing.cadastral.sheet = ""; await sink(missing);
        return true;
      }
    }
    const app = new TerritoryApplication(store, new Scan(store, 0)); await execute(app, "scan");
    expect(store.read().runs.at(-1)).toMatchObject({ state: "completed", error: null });
    expect(app.detail(street.id).units).toHaveLength(1);
    expect(app.detail(street.id).quarantine).toHaveLength(2);
    expect(app.query({}).total).toBe(1);
    const bad = app.quarantineList().find(q => q.unitKey)!;
    expect(bad.source!.owners[0]!.taxCode).toBe("ERRATO");
    await app.correct(bad.unitKey!, { owners: [{ ...bad.source!.owners[0]!, taxCode: "RSSMRA80A01A662A" }] }, "CF verificato");
    expect(app.detail(street.id).units).toHaveLength(2);
    expect(app.quarantineList()).toHaveLength(1);
    expect(store.read().units[bad.unitKey!]!.observations[0]!.source.owners[0]!.taxCode).toBe("ERRATO");
    const reopened = await TerritoryStore.open(dir, [street]);
    expect(Object.values(reopened.read().quarantine!)).toHaveLength(2);
  });
  it.each(["completed", "completed_with_anomalies"] as const)("ripristina lo stato storico coerente con le righe %s senza operazioni sui portali", async recordStatus => {
    const { dir, store } = await setup(); const at = new Date().toISOString();
    await store.change(state => { state.runs.push({ id: "old", streetId: street.id, operation: "scan", origin: "live", state: "paused", startedAt: at, endedAt: null, handled: 57, total: null, error: "Acquisizione parziale: i dati letti restano conservati.", itemKeys: [], checkpoint: { status: "completed", lastError: null, completedAt: at, updatedAt: at, results: [{ outcome: "found", inventoryProperties: [{ municipality: "BITONTO", sheet: "49", parcel: "93", subaltern: "", address: "Via Mameli 14", category: "C/2" }], recordLedger: [{ key: "BITONTO|49|93|", status: recordStatus, anomaly: "Identità catastale incompleta", label: "Via Mameli 14", completedAt: at }] }] } }); });
    const reopened = await TerritoryStore.open(dir, [street]);
    expect(reopened.read().runs[0]).toMatchObject(recordStatus === "completed" ? { state: "completed", endedAt: at, error: null } : { state: "paused", endedAt: null });
    if (recordStatus === "completed_with_anomalies") expect(Object.values(reopened.read().quarantine!)).toMatchObject([{ reason: "Identità catastale incompleta", recordKey: "BITONTO|49|93|" }]);
    const again = await TerritoryStore.open(dir, [street]); expect(Object.keys(again.read().quarantine ?? {})).toHaveLength(recordStatus === "completed" ? 0 : 1);
    expect(Object.keys(again.read().virtualCrm)).toHaveLength(0);
  });
  it("non trasforma una lettura interrotta in conclusa", async () => {
    const { dir, store } = await setup();
    const app = new TerritoryApplication(store, new SimulationProvider(store, 0));
    const id = await app.start(street.id, "scan"); app.pause(); await app.waitForIdle();
    expect(store.read().runs[0]).toMatchObject({ id, state: "paused" });
    expect((await TerritoryStore.open(dir, [street])).read().runs[0]!.state).toBe("paused");
  });
  it("confronta, crea e aggiorna direttamente; i duplicati non bloccano il successivo", async () => {
    const { store } = await setup(); const app = new TerritoryApplication(store, new SimulationProvider(store, 0));
    await execute(app, "scan");
    const units = app.detail(street.id).units;
    expect(units.every(u => !u.assessment)).toBe(true);
    const keys = [units.find(u => u.source.cadastral.subaltern === "4")!.key, ...units.filter(u => ["1", "2", "3"].includes(u.source.cadastral.subaltern)).map(u => u.key)];
    await execute(app, "apply", keys);
    expect(store.read().runs.at(-1)).toMatchObject({ state: "completed", handled: 4, error: null });
    expect(Object.values(store.read().runs.at(-1)!.imports!)).toHaveLength(4);
    expect(app.quarantineList().filter(q => q.origin === "apply")).toHaveLength(0);
    expect(Object.values(store.read().virtualCrm)).toHaveLength(5);
  });
  it("crea un immobile senza subalterno e ne aggiorna lo stesso record senza duplicare", async () => {
    const { store } = await setup();
    class Scan extends SimulationProvider {
      override async scan(s: Street, id: string, _checkpoint: unknown, sink: (source: SourceProperty) => Promise<void>) {
        const source = simulationSource(s, 1, id); source.cadastral.subaltern = ""; await sink(source); return true;
      }
    }
    const app = new TerritoryApplication(store, new Scan(store, 0)); await execute(app, "scan");
    const key = app.detail(street.id).units[0]!.key; expect(key).toBe("BITONTO||LAB|Q|");
    await execute(app, "apply", [key]); await execute(app, "apply", [key]);
    expect(store.read().runs.at(-1)!.state).toBe("completed");
    expect(Object.values(store.read().virtualCrm)).toHaveLength(1);
    expect(Object.values(store.read().virtualCrm)[0]!.cadastral!.subaltern).toBe("");
    expect(effectiveSource(store.read().units[key]!).cadastral.subaltern).toBe("");
  });
  it("conserva il piano scartato prima delle scritture senza lasciare un import parziale", async () => {
    const { store } = await setup();
    class RejectedPlan extends SimulationProvider {
      override async port() {
        const port = await super.port();
        port.assertSession = async () => { throw new ImportV2Error("Dati del singolo immobile non interpretabili", "invalid_source"); };
        return port;
      }
    }
    const app = new TerritoryApplication(store, new RejectedPlan(store, 0));
    await execute(app, "scan"); const key = app.detail(street.id).units[0]!.key;
    await execute(app, "apply", [key]);
    expect(store.read().runs.at(-1)!.state).toBe("completed");
    expect(Object.keys(store.read().checkpoints)).toHaveLength(0);
    expect(app.quarantineList().find(q => q.origin === "apply")!.checkpoint).toMatchObject({ stage: "queued", crmPropertyId: null, syncedPeople: [] });
    expect(Object.keys(store.read().virtualPeople)).toHaveLength(0);
    await execute(app, "scan"); expect(store.read().runs.at(-1)!.state).toBe("completed");
  });
  it("il subalterno assente non autorizza a scegliere o cancellare il subalterno di un'altra unità", async () => {
    const { store } = await setup(); const source = simulationSource(street, 1, "source"); source.cadastral.subaltern = "";
    const candidate = { id: "sibling", displayName: source.fullAddress, fullAddress: source.fullAddress, cadastral: { ...source.cadastral, subaltern: "9" } };
    expect(assess(source, [candidate], true).kind).toBe("review");
    expect(assess(source, [], false).kind).toBe("unknown");
    expect(unitKey(source)).not.toBe(unitKey({ ...source, cadastral: candidate.cadastral }));
    await store.change(state => { state.virtualCrm.sibling = { ...candidate, owners: [] }; });
    class Scan extends SimulationProvider { override async scan(_s: Street, _id: string, _cp: unknown, sink: (source: SourceProperty) => Promise<void>) { await sink(source); return true; } }
    const app = new TerritoryApplication(store, new Scan(store, 0)); await execute(app, "scan"); await execute(app, "apply", [unitKey(source)]);
    expect(store.read().runs.at(-1)!.state).toBe("completed");
    expect(store.read().virtualCrm.sibling!.cadastral!.subaltern).toBe("9");
    expect(Object.keys(store.read().virtualPeople)).toHaveLength(0);
    expect(app.quarantineList()).toHaveLength(1);
  });
});
