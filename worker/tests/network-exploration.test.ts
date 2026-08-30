import { describe, expect, it } from "vitest";

import { decideNetworkProperty, extractPropertyFloors, normalizeNetworkSettings, ownerAgeAt } from "../src/core/network-exploration.js";
import { birthDateFromTaxCode } from "../src/core/normalize.js";
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

describe("data di nascita letta dal codice fiscale", () => {
  it("legge anno, mese e giorno di un uomo e di una donna", () => {
    expect(birthDateFromTaxCode("RSSMRA80A01A893P")).toBe("1980-01-01");
    /* Alle donne il giorno e' scritto con quaranta aggiunto. */
    expect(birthDateFromTaxCode("BNCNNA85B41A893K")).toBe("1985-02-01");
  });

  it("rilegge le lettere dell'omocodia come cifre", () => {
    /* U vale 8, L vale 0, M vale 1: stessa data del primo. */
    expect(birthDateFromTaxCode("RSSMRAULA0MA893X")).toBe("1980-01-01");
  });

  it("sceglie il secolo che non cade nel futuro", () => {
    const oggi = new Date("2026-08-30T00:00:00Z");
    expect(birthDateFromTaxCode("RSSMRA30A01A893X", oggi)).toBe("1930-01-01");
    expect(birthDateFromTaxCode("RSSMRA10A01A893X", oggi)).toBe("2010-01-01");
  });

  it("non restituisce una data che non esiste", () => {
    /* 30 febbraio: il calendario lo sposterebbe a marzo. */
    expect(birthDateFromTaxCode("RSSMRA80B30A893X")).toBeNull();
    expect(birthDateFromTaxCode("non-un-codice")).toBeNull();
  });
});

describe("attraversamento della rete", () => {
  const immobile = (parcel: string, category = "A/3") => ({
    municipality: "BITONTO", sheet: "1", parcel, subaltern: "1", address: "VIA TEST n. 1 Piano 1",
    censusZone: null, category, class: null, consistency: null, cadastralIncome: null, rawPayload: {},
  });
  const persona = (taxCode: string) => ({
    fullName: "Persona Test", birthPlace: null, birthProvince: null, birthDate: null, taxCode,
    rightType: "Proprietà", shareOriginal: "1/1", shareNumerator: null, shareDenominator: null,
    sharePercentage: 100, rawPayload: {},
  });
  const GIOVANE = "RSSMRA80A01A893P";   // 1980
  const ALTRO_GIOVANE = "BNCNNA75A01A893X"; // 1975
  const ANZIANO = "VRDLGU30A01A893X";   // 1930, oltre 85

  /**
   * Un immobile scartato dal requisito d'eta' non deve fermare la rete: i
   * suoi comproprietari sono comunque rami da percorrere.
   */
  it("mette in coda i comproprietari anche quando l'immobile non passa il filtro", async () => {
    const salvati: string[] = [];
    const immobiliPerPersona: Record<string, ReturnType<typeof immobile>[]> = {
      [GIOVANE]: [immobile("10")],
      [ALTRO_GIOVANE]: [immobile("20")],
    };
    const proprietariPerParticella: Record<string, ReturnType<typeof persona>[]> = {
      "10": [persona(GIOVANE), persona(ALTRO_GIOVANE)],
      "20": [persona(ALTRO_GIOVANE), persona(ANZIANO)],
    };

    const run = new SisterNetworkRun({
      searchPhysicalPersonByTaxCode: async (taxCode: string) => immobiliPerPersona[taxCode] ?? [],
      extractOwners: async (property: { parcel: string }) => proprietariPerParticella[property.parcel] ?? [],
    } as any, {
      findPropertyByCadastralIdentity: async () => ({ match: null }),
    } as any, {
      insertProperties: async (_jobId: string, properties: any[]) => {
        salvati.push(...properties.map((item) => item.parcel));
        return properties.map((item, index) => ({ ...item, id: `property-${index}` }));
      },
      insertOwner: async () => ({ id: "person-1" }),
    } as any);

    const checkpoint = await run.run("job-1", {
      settings: { minOwnerAge: 85, targetProperties: 10, maxDepth: 3, maxPeople: 10 },
      seeds: [GIOVANE],
    });

    /* La particella 10 non ha proprietari sopra gli 85: scartata. */
    expect(checkpoint.skipped.owner_age_out_of_range).toBe(1);
    /* Ma il comproprietario e' stato visitato lo stesso... */
    expect(checkpoint.visitedTaxCodes).toContain(ALTRO_GIOVANE);
    /* ...e da lui si e' arrivati all'immobile che il requisito lo rispetta. */
    expect(salvati).toEqual(["20"]);
    expect(checkpoint.acceptedProperties).toBe(1);
    /* E la rete prosegue: anche l'anziano trovato entra in coda. */
    expect(checkpoint.visitedTaxCodes).toContain(ANZIANO);
  });

  /**
   * Vale per ogni criterio, non solo per l'eta'.
   *
   * Cambia il modo di calcolare — l'eta' dal codice fiscale, il numero dei
   * proprietari dalla riga, il piano dall'indirizzo — ma la regola e' la
   * stessa: il filtro decide cosa si porta a casa, mai dove si passa. Anche
   * un box rivela con chi si possiede.
   */
  it("attraversa la rete anche da un box e da un immobile con troppi proprietari", async () => {
    const salvati: string[] = [];
    const CONOSCIUTO = "MRRSFN70A01A893X";
    const immobiliPerPersona: Record<string, ReturnType<typeof immobile>[]> = {
      [GIOVANE]: [immobile("40", "C/6"), immobile("41")],
      [ALTRO_GIOVANE]: [immobile("50")],
      [CONOSCIUTO]: [],
    };
    const proprietariPerParticella: Record<string, ReturnType<typeof persona>[]> = {
      /* Un box: categoria non strategica, mai acquisito. */
      "40": [persona(GIOVANE), persona(ALTRO_GIOVANE)],
      /* Tre proprietari, quando il filtro ne ammette al massimo due. */
      "41": [persona(GIOVANE), persona(ALTRO_GIOVANE), persona(CONOSCIUTO)],
      "50": [persona(ALTRO_GIOVANE)],
    };

    const run = new SisterNetworkRun({
      searchPhysicalPersonByTaxCode: async (taxCode: string) => immobiliPerPersona[taxCode] ?? [],
      extractOwners: async (property: { parcel: string }) => proprietariPerParticella[property.parcel] ?? [],
    } as any, {
      findPropertyByCadastralIdentity: async () => ({ match: null }),
    } as any, {
      insertProperties: async (_jobId: string, properties: any[]) => {
        salvati.push(...properties.map((item) => item.parcel));
        return properties.map((item, index) => ({ ...item, id: `property-${index}` }));
      },
      insertOwner: async () => ({ id: "person-1" }),
    } as any);

    const checkpoint = await run.run("job-1", {
      settings: { maxOwnerCount: 2, targetProperties: 10, maxDepth: 3, maxPeople: 10 },
      seeds: [GIOVANE],
    });

    expect(checkpoint.skipped.non_strategic_category).toBe(1);
    expect(checkpoint.skipped.owner_count_out_of_range).toBe(1);
    /* Nessuno dei due immobili e' stato preso, ma entrambi hanno indicato
     * dove proseguire. */
    expect(checkpoint.visitedTaxCodes).toContain(ALTRO_GIOVANE);
    expect(checkpoint.visitedTaxCodes).toContain(CONOSCIUTO);
    /* E dal ramo aperto dal box e' arrivato l'unico immobile buono. */
    expect(salvati).toEqual(["50"]);
  });

  it("l'eta' si ricava dal codice fiscale quando SISTER non stampa la data", async () => {
    const salvati: string[] = [];
    const run = new SisterNetworkRun({
      searchPhysicalPersonByTaxCode: async () => [immobile("30")],
      extractOwners: async () => [persona(ANZIANO)],
    } as any, {
      findPropertyByCadastralIdentity: async () => ({ match: null }),
    } as any, {
      insertProperties: async (_jobId: string, properties: any[]) => {
        salvati.push(...properties.map((item) => item.parcel));
        return properties.map((item, index) => ({ ...item, id: `property-${index}` }));
      },
      insertOwner: async () => ({ id: "person-1" }),
    } as any);

    const checkpoint = await run.run("job-1", {
      settings: { minOwnerAge: 85, targetProperties: 1, maxDepth: 1, maxPeople: 5 },
      seeds: [ANZIANO],
    });

    /* Nessuna data di nascita in nessun proprietario: senza la lettura del
     * codice fiscale questo immobile sarebbe stato scartato. */
    expect(checkpoint.skipped.owner_age_out_of_range).toBe(0);
    expect(salvati).toEqual(["30"]);
  });
});
