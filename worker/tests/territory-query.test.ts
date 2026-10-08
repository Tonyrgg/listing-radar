import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerritoryStore } from "../src/territory/store.js";
import { TerritoryApplication } from "../src/territory/application.js";
import { SimulationProvider } from "../src/territory/providers.js";
import { effectiveSource, type Street } from "../src/territory/model.js";
import { queryCatalog, queryUnitKeys } from "../src/territory/query.js";
import { unitMemory } from "../src/territory/unit-memory.js";
import type { SourceProperty } from "../src/import-v2/model.js";

const street = (id: string): Street => ({ id, name: `Via ${id}`, sisterName: `VIA ${id}`, locality: id === "b" ? "Mariotto" : "Bitonto", geometry: null, geometryEvidence: null, needsReview: false });
const streets = [street("a"), street("b")], directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "territory-query-")); directories.push(directory);
  const store = await TerritoryStore.open(directory, streets);
  let breakApply = false, broken = false, phase = "";
  const routes: [string, string][] = [];
  class Provider extends SimulationProvider {
    beginOperation(operation: string) { phase = operation; }
    override async candidates(s: Street, source: SourceProperty) {
      routes.push([s.id, source.cadastral.parcel]);
      if (breakApply && !broken && phase === "apply" && s.id === "b") { broken = true; throw new Error("Portale interrotto"); }
      return super.candidates(s, source);
    }
  }
  const app = new TerritoryApplication(store, new Provider(store, 0));
  for (const s of streets) { await app.start(s.id, "scan"); await app.waitForIdle(); }
  return { directory, store, app, routes, failOnce: () => { breakApply = true; } };
}
describe("query combinate e zone di vie", () => {
  it("indicizza uno stesso proprietario una sola volta senza perdere le letture originali", async () => {
    const { store } = await setup(), catalog = queryCatalog(store.read());
    expect(catalog.owners).toHaveLength(1); expect(catalog.owners[0]!.properties).toBe(10);
    expect(catalog.owners[0]!.streetIds.sort()).toEqual(["a", "b"]);
    expect(Object.values(store.read().units)).toHaveLength(12);
  });
  it("combina zone, proprietari, categorie e piano senza attribuire un piano sconosciuto", async () => {
    const { app, store, directory } = await setup(), units = app.detail("a").units;
    const zone = await app.saveZone("Centro", ["a"]), cf = units[0]!.source.owners[0]!.taxCode;
    await app.correct(units[0]!.key, { address: "Via a N. 2 Piano 1" }, "Piano rilevato");
    await app.correct(units[1]!.key, { address: "Via a N. 4 Piano 2", category: "C/6" }, "Box");
    const criteria = { zoneIds: [zone], ownerTaxCodes: [cf], categories: ["A/3", "C/6"], floors: [1] };
    expect(queryUnitKeys(store.read(), criteria)).toEqual([units[0]!.key]);
    expect(queryUnitKeys(store.read(), { ...criteria, floors: [1, 2] })).toEqual([units[0]!.key, units[1]!.key]);
    expect(queryUnitKeys(store.read(), { ...criteria, localities: ["Mariotto"] })).toEqual([]);
    const saved = await app.saveQuery("Primi piani", criteria), reopened = await TerritoryStore.open(directory, streets);
    expect(reopened.read().zones![zone]!.streetIds).toEqual(["a"]); expect(reopened.read().savedQueries![saved]!.query.floors).toEqual([1]);
    await app.saveZone("Centro rivisto", ["b"], zone);
    await expect(app.startQuery(criteria, "compare", [units[0]!.key])).rejects.toThrow("selezione non corrisponde");
    expect(() => queryUnitKeys(store.read(), { zoneIds: ["rimossa"] })).toThrow("zona");
  });
  it("un import senza data resta importato ma non soddisfa un filtro di età", async () => {
    const { store } = await setup(), unit = Object.values(store.read().units)[0]!;
    await store.change(s => { s.units[unit.key]!.journal!.push({ id: "undated", kind: "import_completed", at: null, recordedAt: "2026-10-07T10:00:00Z", runId: "legacy", origin: "simulation", message: "Prova verificata", crmId: "known" }); });
    expect(queryUnitKeys(store.read(), { imports: "imported" })).toEqual([unit.key]);
    expect(queryUnitKeys(store.read(), { olderThanDays: 0 })).toEqual([]);
    expect(queryUnitKeys(store.read(), { imports: "never" })).not.toContain(unit.key);
  });
  it("confronta più vie, congela le rotte e riprende dopo il guasto senza perdere il primo successo", async () => {
    const { app, store, directory, routes, failOnce } = await setup();
    const keys = streets.map(s => app.detail(s.id).units[0]!.key);
    await app.startQuery({}, "compare", keys); await app.waitForIdle();
    expect(routes).toEqual([["a", "a"], ["b", "b"]]);
    failOnce(); const run = await app.startQuery({}, "apply", keys); await app.waitForIdle();
    expect(store.read().runs.at(-1)).toMatchObject({ state: "paused", handled: 1, unitStreetIds: { [keys[0]!]: "a", [keys[1]!]: "b" } });
    expect(unitMemory(store.read().units[keys[0]!]!).statistics.verifiedImports).toBe(1);
    expect(unitMemory(store.read().units[keys[1]!]!).statistics.pauses).toBe(1);
    expect(app.detail("b").runs.at(-1)?.id).toBe(run);
    await app.start("a", "apply", [], run); await app.waitForIdle();
    expect(store.read().runs.at(-1)).toMatchObject({ state: "completed", handled: 2 });
    expect(keys.map(k => unitMemory(store.read().units[k]!).statistics.verifiedImports)).toEqual([1, 1]);
    expect(Object.keys(store.read().virtualPeople)).toHaveLength(1);
    expect(routes.every(([s, parcel]) => s === parcel)).toBe(true);
    const reopened = await TerritoryStore.open(directory, streets);
    expect(keys.map(k => effectiveSource(reopened.read().units[k]!).cadastral.parcel)).toEqual(["a", "b"]);
  });
});
