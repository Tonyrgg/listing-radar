import { describe, expect, it } from "vitest";
import { propertyFormValues } from "../src/core/property-form.js";
import type { NormalizedProperty } from "../src/types.js";

const property = (overrides: Partial<NormalizedProperty>): NormalizedProperty => ({
  municipality: "BITONTO", sheet: "50", parcel: "2455", subaltern: "9",
  address: "VIA BORGO SAN FRANCESCO n. 62 Scala A Interno 1 Piano 1",
  censusZone: null, category: "A/2", class: null, consistency: "6 vani",
  cadastralIncome: null, rawPayload: { searchContext: { street: "VIA BORGO SAN FRANCESCO", civicNumber: "62" } },
  ...overrides,
});

describe("dati form immobile CRM", () => {
  it("converte A/2, sei vani e piano 1", () => {
    expect(propertyFormValues(property({}))).toMatchObject({
      type: "Appartamenti", subtype: "4 locali", floor: "Basso", floorNumber: "1",
      street: "Via Borgo San Francesco", civicNumber: "62", internal: "1", staircase: "A",
    });
  });

  it.each([
    ["1,5 vani", "Monolocale"], ["3 vani", "Monolocale"], ["4 vani", "2 locali"], ["5 vani", "3 locali"],
    ["6 vani", "4 locali"], ["7 vani", "5 locali"], ["8 vani", "6 locali"], ["10 vani", "Multilocale"],
  ])("converte %s in %s", (consistency, subtype) => {
    expect(propertyFormValues(property({ consistency })).subtype).toBe(subtype);
  });

  it("usa Box per C/2 e conserva i metri quadri", () => {
    expect(propertyFormValues(property({ category: "C/2", consistency: "3 mq", address: "VIA ROMA n. 7 Piano T" }))).toMatchObject({
      type: "Box / posti auto", subtype: "Box", commercialSquareMeters: 3, floor: "Terra", floorNumber: "", internal: ".",
    });
  });

  it("usa Posto auto soltanto per C/6", () => {
    expect(propertyFormValues(property({ category: "C/6", consistency: "12 mq" })).subtype).toBe("Posto auto");
  });

  it("usa il primo civico della riga SISTER nelle long run anche con un intervallo", () => {
    expect(propertyFormValues(property({
      address: "VIA TOMMASO TRAETTA n. 59-65-67 Piano T-S1",
      category: "C/1",
      rawPayload: { long_run: true, searchContext: { street: "VIA TOMMASO TRAETTA", civicNumber: null } },
    }))).toMatchObject({ street: "Via Tommaso Traetta", civicNumber: "59" });
  });

  it("usa il punto per il senza civico e non include n. SC nel nome", () => {
    expect(propertyFormValues(property({
      address: "VIA MARSALA n. SC Piano T",
      rawPayload: { long_run: true, searchContext: { street: "VIA MARSALA", civicNumber: "18" } },
    }))).toMatchObject({ street: "Via Marsala", civicNumber: "." });
  });

  it("non inserisce l'indirizzo dell'immobile tutto in maiuscolo", () => {
    expect(propertyFormValues(property({
      rawPayload: { searchContext: { street: "VIA DELLE MATINE D'ANNUNZIO", civicNumber: "8" } },
    })).street).toBe("Via Delle Matine D'Annunzio");
  });

  it.each([
    ["Piano S1", "Seminterrato", "-1"], ["Piano 2", "Basso", "2"], ["Piano 3", "Medio", "3"],
    ["Piano 5", "Alto", "5"], ["Piano T-S1", "Su più livelli", ""], ["Piano T-1", "Su più livelli", ""],
  ])("interpreta %s", (suffix, floor, floorNumber) => {
    expect(propertyFormValues(property({ address: `VIA ROMA n. 7 ${suffix}` }))).toMatchObject({ floor, floorNumber });
  });
});
