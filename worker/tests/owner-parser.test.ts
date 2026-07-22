import { describe, expect, it } from "vitest";

import { isOwnershipRight, parseOwnerBlock } from "../src/core/owner-parser.js";
import { businessOwnerReason, isBusinessOwner, maskOwnerTaxCode } from "../src/core/owner-kind.js";

describe("parsing titolare", () => {
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

