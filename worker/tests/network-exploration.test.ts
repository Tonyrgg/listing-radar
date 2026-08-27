import { describe, expect, it } from "vitest";

import { decideNetworkProperty, normalizeNetworkSettings } from "../src/core/network-exploration.js";
import { SisterNetworkRun } from "../src/services/sister-network-run.js";

const property = (category: string) => ({ municipality: "BITONTO", sheet: "1", parcel: "2", subaltern: "3", address: "Via Test, 1", censusZone: null, category, class: null, consistency: null, cadastralIncome: null, rawPayload: {} });
const owner = (sharePercentage: number | null) => ({ fullName: "Persona Test", birthPlace: null, birthProvince: null, birthDate: null, taxCode: "RSSMRA80A01A893P", rightType: "Proprietà", shareOriginal: "1/1", shareNumerator: null, shareDenominator: null, sharePercentage, rawPayload: {} });

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
});
