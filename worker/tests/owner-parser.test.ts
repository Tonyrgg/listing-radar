import { describe, expect, it } from "vitest";

import { isOwnershipRight, parseOwnerBlock } from "../src/core/owner-parser.js";

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
});

