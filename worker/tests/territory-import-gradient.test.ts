import { describe, expect, it } from "vitest";
import { gradientStops, traceMetrics } from "../src/territory/renderer/import-gradient.js";

const palette = { recent: "green", aging: "yellow", stale: "red", acquired: "blue", never: "gray" };
describe("Gradiente proporzionale lungo le vie", () => {
  it("colloca le transizioni a 33% e 50%, senza riservare spazio a fasce vuote", () => {
    const stops = gradientStops({ total: 100, recent: 33, aging: 0, stale: 17, never: 50, undated: 0 }, palette);
    expect(stops.map(s => s.color)).toEqual(["green", "green", "red", "red", "gray", "gray"]);
    expect((stops[1]!.at + stops[2]!.at) / 2).toBeCloseTo(.33);
    expect((stops[3]!.at + stops[4]!.at) / 2).toBeCloseTo(.5);
    expect(stops.at(-1)!.at).toBe(1);
  });
  it("somma quote esatte, compreso il giallo e import senza data, senza arrotondare a 99%", () => {
    const stops = gradientStops({ total: 3, recent: 1, aging: 1, stale: 0, never: 0, undated: 1 }, palette);
    expect((stops[1]!.at + stops[2]!.at) / 2).toBeCloseTo(1 / 3);
    expect((stops[3]!.at + stops[4]!.at) / 2).toBeCloseTo(2 / 3);
    expect(stops.at(-1)).toEqual({ at: 1, color: "gray" });
  });
  it("non inventa colori per inventari assenti, parziali o vuoti", () => {
    for (const d of [undefined, { total: null, recent: 1 }, { total: null, acquired: 2, imported: 1 }]) expect(gradientStops(d, palette)).toEqual([{ at: 0, color: "gray" }, { at: 1, color: "gray" }]);
  });
  it("separa 20% acquisiti da SISTER e 30% non letti, preservando 33% verde e 17% rosso", () => {
    const stops = gradientStops({ total: 100, recent: 33, stale: 17, acquired: 20, unacquired: 30, never: 50, undated: 0 }, palette);
    expect(stops.map(s => s.color)).toEqual(["green", "green", "red", "red", "blue", "blue", "gray", "gray"]);
    expect((stops[5]!.at + stops[6]!.at) / 2).toBeCloseTo(.7);
  });
  it("mostra il blu per acquisizioni senza Cloud e inventari vuoti conclusi, senza inventare quote parziali", () => {
    for (const d of [{ total: 3, acquired: 3, never: 3 }, { total: null, acquired: 2 }, { total: 0 }]) expect(gradientStops(d, palette)).toEqual([{ at: 0, color: "blue" }, { at: 1, color: "blue" }]);
  });
  it("segue la lunghezza su curve e tratti disconnessi senza colorare i vuoti", () => {
    const metrics = traceMetrics([[{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 4 }, { x: 6, y: 8 }], [{ x: 100, y: 100 }, { x: 106, y: 108 }]]);
    expect(metrics.total).toBe(20);
    expect(metrics.edges.map(e => [e.start, e.length])).toEqual([[0, 5], [5, 5], [10, 10]]);
  });
});
