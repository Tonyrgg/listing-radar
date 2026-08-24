import { describe, expect, it } from "vitest";

import { isOwnershipRight, parseOwnerBlock } from "../src/core/owner-parser.js";
import { normalizePhone } from "../src/core/normalize.js";
import { businessOwnerReason, isBusinessOwner, maskOwnerTaxCode } from "../src/core/owner-kind.js";

describe("parsing titolare", () => {
  it("normalizza lo stesso cellulare italiano con o senza prefisso internazionale", () => {
    expect([
      normalizePhone("+39 333 123 4567"),
      normalizePhone("0039 3331234567"),
      normalizePhone("3331234567"),
    ]).toEqual(["3331234567", "3331234567", "3331234567"]);
  });

  it("riconosce le varianti in comunione legale incontrate nella run live di Via Don Luigi Sturzo 22", () => {
    expect(isOwnershipRight("proprietario per 1/2 com. leg. con altra persona")).toBe(true);
    expect(isOwnershipRight("proprietaria per 1/2 com. leg. con altra persona")).toBe(true);
    expect(isOwnershipRight("piena proprietÃ  per 1/3")).toBe(true);
    expect(isOwnershipRight("usufrutto per 1/2")).toBe(false);
  });

  it("estrae CF etichettato, data invertita e quota annotata senza inventare dati", () => {
    const owner = parseOwnerBlock(`ROSSI MARIO nato il 01-02-1960 a BITONTO (BA)
Codice fiscale: RSSMRA60B01A893X
Proprietario per 1/2 in comunione legale
Quota 1/2 bene personale`);
    expect(owner).toMatchObject({
      fullName: "ROSSI MARIO",
      birthPlace: "BITONTO",
      birthProvince: "BA",
      birthDate: "1960-02-01",
      taxCode: "RSSMRA60B01A893X",
      shareOriginal: "1/2",
      sharePercentage: 50,
    });
    expect(isOwnershipRight(owner.rightType)).toBe(true);
  });

  it("estrae anagrafica, CF, diritto e quota", () => {
    const owner = parseOwnerBlock(`ACQUAVIVA MARIA ROSARIA nata a BITONTO (BA) il 26/07/1949
CQVMRS49L66A893R
Proprieta'
500/1000`);
    expect(owner).toMatchObject({
      fullName: "ACQUAVIVA MARIA ROSARIA", birthPlace: "BITONTO", birthProvince: "BA",
      birthDate: "1949-07-26", taxCode: "CQVMRS49L66A893R", rightType: "Proprieta'",
      shareNumerator: 500, shareDenominator: 1000, sharePercentage: 50,
    });
    expect(isOwnershipRight(owner.rightType)).toBe(true);
  });

  it("considera proprietà senza quota come proprietà piena 1/1", () => {
    const owner = parseOwnerBlock(`ROSSI MARIO nato a BARI (BA) il 01/01/1960
RSSMRA60A01A662X
Proprietà`);
    expect(owner).toMatchObject({
      rightType: "Proprietà",
      shareOriginal: "1/1",
      shareNumerator: 1,
      shareDenominator: 1,
      sharePercentage: 100,
      rawPayload: { shareDefaulted: true },
    });
  });
  it("tratta la nuda proprietÃ  come proprietÃ  ordinaria", () => {
    const owner = parseOwnerBlock(`CORALLO CLAUDIO nato a BITONTO (BA) il 26/10/1978
CRLCLD78R26A893Q
Nuda proprieta'
1/1`);
    expect(owner).toMatchObject({
      fullName: "CORALLO CLAUDIO",
      taxCode: "CRLCLD78R26A893Q",
      rightType: "Nuda proprieta'",
      sharePercentage: 100,
    });
    expect(isOwnershipRight(owner.rightType)).toBe(true);
  });
});

describe("riconoscimento intestatari aziendali", () => {
  it("riconosce una partita IVA italiana di undici cifre", () => {
    const owner = parseOwnerBlock(`EDILE & IMMOBILIARE COCE S.R.L.\n07504350724\nProprietÃ \n1/1`);
    expect(owner.taxCode).toBe("07504350724");
    expect(businessOwnerReason(owner.fullName, owner.taxCode)).toBe("business-tax-code");
    expect(maskOwnerTaxCode(owner.taxCode)).toBe("075******24");
  });

  it("riconosce le forme societarie anche senza partita IVA", () => {
    expect(isBusinessOwner("Edile & Immobiliare Coce S.R.L.", null)).toBe(true);
    expect(isBusinessOwner("SocietÃ  Agricola del Levante", null)).toBe(true);
  });

  it("non scarta un privato con CF valido, mancante o un cognome ambiguo", () => {
    expect(isBusinessOwner("ROSSI MARIO", "RSSMRA60A01A662X")).toBe(false);
    expect(isBusinessOwner("ROSSI MARIO", null)).toBe(false);
    expect(isBusinessOwner("IMMOBILIARE MARIO", null)).toBe(false);
  });
});

