import { describe, expect, it } from "vitest";
import { mergeRunGraphs, mergedRunIds, validateRunMerge } from "../src/services/run-merge.js";
import type { JobRow, WorkerRepository } from "../src/services/repository.js";

const job = (id: string, street = "Via Test", status = "completed"): JobRow => ({ id, street, municipality: "BITONTO", status, mode: "automatic", current_step: "completed", last_completed_step: "completed", civic_number: null, sister_source_url: null, acquisition: { engine: "lavorazione" } });
type Graph = Awaited<ReturnType<WorkerRepository["loadGraph"]>>;
describe("unione archivio lavorazioni", () => {
  it("consente soltanto lavorazioni concluse della stessa via e conserva gli identificativi origine", () => {
    expect(() => validateRunMerge([job("a"), job("b", " VIA TEST ")])).not.toThrow();
    expect(() => validateRunMerge([job("a"), job("b", "Via Altra")])).toThrow();
    expect(() => validateRunMerge([job("a"), job("b", "Via Test", "paused")])).toThrow();
    expect(mergedRunIds({ ...job("a"), acquisition: { mergedRunIds: ["a", "b", "b", "c"] } })).toEqual(["b", "c"]);
  });
  it("deduplica la sovrapposizione privilegiando l'eseguito e conserva quote e persone del risultato verificato", () => {
    const first = { properties: [{ id: "a", cadastral_key: "K1", processing_status: "quarantined" }], people: [{ id: "pa" }], ownerships: [{ property_id: "a", person_id: "pa" }] } as Graph;
    const second = { properties: [{ id: "b", cadastral_key: "K1", processing_status: "synced" }, { id: "c", cadastral_key: "K2", processing_status: "synced" }], people: [{ id: "pb" }], ownerships: [{ property_id: "b", person_id: "pb", share_percentage: 50 }] } as Graph;
    const originals = structuredClone([first, second]);
    const merged = mergeRunGraphs([first, second]);
    expect(merged.properties.map((p) => p.id)).toEqual(["b", "c"]);
    expect(merged.ownerships[0]?.share_percentage).toBe(50);
    expect(merged.people.map((p) => p.id)).toEqual(["pb"]);
    expect([first, second]).toEqual(originals);
  });
});
