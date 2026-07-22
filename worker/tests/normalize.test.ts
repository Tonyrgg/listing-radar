import { describe, expect, it } from "vitest";

import { addressIdentity, buildCadastralKey, consolidateContacts, formatPersonName, formatShareForUi, genderFromTaxCode, normalizeTaxCode, parsePropertyAddress, parseShare, samePropertyAddress, sameStreetAndCivic, splitPersonName } from "../src/core/normalize.js";

describe("normalizzazione codice fiscale", () => {
  it("rimuove spazi e caratteri invisibili e converte in maiuscolo", () => {
    expect(normalizeTaxCode(" cqv\u200bmrs49l66 a893r ")).toBe("CQVMRS49L66A893R");
  });

  it("ricava il sesso dal giorno codificato", () => {
    expect(genderFromTaxCode("MRGMHL65B09A893K")).toBe("M");
    expect(genderFromTaxCode("CQVMRS49L66A893R")).toBe("F");
    expect(genderFromTaxCode("NON-VALIDO")).toBeNull();
  });
});

describe("formattazione anagrafica", () => {
  it("usa la maiuscola iniziale per nome e cognome", () => {
    expect(formatPersonName("MICHELE MURGOLO")).toBe("Michele Murgolo");
    expect(formatPersonName("D'ANGELO MARIA-ROSARIA")).toBe("D'Angelo Maria-Rosaria");
  });
});

describe("quota", () => {
  it.each([["1/1", 100], ["500/1000", 50], ["333/1000", 33.3], ["125/1000", 12.5]])("converte %s", (input, expected) => {
    expect(parseShare(input).percentage).toBe(expected);
  });
  it("mantiene un numero e usa la virgola solo per la UI", () => {
    expect(formatShareForUi(33.3)).toBe("33,3");
  });
});

describe("consolidamento recapiti", () => {
  it("deduplica e assegna l'overflow", () => {
    const result = consolidateContacts("ABC", [
      { mobile: "333 111 2222", landline: "0801234", email: "TEST@EXAMPLE.IT", whatsapp: "3331112222" },
      { mobile: "3331112222", landline: "080 5678", email: "test@example.it" },
    ]);
    expect(result.mobiles).toEqual(["3331112222"]);
    expect(result.landlines).toEqual(["0801234", "0805678"]);
    expect(result.emails).toEqual(["test@example.it"]);
    expect(result.overflowPhones).toEqual(["0805678"]);
  });
});

it("costruisce la chiave catastale tecnica", () => {
  expect(buildCadastralKey({ municipality: " bitonto ", sheet: "58", parcel: "1234", subaltern: "7" })).toBe("BITONTO|58|1234|7");
});

describe("confronto indirizzo immobile", () => {
  it("riconosce via e civico identici nonostante punteggiatura e maiuscole", () => {
    expect(sameStreetAndCivic("Via Roma, 12/A", "VIA ROMA 12 A")).toBe(true);
  });

  it("non considera esatto un civico o una via differente", () => {
    expect(sameStreetAndCivic("Via Roma 12", "Via Roma 14")).toBe(false);
    expect(sameStreetAndCivic("Via Roma 12", "Via Dante 12")).toBe(false);
  });

  it("separa interno e località dall'indirizzo completo del CRM", () => {
    expect(parsePropertyAddress("Via Borgo San Francesco 29 [2], 70032 BITONTO (BA)")).toEqual({
      address: "Via Borgo San Francesco 29",
      internal: "2",
      postalCode: "70032",
      municipality: "BITONTO",
      province: "BA",
    });
    expect(addressIdentity("Via Borgo San Francesco 29 [2], 70032 BITONTO (BA)")).toEqual({
      street: "VIA BORGO SAN FRANCESCO",
      civic: "29",
      internal: "2",
    });
  });

  it("confronta soltanto via e civico ignorando interno, CAP e località", () => {
    expect(sameStreetAndCivic(
      "Via Borgo San Francesco 29 [2], 70032 BITONTO (BA)",
      "VIA BORGO SAN FRANCESCO, 29",
    )).toBe(true);
  });

  it("riconosce il formato SISTER e usa l'interno quando è presente su entrambi i lati", () => {
    expect(parsePropertyAddress("VIA BORGO SAN FRANCESCO n. 29 Scala B Interno 2 Piano 1")).toMatchObject({
      address: "VIA BORGO SAN FRANCESCO 29",
      internal: "2",
    });
    expect(samePropertyAddress(
      "Via Borgo San Francesco 29 [2], 70032 BITONTO (BA)",
      "VIA BORGO SAN FRANCESCO n. 29 Scala B Interno 2 Piano 1",
    )).toBe(true);
    expect(samePropertyAddress(
      "Via Borgo San Francesco 29 [2], 70032 BITONTO (BA)",
      "VIA BORGO SAN FRANCESCO n. 29 Scala B Interno 3 Piano 1",
    )).toBe(false);
  });
});

it("separa nome e cognome usando il codice fiscale come verifica", () => {
  expect(splitPersonName("ACQUAVIVA MARIA ROSARIA", "CQVMRS49L66A893R")).toEqual({
    firstName: "MARIA ROSARIA",
    lastName: "ACQUAVIVA",
    verified: true,
  });
});
