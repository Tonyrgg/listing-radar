import { describe, expect, it } from "vitest";

import {
  addressIdentity,
  buildPlan,
  choosePropertyCandidate,
  formatStreetName,
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
  it.each([null, 0, -1, 101, NaN])("rifiuta una quota %s anche per sorgenti che non passano dal database", share => {
    const input = source();
    input.owners[0]!.sharePercentage = share;
    expect(() => buildPlan(input)).toThrow(/Quota/);
  });

  it.each(["sheet", "parcel", "subaltern"] as const)("rifiuta un piano senza %s prima di cercare o creare nel CRM", key => {
    const input = source();
    input.cadastral[key] = " ";
    expect(() => buildPlan(input)).toThrow(/catastali/);
  });
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

  it("riconosce lo stesso indirizzo senza civico anche con i placeholder aggiunti dal CRM", () => {
    expect(sameAddress(
      "VIALE ITALIA n. NC Piano T",
      "VIALE ITALIA n. NC . [.], 70032 BITONTO (BA)",
    )).toBe(true);
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

  it("riusa il catasto univoco e aggiorna l'indirizzo dalla fonte SISTER", () => {
    const result = choosePropertyCandidate(source(), [{
      id: "cadastral-only",
      displayName: "IM - Vecchio indirizzo 99",
      fullAddress: "Vecchio indirizzo 99, 70032 BITONTO (BA)",
      cadastral: source().cadastral,
    }]);
    expect(result).toMatchObject({ kind: "cadastral_update", candidate: { id: "cadastral-only" } });
  });

  it("non sceglie arbitrariamente fra più immobili con lo stesso catasto", () => {
    expect(() => choosePropertyCandidate(source(), [
      { id: "cadastral-a", displayName: "IM - Vecchio indirizzo 1", fullAddress: null, cadastral: source().cadastral },
      { id: "cadastral-b", displayName: "IM - Vecchio indirizzo 2", fullAddress: null, cadastral: source().cadastral },
    ])).toThrow(/Più immobili condividono lo stesso catasto/);
  });

  it("non sceglie arbitrariamente fra immobili indistinguibili", () => {
    const withoutInternal = source({ fullAddress: "Via Publio Virgilio Marone 2, 70032 BITONTO (BA)" });
    expect(() => choosePropertyCandidate(withoutInternal, [
      { id: "a", displayName: "IM - Via Publio Virgilio Marone 2 - Abbadessa", fullAddress: null, cadastral: null },
      { id: "b", displayName: "IM - Via Publio Virgilio Marone 2 - Centro", fullAddress: null, cadastral: null },
    ])).toThrow(/Più immobili condividono l'indirizzo/);
  });

  // Via Re Manfredi 21: quattordici unita' allo stesso civico, foglio 40 e
  // particella 213, distinte solo dal subalterno. Le due schede gia' nel
  // gestionale portano la particella in "Denom Particella".
  const buildingUnit = (subaltern: string) => source({
    fullAddress: "VIA RE MANFREDI n. 21 Piano 2",
    cadastral: { urbanSection: null, sheet: "40", parcel: "213", parcelDenomination: null, subaltern, income: null },
  });
  const crmUnit = (id: string, subaltern: string, owner: string, income: number) => ({
    id,
    displayName: `Immobile IM - Via Re Manfredi 21 [.] - ${owner}`,
    fullAddress: "Via Re Manfredi 21 [.], 70032 BITONTO (BA)",
    cadastral: { urbanSection: "BA", sheet: "40", parcel: "", parcelDenomination: "213", subaltern, income },
  });

  it("riconosce la stessa unita' quando il gestionale tiene la particella fra le denominazioni", () => {
    const result = choosePropertyCandidate(buildingUnit("51"), [
      crmUnit("lorusso", "51", "Lorusso", 477.72),
      crmUnit("boccapianola", "52", "Boccapianola", 772.1),
    ]);
    expect(result).toMatchObject({ kind: "exact", candidate: { id: "lorusso" } });
  });

  it("crea l'unita' mancante invece di fermarsi sulle altre unita' dello stesso stabile", () => {
    const result = choosePropertyCandidate(buildingUnit("47"), [
      crmUnit("lorusso", "51", "Lorusso", 477.72),
      crmUnit("boccapianola", "52", "Boccapianola", 772.1),
    ]);
    expect(result).toMatchObject({ kind: "create", candidate: null });
  });

  it("resta in ambiguita' se una scheda dello stesso indirizzo non espone il subalterno", () => {
    expect(() => choosePropertyCandidate(buildingUnit("47"), [
      crmUnit("lorusso", "51", "Lorusso", 477.72),
      { ...crmUnit("senza-catasto", "", "Ignoto", 0), cadastral: null },
    ])).toThrow(/Più immobili condividono l'indirizzo/);
  });

  it("scrive le vie con la sola iniziale maiuscola, non come le manda SISTER", () => {
    expect(formatStreetName("VIA RE MANFREDI")).toBe("Via Re Manfredi");
    expect(formatStreetName("VIALE GIOVANNI XXIII")).toBe("Viale Giovanni Xxiii");
    expect(formatStreetName("VICO SANT'ANNA")).toBe("Vico Sant'Anna");
    expect(formatStreetName("  via   marsala  ")).toBe("Via Marsala");
  });

  it("non cambia il riconoscimento dell'indirizzo, che confronta a maiuscole normalizzate", () => {
    expect(sameAddress("VIA MARSALA n. 4 Piano T", "Via Marsala 4 [.], 70032 BITONTO (BA)")).toBe(true);
  });

  // Chi scrive l'indirizzo nel gestionale si ferma al civico e toglie scala ed
  // edificio: chi confronta deve fare lo stesso, o rifiuta un immobile appena
  // creato con l'indirizzo giusto.
  it("toglie la scala dall'indirizzo come fa chi lo scrive", () => {
    expect(addressIdentity("VIALE GIOVANNI XXIII n. 195 Scala A Interno 10 Piano 3"))
      .toEqual({ street: "VIALE GIOVANNI XXIII", civic: "195", internal: "10", location: null });
  });

  it("non scambia il numero di scala per il civico", () => {
    expect(addressIdentity("VIALE GIOVANNI XXIII n. 225 Scala 6 Interno 4 Piano 2"))
      .toEqual({ street: "VIALE GIOVANNI XXIII", civic: "225", internal: "4", location: null });
  });

  it("riconosce nel gestionale l'immobile con scala appena scritto da SISTER", () => {
    expect(sameAddress(
      "VIALE GIOVANNI XXIII n. 195 Scala A Interno 10 Piano 3",
      "Viale Giovanni Xxiii 195 [10], 70032 BITONTO (BA)",
    )).toBe(true);
    expect(sameAddress(
      "VIALE GIOVANNI XXIII n. 225 Scala 6 Interno 4 Piano 2",
      "Viale Giovanni Xxiii 225 [4], 70032 BITONTO (BA)",
    )).toBe(true);
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
