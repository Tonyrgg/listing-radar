import { describe, expect, it } from "vitest";
import { compareSourceProperties, unitPosition } from "../src/territory/unit-order.js";
import { simulationSource } from "../src/territory/providers.js";
import type { SourceProperty } from "../src/territory/types.js";

function source(address: string, sheet = "1", parcel = "1", subaltern = "1"): SourceProperty {
  const s = simulationSource({ id: "order", name: "VIA 24 MAGGIO", sisterName: "VIA 24 MAGGIO", locality: "Bitonto", geometry: null, geometryEvidence: null, needsReview: false }, 1, "run");
  return { ...s, fullAddress: address, cadastral: { ...s.cadastral, sheet, parcel, subaltern } };
}
const sorted = (rows: SourceProperty[]) => [...rows].sort(compareSourceProperties);
describe("Ordine degli immobili: civico, piano e catasto", () => {
  it("ordina numeri e lettere del civico senza usare piano, interno o il numero del nome della via", () => {
    const rows = ["VIA 24 MAGGIO n. 10 Piano T", "VIA 24 MAGGIO n. 2/B Piano 1", "VIA 24 MAGGIO n. 2 Piano 7", "VIA 24 MAGGIO n. 2/A Piano 1"];
    expect(sorted(rows.map(a => source(a))).map(s => s.fullAddress)).toEqual([rows[2], rows[3], rows[1], rows[0]]);
    expect(unitPosition(source("VIA 24 MAGGIO SCALA 2 INTERNO 4 Piano 7"))).toEqual({ civic: null, floors: [7] });
  });
  it("ordina interrati, terra, piani numerici e infine piano non rilevato", () => {
    const rows = ["VIA ROMA n. 2", "VIA ROMA n. 2 Piano 10", "VIA ROMA n. 2 Piano T", "VIA ROMA n. 2 Piano S1", "VIA ROMA n. 2 Piano 2"];
    expect(sorted(rows.map(a => source(a))).map(s => s.fullAddress)).toEqual([rows[3], rows[2], rows[4], rows[1], rows[0]]);
  });
  it("usa foglio, particella, subalterno come numeri, senza dipendere dall'ordine di acquisizione", () => {
    const address = "VIA ROMA n. 2 Piano 1";
    const rows = [source(address, "10", "1", "1"), source(address, "2", "10", "1"), source(address, "2", "2", "10"), source(address, "2", "2", "2")];
    expect(sorted(rows)).toEqual([rows[3], rows[2], rows[1], rows[0]]);
  });
  it("mette i civici mancanti e SNC dopo quelli noti, conservando l'evidenza originale", () => {
    const rows = [source("VIA ROMA SNC Piano T"), source("VIA ROMA Piano T"), source("VIA ROMA n. 100 Piano 10")];
    const before = structuredClone(rows);
    expect(sorted(rows)[0]).toBe(rows[2]);
    expect(unitPosition(rows[0]!)).toEqual({ civic: ".", floors: [0] });
    expect(rows).toEqual(before);
  });
});
