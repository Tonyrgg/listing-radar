import { describe, expect, it } from "vitest";

import { decideNetworkProperty, extractPropertyFloors, normalizeNetworkSettings, ownerAgeAt } from "../src/core/network-exploration.js";
import { SisterNetworkRun } from "../src/services/sister-network-run.js";

const property = (category: string, address = "VIA TEST n. 1 Piano T") => ({ municipality: "BITONTO", sheet: "1", parcel: "2", subaltern: "3", address, censusZone: null, category, class: null, consistency: null, cadastralIncome: null, rawPayload: {} });
const owner = (sharePercentage: number | null, birthDate: string | null = null, taxCode = "RSSMRA80A01A893P") => ({ fullName: "Persona Test", birthPlace: null, birthProvince: null, birthDate, taxCode, rightType: "Proprietà", shareOriginal: "1/1", shareNumerator: null, shareDenominator: null, sharePercentage, rawPayload: {} });

describe("rete proprietaria", () => {
  it("esclude box e cantine prima che consumino uno slot", () => {
    expect(decideNetworkProperty(property("C/6"), [owner(100)], normalizeNetworkSettings({}), false)).toEqual({ eligible: false, reason: "non_strategic_category" });
  });

  it("non accetta un immobile CRM quando la run cerca solo nuovi immobili", () => {
    expect(decideNetworkProperty(property("A/3"), [owner(100)], normalizeNetworkSettings({}), true)).toEqual({ eligible: false, reason: "already_in_crm" });
  });

  it("accetta l'aggiornamento esplicito e applica la quota minima", () => {
    const settings = normalizeNetworkSettings({ existingPropertyPolicy: "include_existing", minSharePercentage: 50 });
    expect(decideNetworkProperty(property("A/3"), [owner(25)], settings, true)).toEqual({ eligible: false, reason: "share_below_minimum" });
    expect(decideNetworkProperty(property("A/3"), [owner(50)], settings, true)).toEqual({ eligible: true, kind: "existing_update" });
  });

  it("interpreta terra, seminterrato e immobili su più piani", () => {
    expect(extractPropertyFloors("VIA TEST n. 4 Piano T-S1")).toEqual([0, -1]);
    expect(extractPropertyFloors("VIA TEST n. 4 Piano 3-4")).toEqual([3, 4]);
    expect(decideNetworkProperty(
      property("A/3", "VIA TEST n. 4 Piano 3-4"),
      [owner(100)],
      normalizeNetworkSettings({ floorMode: "minimum", floorValue: 4 }),
      false,
    )).toEqual({ eligible: true, kind: "new" });
    expect(decideNetworkProperty(
      property("A/3", "VIA TEST n. 4 Piano 3-4"),
      [owner(100)],
      normalizeNetworkSettings({ floorMode: "maximum", floorValue: 2 }),
      false,
    )).toEqual({ eligible: false, reason: "floor_out_of_range" });
  });

  it("filtra età, numero dei proprietari e primo civico della riga", () => {
    const settings = normalizeNetworkSettings({
      minOwnerAge: 65, maxOwnerAge: 80, minOwnerCount: 2, maxOwnerCount: 3,
      minCivicNumber: 50, maxCivicNumber: 70,
    });
    const owners = [owner(50, "1956-09-10"), owner(50, "1980-01-01", "BNCLCU80A01A893X")];
    expect(ownerAgeAt("1956-09-10", new Date("2026-08-27T00:00:00Z"))).toBe(69);
    expect(decideNetworkProperty(
      property("A/3", "VIA TOMMASO TRAETTA n. 59-65-67 Piano T"), owners, settings, false,
      new Date("2026-08-27T00:00:00Z"),
    )).toEqual({ eligible: true, kind: "new" });
    expect(decideNetworkProperty(
      property("A/3", "VIA TOMMASO TRAETTA n. 71 Piano T"), owners, settings, false,
      new Date("2026-08-27T00:00:00Z"),
    )).toEqual({ eligible: false, reason: "civic_out_of_range" });
  });

  it("non accetta età sconosciute quando è richiesta una fascia", () => {
    expect(decideNetworkProperty(
      property("A/3"), [owner(100)], normalizeNetworkSettings({ minOwnerAge: 60 }), false,
    )).toEqual({ eligible: false, reason: "owner_age_out_of_range" });
  });

  it("salva soltanto gli immobili che superano i filtri prima del limite", async () => {
    const saved: string[] = [];
    const run = new SisterNetworkRun({
      searchPhysicalPersonByTaxCode: async () => [property("C/6"), property("A/3")],
      extractOwners: async () => [owner(100)],
    } as any, {
      findPropertyByCadastralIdentity: async () => ({ match: null }),
    } as any, {
      insertProperties: async (_jobId: string, properties: any[]) => {
        saved.push(...properties.map((item) => item.category));
        return properties.map((item, index) => ({ ...item, id: `property-${index}` }));
      },
      insertOwner: async () => ({ id: "person-1" }),
    } as any);
    const checkpoint = await run.run("job-1", { settings: { targetProperties: 1 }, seeds: ["RSSMRA80A01A893P"] });
    expect(saved).toEqual(["A/3"]);
    expect(checkpoint.acceptedProperties).toBe(1);
    expect(checkpoint.skipped.non_strategic_category).toBe(1);
  });

  it("scarta i filtri operativi prima di interrogare il CRM", async () => {
    const crmChecks: string[] = [];
    const run = new SisterNetworkRun({
      searchPhysicalPersonByTaxCode: async () => [
        property("A/3", "VIA TEST n. 10 Piano 1"),
        { ...property("A/3", "VIA TEST n. 55 Piano 4"), parcel: "3" },
      ],
      extractOwners: async (item: { parcel: string }) => item.parcel === "2"
        ? [owner(100, "1980-01-01")]
        : [owner(50, "1950-01-01"), owner(50, "1960-01-01", "BNCLCU60A01A893X")],
    } as any, {
      findPropertyByCadastralIdentity: async (item: { parcel: string }) => {
        crmChecks.push(item.parcel);
        return { match: null };
      },
    } as any, {
      insertProperties: async (_jobId: string, properties: any[]) => properties.map((item) => ({ ...item, id: `property-${item.parcel}` })),
      insertOwner: async () => ({ id: "person-1" }),
    } as any);

    const checkpoint = await run.run("job-1", {
      settings: { targetProperties: 1, floorMode: "minimum", floorValue: 3, minOwnerAge: 60, minOwnerCount: 2, minCivicNumber: 50, maxCivicNumber: 60 },
      seeds: ["RSSMRA80A01A893P"],
    });

    expect(crmChecks).toEqual(["3"]);
    expect(checkpoint.acceptedProperties).toBe(1);
    expect(checkpoint.skipped.owner_count_out_of_range).toBe(1);
  });
});
