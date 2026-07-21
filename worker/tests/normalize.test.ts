import { describe, expect, it } from "vitest";

import { buildCadastralKey, consolidateContacts, formatShareForUi, normalizeTaxCode, parseShare } from "../src/core/normalize.js";

describe("normalizzazione codice fiscale", () => {
  it("rimuove spazi e caratteri invisibili e converte in maiuscolo", () => {
    expect(normalizeTaxCode(" cqv\u200bmrs49l66 a893r ")).toBe("CQVMRS49L66A893R");
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

