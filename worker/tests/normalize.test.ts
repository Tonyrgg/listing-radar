import { describe, expect, it } from "vitest";

import { addressIdentity, buildCadastralKey, consolidateContacts, extractFirstCivicNumber, formatPersonName, formatShareForUi, genderFromTaxCode, normalizeTaxCode, parsePropertyAddress, parseShare, samePropertyAddress, samePropertyAddressWithMissingCivicSuffix, sameStreetAndCivic, selectSisterAddressForStreet, splitPersonName } from "../src/core/normalize.js";

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
    expect(formatShareForUi(100 / 3)).toBe("33,33");
    expect(formatShareForUi(12.3456)).toBe("12,35");
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
  it("prende il primo civico da una riga SISTER con civici doppi", () => {
    expect(extractFirstCivicNumber("VIA TOMMASO TRAETTA n. 59-65-67 Piano T-S1")).toBe("59");
    expect(addressIdentity("VIA TOMMASO TRAETTA n. 59-65-67 Piano T-S1")).toMatchObject({ street: "VIA TOMMASO TRAETTA", civic: "59" });
  });
  it("conserva la lettera del civico SISTER dopo la barra", () => {
    expect(extractFirstCivicNumber("VIALE GIOVANNI XXIII n. 195/C Piano S1-T - 1-2")).toBe("195C");
    expect(addressIdentity("VIALE GIOVANNI XXIII n. 195/C Piano S1-T - 1-2")).toMatchObject({
      street: "VIALE GIOVANNI XXIII",
      civic: "195C",
    });
  });
  it("recupera solo il suffisso civico mancante con lo stesso numero base", () => {
    expect(samePropertyAddressWithMissingCivicSuffix(
      "Viale Giovanni Xxiii 195 [.], 70032 BITONTO (BA)",
      "VIALE GIOVANNI XXIII n. 195/C Piano S1-T - 1-2",
    )).toBe(true);
    expect(samePropertyAddressWithMissingCivicSuffix("Via Roma 195/A", "Via Roma 195/B")).toBe(false);
    expect(samePropertyAddressWithMissingCivicSuffix("Via Roma 195", "Via Roma 197/C")).toBe(false);
  });
  it("riconosce il senza civico senza inventare un numero", () => {
    expect(extractFirstCivicNumber("VIA MARSALA n. SC Piano T")).toBe(".");
    expect(extractFirstCivicNumber("VIA MARSALA S.N.C. Piano T")).toBe(".");
    expect(extractFirstCivicNumber("VIA MARSALA senza civico Piano T")).toBe(".");
    expect(addressIdentity("VIA MARSALA n. SC Piano T")).toMatchObject({ street: "VIA MARSALA", civic: "." });
  });
  it("in una long run conserva la porzione dell'indirizzo della via interrogata", () => {
    const address = selectSisterAddressForStreet(
      "VIA TOMMASO TRAETTA n. 119; VIA DAVIDE DELLE CESE n. 2 Piano T.",
      "VIA DAVIDE DELLE CESE",
    );
    expect(address).toBe("VIA DAVIDE DELLE CESE n. 2 Piano T.");
    expect(extractFirstCivicNumber(address)).toBe("2");
  });
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
