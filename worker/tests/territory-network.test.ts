import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildNetwork, type NetworkWay } from "../src/territory/network.js";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { SimulationProvider } from "../src/territory/providers.js";
import type { Street } from "../src/territory/model.js";
import { matchHistoricalStreet } from "../src/territory/history.js";
import { simulationSource } from "../src/territory/providers.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const way = (id: number, name = "Via della prova", longitude = 16.69): NetworkWay => ({ type: "way", id, tags: { highway: "residential", name }, nodes: [id * 2, id * 2 + 1], geometry: [{ lat: 41.11, lon: longitude }, { lat: 41.111, lon: longitude }] });
const official: Street = { id: "20", name: "Via della prova", sisterName: "VIA DELLA PROVA", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false, catalogKind: "official" };
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "territory-network-test-")); directories.push(directory);
  const network = buildNetwork([way(10)], new Set(), []);
  const streets = [official, ...network]; const store = await TerritoryStore.open(directory, streets);
  const app = new TerritoryApplication(store, new SimulationProvider(store, 0));
  return { app, store, streets, directory, networkId: network[0]!.id };
}
describe("Rete e dossier prima delle lavorazioni", () => {
  it("crea tutte le schede, apribili e annotabili senza immobili o operazioni", async () => {
    const { app, store, networkId, directory, streets } = await setup();
    expect(Object.keys(store.read().memories)).toHaveLength(2);
    expect(app.detail(networkId).street.status).toBe("unseen");
    expect(app.detail(networkId).street.geometry).not.toBeNull();
    expect(app.detail(official.id).units).toHaveLength(0);
    await app.annotate(networkId, "Nota prima di acquisire", false);
    const reopened = await TerritoryStore.open(directory, streets);
    expect(reopened.read().memories[networkId]!.note).toBe("Nota prima di acquisire");
    expect(reopened.read().memories[networkId]!.registeredAt).toBeTruthy();
    expect(reopened.read().runs).toHaveLength(0);
  });
  it("unisce solo tratti omonimi con continuità documentata, conserva quelli lontani", () => {
    const a = way(10), b = way(11, "Via della prova", 16.691), c = way(12, "Via della prova", 16.60);
    b.nodes = [21, 22];
    const streets = buildNetwork([a, b, c], new Set(), []);
    expect(streets).toHaveLength(2);
    expect(streets.find(s => s.id === "network:10")!.osmWayIds).toEqual([10, 11]);
    expect(streets.find(s => s.id === "network:12")!.osmWayIds).toEqual([12]);
  });
  it("esclude tracciati già associati, duplicati, coordinate errate e percorsi fuori ambito", () => {
    const outside = way(14); outside.geometry![0]!.lat = 45;
    const invalid = way(15); invalid.geometry![0]!.lon = NaN;
    expect(buildNetwork([way(10), way(11), way(11), outside, invalid], new Set([10]), [])).toHaveLength(1);
  });
  it("i tratti senza nome hanno dossier distinti e richiedono un'associazione prima di acquisire", async () => {
    const streets = buildNetwork([way(10, ""), way(11, "")], new Set(), []);
    expect(streets).toHaveLength(2); expect(streets.every(s => s.needsReview && !s.sisterName)).toBe(true);
    expect(streets.map(s => s.name)).toEqual(["Tratto senza nome 10", "Tratto senza nome 11"]);
    const { directory } = await setup();
    const store = await TerritoryStore.open(directory, streets);
    const app = new TerritoryApplication(store, new SimulationProvider(store, 0));
    await expect(app.start(streets[0]!.id, "scan")).rejects.toThrow("Associa il tratto");
    expect(store.read().runs).toHaveLength(0);
  });
  it("un'associazione conserva note, immobili e operazioni, e resiste al setup successivo", async () => {
    const { app, store, streets, networkId, directory } = await setup();
    await app.annotate(networkId, "Nota sul tracciato", true);
    await app.annotate(official.id, "Nota ufficiale confermata", false);
    await app.start(networkId, "scan"); await app.waitForIdle();
    await app.bindNetwork(networkId, official.id);
    expect(app.detail(official.id).units).toHaveLength(6);
    expect(app.detail(official.id).runs).toHaveLength(1);
    expect(app.detail(official.id).memory.note).toBe("Nota ufficiale confermata");
    expect(app.detail(official.id).linkedNotes[0]!.note).toBe("Nota sul tracciato");
    expect(app.detail(networkId).street.id).toBe(official.id);
    expect(app.snapshot().streets).toHaveLength(1);
    expect(app.detail(official.id).street.attention).toBe(true);
    expect(app.detail(official.id).memory.attention).toBe(true);
    await app.annotate(official.id, "Nota ufficiale confermata", false);
    expect(app.detail(official.id).street.attention).toBe(false);
    expect(app.detail(official.id).linkedNotes[0]!.note).toBe("Nota sul tracciato");
    const reopened = await TerritoryStore.open(directory, streets);
    const next = new TerritoryApplication(reopened, new SimulationProvider(reopened, 0));
    expect(next.detail(official.id).street.geometry).not.toBeNull();
    expect(next.detail(official.id).units).toHaveLength(6);
    expect(store.read().units).toEqual(reopened.read().units);
    await next.start(official.id, "compare"); await next.waitForIdle();
    expect(next.detail(official.id).units.some(u => u.assessment?.kind === "create")).toBe(true);
    await expect(next.bindNetwork(networkId, official.id)).rejects.toThrow("già associato");
    const confirmed = next.detail(official.id).street.geometry;
    const changedCatalog = structuredClone(streets);
    changedCatalog.find(s => s.id === networkId)!.geometry = { type: "LineString", coordinates: [[16.60, 41.10], [16.61, 41.11]] };
    const updated = await TerritoryStore.open(directory, changedCatalog);
    expect(new TerritoryApplication(updated, new SimulationProvider(updated, 0)).detail(official.id).street.geometry).toEqual(confirmed);
  });
  it("non usa nomi della rete per cambiare le associazioni canoniche dello storico", async () => {
    const { streets, networkId } = await setup();
    const source = simulationSource(official, 1, "run");
    expect(matchHistoricalStreet(source, streets).map(s => s.id)).toEqual([official.id]);
    expect(() => matchHistoricalStreet(source, streets, networkId)).toThrow("Codvia");
  });
});
