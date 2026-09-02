import { describe, expect, it } from "vitest";

import {
  addressIdentity,
  buildPlan,
  choosePropertyCandidate,
  propertyNameToAddress,
  sameAddress,
  sameCadastralIdentity,
} from "../src/import-v2/identity.js";
import type { SourceProperty } from "../src/import-v2/model.js";

const source = (overrides: Partial<SourceProperty> = {}): SourceProperty => ({
  sourcePropertyId: "property-1",
  jobId: "job-1",
  municipality: "BITONTO",
  fullAddress: "Via Publio Virgilio Marone 2 [25], 70032 BITONTO (BA)",
  cadastral: {
    urbanSection: null,
    sheet: "49",
    parcel: "1243",
    parcelDenomination: null,
    subaltern: "34",
    income: 356.36,
  },
  category: "A/2",
  propertyClass: "3",
  consistency: "6 vani",
  activity: { enabled: true, description: "Contatto proprietario", contactMode: "Contatto diretto", status: "Da eseguire" },
  owners: [{
    sourcePersonId: "person-1",
    taxCode: "RSSMRA80A01A893P",
    fullName: "Rossi Mario",
    birthDate: "1980-01-01",
    birthPlace: "Bitonto",
    birthProvince: "BA",
    rightType: "Proprietà",
    sharePercentage: 100,
    contacts: { phones: [], emails: [] },
  }],
  ...overrides,
});

describe("Import V2 identity", () => {
  it("estrae dal nome CRM solo l'indirizzo e conserva l'interno tra quadre", () => {
    expect(propertyNameToAddress("IM - Via Publio Virgilio Marone 2 [25] - Abbadessa"))
      .toBe("Via Publio Virgilio Marone 2 [25]");
    expect(addressIdentity("IM - Via Publio Virgilio Marone 2 [25] - Abbadessa"))
      .toEqual({ street: "VIA PUBLIO VIRGILIO MARONE", civic: "2", internal: "25", location: null });
  });

  it("non considera uguali due indirizzi completi in Comuni differenti", () => {
    expect(sameAddress(
      "Via Francia 10, 70032 BITONTO (BA)",
      "Via Francia 10, 70100 BARI (BA)",
    )).toBe(false);
  });

  it("considera la rendita italiana equivalente al numero decimale", () => {
    expect(sameCadastralIdentity(source().cadastral, {
      urbanSection: "",
      sheet: "49",
      parcel: "1243",
      parcelDenomination: "",
      subaltern: "34",
      income: 356.36,
    })).toBe(true);
  });

  it("conserva e accetta i dati CRM quando il corrispondente valore SISTER è assente", () => {
    expect(sameCadastralIdentity({
      ...source().cadastral,
      urbanSection: null,
      parcelDenomination: null,
      income: null,
    }, {
      ...source().cadastral,
      urbanSection: "U",
      parcelDenomination: "LOTTO A",
      income: 712.71,
    })).toBe(true);
  });

  it("continua a rifiutare un valore CRM diverso quando SISTER lo fornisce", () => {
    expect(sameCadastralIdentity(source().cadastral, {
      ...source().cadastral,
      parcel: "999",
    })).toBe(false);
  });

  it("sceglie il match esatto fra più immobili dello stesso nominativo", () => {
    const result = choosePropertyCandidate(source(), [
      { id: "wrong-internal", displayName: "IM - Via Publio Virgilio Marone 2 [26] - Abbadessa", fullAddress: null, cadastral: null },
      { id: "right", displayName: "IM - Via Publio Virgilio Marone 2 [25] - Abbadessa", fullAddress: null, cadastral: source().cadastral },
      { id: "other", displayName: "IM - Via Publio Virgilio Marone 4 - Abbadessa", fullAddress: null, cadastral: null },
    ]);
    expect(result).toMatchObject({ kind: "exact", candidate: { id: "right" } });
  });

  it("riusa l'indirizzo unico e richiede l'aggiornamento catastale", () => {
    const result = choosePropertyCandidate(source(), [{
      id: "address-only",
      displayName: "IM - Via Publio Virgilio Marone 2 [25] - Abbadessa",
      fullAddress: null,
      cadastral: { ...source().cadastral, parcel: "999" },
    }]);
    expect(result).toMatchObject({ kind: "address_update", candidate: { id: "address-only" } });
  });

  it("non sceglie arbitrariamente fra immobili indistinguibili", () => {
    const withoutInternal = source({ fullAddress: "Via Publio Virgilio Marone 2, 70032 BITONTO (BA)" });
    expect(() => choosePropertyCandidate(withoutInternal, [
      { id: "a", displayName: "IM - Via Publio Virgilio Marone 2 - Abbadessa", fullAddress: null, cadastral: null },
      { id: "b", displayName: "IM - Via Publio Virgilio Marone 2 - Centro", fullAddress: null, cadastral: null },
    ])).toThrow(/Più immobili condividono l'indirizzo/);
  });

  it("rifiuta il piano prima delle scritture se un intestatario non ha CF", () => {
    expect(() => buildPlan(source({ owners: [{ ...source().owners[0]!, taxCode: "" }] })))
      .toThrow(/codice fiscale utilizzabile/);
  });

  it("accantona un immobile se SISTER segnala un'azienda", () => {
    const baseOwner = source().owners[0]!;
    expect(() => buildPlan(source({ owners: [
      baseOwner,
      { ...baseOwner, sourcePersonId: "company", taxCode: "01234567890", fullName: "Società Test S.r.l." },
    ] }))).toThrow(/soggetto aziendale/);
  });

  it("ignora l'usufrutto ma conserva proprietà e nuda proprietà", () => {
    const baseOwner = source().owners[0]!;
    const plan = buildPlan(source({ owners: [
      baseOwner,
      { ...baseOwner, sourcePersonId: "bare", taxCode: "VRDLCU82B02A893X", rightType: "Nuda proprietà" },
      { ...baseOwner, sourcePersonId: "usufruct", taxCode: "BNCNNA85B41A893K", rightType: "Usufrutto" },
    ] }));
    expect(plan.source.owners.map((owner) => owner.sourcePersonId)).toEqual(["person-1", "bare"]);
  });
});
