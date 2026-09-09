import { describe, expect, it } from "vitest";
import { buildPortoniRow, portoniDocumentHtml, portoniOwnerSummary, sortPortoniRows } from "../src/services/portoni.js";

const property = (address: string, subaltern = "1") => ({
  municipality: "BITONTO", sheet: "10", parcel: "20", subaltern, address,
  censusZone: null, category: "A/3", class: null, consistency: null, cadastralIncome: null, rawPayload: {},
});
const owner = { fullName: "Mario Rossi", taxCode: "RSSMRA70A01A893X", birthPlace: null, birthProvince: null,
  birthDate: null, rightType: "Proprieta", shareOriginal: "1/1", shareNumerator: 1, shareDenominator: 1, sharePercentage: 100, rawPayload: {} };

describe("portoni", () => {
  it("compone una riga con ubicazione, proprietari e soli recapiti Excel", () => {
    const row = buildPortoniRow(property("VIA LUIGI CASTELLUCCI N. 12 SCALA B PIANO 2 INT. 4"), [owner], () => ({
      taxCode: owner.taxCode, matchedRows: 1, mobiles: ["3331234567"], landlines: ["080123456"], emails: [], whatsapp: [], overflowPhones: [], notes: [],
    }));
    expect(row.civicAndStair).toBe("Civico 12 · Scala B");
    expect(row.floorAndInternal).toBe("Piano 2 · Interno 4");
    expect(row.sisterNames).toBe("Mario Rossi · Proprieta 1/1");
    expect(row.ownership).toBe("");
    expect(row.telephone).toBe("3331234567\n080123456");
  });

  it("ordina naturalmente per civico", () => {
    const rows = ["12", "2", "10"].map((civic, index) => buildPortoniRow(property(`VIA X N. ${civic}`, String(index)), [], () => ({ taxCode: "", matchedRows: 0, mobiles: [], landlines: [], emails: [], whatsapp: [], overflowPhones: [], notes: [] })));
    expect(sortPortoniRows(rows).map((row) => row.civicAndStair)).toEqual(["Civico 2", "Civico 10", "Civico 12"]);
  });

  it("genera un documento stampabile senza HTML iniettato", () => {
    const row = { ...buildPortoniRow(property("VIA X N. 1"), [owner], () => ({ taxCode: "", matchedRows: 0, mobiles: [], landlines: [], emails: [], whatsapp: [], overflowPhones: [], notes: [] })), notes: "<script>alert(1)</script>" };
    const output = portoniDocumentHtml({ id: "x", street: "Via X", municipality: "BITONTO", status: "draft", createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z", generatedAt: null, documentPath: null, rows: [row] });
    expect(output).toContain("&lt;script&gt;");
    expect(output).not.toContain("<script>alert");
    expect(output).toContain("size:A4 portrait");
    expect(output).toContain("Note aggiuntive");
    expect(output).not.toContain("Esito e data");
    expect(output).not.toContain("Dati catastali");
  });

  it("compatta le vecchie righe senza ripetere il nominativo", () => {
    expect(portoniOwnerSummary({
      sisterNames: "MINENNA GIUSEPPE",
      ownership: "MINENNA GIUSEPPE: Proprieta 1/1",
    })).toBe("MINENNA GIUSEPPE · Proprieta 1/1");
    expect(portoniOwnerSummary({
      sisterNames: "MARRONE GRAZIA nato/a a BITONTO (BA) il 24/07/1949",
      ownership: "MARRONE GRAZIA nato/a a BITONTO (BA) il 24/07/1949: Proprieta 1000/1000",
    })).toBe("MARRONE GRAZIA · Proprieta 1000/1000 · 24/07/1949");
  });

  it("suddivide 138 righe compatte in poche pagine con note finali su ciascuna", () => {
    const base = buildPortoniRow(property("VIA X N. 1"), [owner], () => ({ taxCode: "", matchedRows: 0, mobiles: [], landlines: [], emails: [], whatsapp: [], overflowPhones: [], notes: [] }));
    const rows = Array.from({ length: 138 }, (_, index) => ({ ...base, id: String(index), cadastralKey: `1/1/${index}`, civicAndStair: `Civico ${index + 1}` }));
    const output = portoniDocumentHtml({ id: "x", street: "Via X", municipality: "BITONTO", status: "draft", createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z", generatedAt: null, documentPath: null, rows });
    expect(output.match(/class="print-page"/g)).toHaveLength(4);
    expect(output.match(/Note aggiuntive/g)).toHaveLength(4);
  });
});
