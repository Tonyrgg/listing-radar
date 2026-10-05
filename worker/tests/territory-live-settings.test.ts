import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { SimulationProvider, simulationSource } from "../src/territory/providers.js";
import { LiveProvider, type LiveConfig } from "../src/territory/live-provider.js";
import { configureTestSettings, testSettings } from "../src/territory/test-settings.js";
import { unitKey, type Street } from "../src/territory/model.js";
import type { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const street: Street = { id: "20", name: "Via della prova", sisterName: "VIA DELLA PROVA", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false };
const base: LiveConfig = { cdpUrl: "http://127.0.0.1:9223", sisterTabMatch: "sister", crmTabMatch: "cloud", allowedCadastralKeys: [], allowedTaxCodes: [], allowCreate: false };
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "territory-live-settings-")); directories.push(directory);
  const store = await TerritoryStore.open(directory, [street]);
  const source = simulationSource(street, 1, "run"); source.cadastral.sheet = "49";
  const key = unitKey(source);
  await store.change(s => { s.units[key] = { key, streetIds: [street.id], observations: [{ at: "2026-10-04T16:00:00Z", runId: "run", source, origin: "sister" }], corrections: {}, note: "", assessment: null, importedAt: null, crmId: null }; });
  return { store, source, key };
}
describe("Schede reali scelte esplicitamente nel laboratorio", () => {
  it("autorizza solo le identità selezionate e i loro attuali intestatari", async () => {
    const { store, source, key } = await setup();
    const config = configureTestSettings(store.read(), base, [key], false);
    expect(config.allowedTaxCodes).toEqual([source.owners[0]!.taxCode]);
    const provider = new LiveProvider(base, () => false);
    expect(provider.canWrite(key, source)).toBe(false);
    provider.configure(config);
    expect(provider.canWrite(key, source)).toBe(true);
    expect(provider.canWrite("BITONTO||49|20|2", source)).toBe(false);
    expect(() => provider.authorizeWrite(source, "create")).toThrow("solo aggiornamenti");
    expect(() => provider.authorizeWrite(source, "update")).not.toThrow();
    const changedOwner = structuredClone(source); changedOwner.owners[0]!.taxCode = "RSSMRA80A01A893P";
    expect(provider.canWrite(key, changedOwner)).toBe(false);
    provider.configure(configureTestSettings(store.read(), config, [], false));
    expect(provider.canWrite(key, source)).toBe(false);
  });
  it("non ammette record simulati, sconosciuti, incompleti o duplicati", async () => {
    const { store, key } = await setup();
    expect(() => configureTestSettings(store.read(), base, ["sconosciuto"], true)).toThrow();
    expect(() => configureTestSettings(store.read(), base, [key, key], true)).toThrow("distinte");
    await store.change(s => { s.units[key]!.observations[0]!.origin = "simulation"; });
    expect(testSettings(store.read(), base).records[0]!.eligible).toBe(false);
    expect(() => configureTestSettings(store.read(), base, [key], true)).toThrow("correzioni");
    await store.change(s => { s.units[key]!.observations[0]!.origin = "sister"; s.units[key]!.observations[0]!.source.owners[0]!.taxCode = "DA_COMPLETARE"; });
    expect(() => configureTestSettings(store.read(), base, [key], true)).toThrow();
    expect(configureTestSettings(store.read(), base, [], true).allowCreate).toBe(false);
  });
  it("legge la via una volta per confronto ma rilegge il catasto per ciascun immobile", async () => {
    const { source } = await setup();
    const provider = new LiveProvider(base, () => false);
    const port = { assertSession: vi.fn().mockResolvedValue(undefined), listPropertiesByStreet: vi.fn().mockResolvedValue([]), findPropertiesByCadastralIdentity: vi.fn().mockResolvedValue([]) };
    vi.spyOn(provider, "port").mockResolvedValue(port as unknown as TecnocloudUiV2Port);
    provider.beginOperation("compare"); await provider.candidates(street, source); await provider.candidates(street, source);
    expect(port.listPropertiesByStreet).toHaveBeenCalledTimes(1);
    expect(port.findPropertiesByCadastralIdentity).toHaveBeenCalledTimes(2);
    provider.endOperation(); provider.beginOperation("compare"); await provider.candidates(street, source);
    expect(port.listPropertiesByStreet).toHaveBeenCalledTimes(2);
    provider.beginOperation("apply"); await provider.candidates(street, source); await provider.candidates(street, source);
    expect(port.listPropertiesByStreet).toHaveBeenCalledTimes(4);
  });
  it("un inventario fallito resta incompleto e viene riletto solo in una nuova operazione", async () => {
    const { source } = await setup(); const provider = new LiveProvider(base, () => false);
    const port = { assertSession: vi.fn().mockResolvedValue(undefined), listPropertiesByStreet: vi.fn().mockRejectedValueOnce(new Error("Rete interrotta")).mockResolvedValue([]), findPropertiesByCadastralIdentity: vi.fn().mockResolvedValue([]) };
    vi.spyOn(provider, "port").mockResolvedValue(port as unknown as TecnocloudUiV2Port);
    provider.beginOperation("compare");
    await expect(provider.candidates(street, source)).rejects.toThrow("Rete interrotta");
    await expect(provider.candidates(street, source)).rejects.toThrow("Rete interrotta");
    expect(port.findPropertiesByCadastralIdentity).not.toHaveBeenCalled();
    provider.endOperation(); provider.beginOperation("compare"); await provider.candidates(street, source);
    expect(port.listPropertiesByStreet).toHaveBeenCalledTimes(2);
  });
  it("chiude il contesto del provider anche quando il confronto fallisce", async () => {
    const { store } = await setup();
    const provider = new SimulationProvider(store, 0);
    const begin = vi.fn(), end = vi.fn();
    Object.assign(provider, { beginOperation: begin, endOperation: end });
    vi.spyOn(provider, "candidates").mockRejectedValue(new Error("Rete interrotta"));
    const app = new TerritoryApplication(store, provider);
    // The profile of this fixture is real, so reuse a real-origin provider facade.
    Object.defineProperty(provider, "origin", { value: "live" });
    await app.start(street.id, "compare"); await app.waitForIdle();
    expect(begin).toHaveBeenCalledWith("compare"); expect(end).toHaveBeenCalledOnce();
    expect(Object.values(store.read().units)[0]!.assessment?.kind).toBe("unknown");
  });
});
