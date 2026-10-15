import { describe, expect, it } from "vitest";
import { parseOwnerBlock } from "../src/core/owner-parser.js";
import { consolidateOwnershipShares } from "../src/core/ownership-shares.js";
import { sisterSource } from "../src/territory/sister-memory.js";
import { buildPlan } from "../src/import-v2/identity.js";
import type { CadastralProperty } from "../src/types.js";

const owner = (share: string, right = "Proprietà", cf = "RSSMRA80A01A893P") => parseOwnerBlock(`ROSSI MARIO nato a BITONTO (BA) il 01/01/1980\n${cf}\n${right}\n${share}`);
describe("Quote SISTER della stessa identità fiscale", () => {
  it("somma frazioni diverse esattamente, conserva ordine e righe originali senza mutarle", () => {
    const input = [owner("1/6"), owner("1/2", "Proprietà", "VRDLCU82B02A893X"), owner("1/3")];
    const before = structuredClone(input);
    const result = consolidateOwnershipShares(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ taxCode: "RSSMRA80A01A893P", shareOriginal: "1/2", sharePercentage: 50, shareNumerator: 1, shareDenominator: 2, rawPayload: { consolidatedOwnershipRows: [input[0], input[2]] } });
    expect(result[1]).toEqual(input[1]); expect(input).toEqual(before);
    expect(consolidateOwnershipShares(result)).toEqual(result);
  });
  it("non elimina quote uguali e non arrotonda ogni addendo prima della somma", () => {
    expect(consolidateOwnershipShares([owner("1/3"), owner("1/3"), owner("1/3")])[0]).toMatchObject({ shareOriginal: "1/1", sharePercentage: 100 });
    expect(consolidateOwnershipShares([owner("0,5/2"), owner("1/4")])[0]!.shareOriginal).toBe("1/2");
  });
  it("conserva usufrutto e altri diritti separati dalla proprietà", () => {
    const result = consolidateOwnershipShares([owner("1/4"), owner("1/2", "Usufrutto"), owner("1/4"), owner("1/2", "Usufrutto")]);
    expect(result.map(o => [o.rightType, o.sharePercentage])).toEqual([["Proprietà", 50], ["Usufrutto", 50], ["Usufrutto", 50]]);
  });
  it("non aggrega identità sconosciute, quote non interpretabili o persone distinte", () => {
    for (const input of [[owner("1/4", "Proprietà", ""), owner("1/4", "Proprietà", "")], [{ ...owner("1/4"), shareOriginal: "?", sharePercentage: null }, owner("1/4")], [owner("1/4"), owner("1/4", "Proprietà", "VRDLCU82B02A893X")]]) expect(consolidateOwnershipShares(input)).toEqual(input);
  });
  it("non nasconde una somma impossibile superiore al 100%", () => {
    expect(consolidateOwnershipShares([owner("3/4"), owner("1/2")])[0]!.sharePercentage).toBe(125);
  });
  it("porta una sola quota e la sua provenienza nella memoria V2 e nel piano CRM", () => {
    const property = { municipality: "BITONTO", address: "VIA TEST n. 1", sheet: "1", parcel: "2", subaltern: "3", category: "A/3", rawPayload: {} } as CadastralProperty;
    const source = sisterSource(property, [owner("1/3"), owner("1/3"), owner("1/3"), owner("1/1", "Usufrutto")], "run");
    expect(source.owners).toHaveLength(2);
    expect(source.owners[0]!.ownershipParts).toHaveLength(3);
    expect(buildPlan(source).source.owners).toHaveLength(1);
    expect(buildPlan(source).source.owners[0]!.sharePercentage).toBe(100);
  });
});
