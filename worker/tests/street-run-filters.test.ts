import { describe, expect, it } from "vitest";

import {
  decideStreetProperty,
  normalizeStreetPropertyFilters,
} from "../src/core/network-exploration.js";
import type { CadastralProperty } from "../src/types.js";

function property(overrides: Partial<CadastralProperty> = {}): CadastralProperty {
  return {
    municipality: "BITONTO",
    sheet: "50",
    parcel: "100",
    subaltern: "1",
    address: "VIA TEST n. 12 PIANO 2",
    censusZone: "U",
    category: "A03",
    class: "2",
    consistency: "5 vani",
    cadastralIncome: 400,
    rawPayload: {},
    ...overrides,
  };
}

describe("filtri della via completa", () => {
  it("tiene le abitazioni ed esclude le categorie C quando Solo abitazioni e' attivo", () => {
    const filters = normalizeStreetPropertyFilters({ residentialOnly: true });

    expect(decideStreetProperty(property(), filters)).toEqual({ eligible: true });
    expect(decideStreetProperty(property({ category: "C/6" }), filters)).toEqual({
      eligible: false,
      reason: "non_strategic_category",
    });
    expect(decideStreetProperty(property({ category: "C/6" }), { ...filters, residentialOnly: false })).toEqual({ eligible: true });
  });

  it("applica piano esatto, minimo e massimo usando il piano catastale", () => {
    const exact = normalizeStreetPropertyFilters({ floorMode: "exact", floorValue: 2 });
    expect(decideStreetProperty(property(), exact)).toEqual({ eligible: true });
    expect(decideStreetProperty(property({ address: "VIA TEST n. 12 PIANO 1" }), exact)).toMatchObject({ eligible: false, reason: "floor_out_of_range" });
    expect(decideStreetProperty(property({ address: "VIA TEST n. 12" }), exact)).toMatchObject({ eligible: false, reason: "floor_out_of_range" });
    expect(decideStreetProperty(property(), { ...exact, floorMode: "minimum", floorValue: 1 })).toEqual({ eligible: true });
    expect(decideStreetProperty(property(), { ...exact, floorMode: "maximum", floorValue: 1 })).toMatchObject({ eligible: false, reason: "floor_out_of_range" });
  });

  it("applica l'intervallo civici e ordina automaticamente estremi invertiti", () => {
    const filters = normalizeStreetPropertyFilters({ minCivicNumber: 20, maxCivicNumber: 10 });
    expect(filters).toMatchObject({ minCivicNumber: 10, maxCivicNumber: 20 });
    expect(decideStreetProperty(property(), filters)).toEqual({ eligible: true });
    expect(decideStreetProperty(property({ address: "VIA TEST PIANO 2" }), filters)).toMatchObject({ eligible: false, reason: "civic_out_of_range" });
    expect(decideStreetProperty(property({ address: "VIA TEST n. 25 PIANO 2" }), filters)).toMatchObject({ eligible: false, reason: "civic_out_of_range" });
  });

  it("disattiva il filtro piano se manca il valore", () => {
    expect(normalizeStreetPropertyFilters({ floorMode: "minimum", floorValue: null })).toMatchObject({
      floorMode: "any",
      floorValue: null,
    });
  });
});
