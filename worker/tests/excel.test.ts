import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { ExcelContactsAdapter } from "../src/adapters/excel/index.js";

describe("lettore Excel recapiti", () => {
  it("legge le colonne reali e consolida tutte le righe con lo stesso CF", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "listing-radar-contacts-"));
    try {
      const filePath = path.join(directory, "Book1.xlsx");
      const rows = [
        { comune: "Bitonto", TIPO: "", CELLULARE: "333 111 2222", WHATSAPP: "3331112222", EMAIL: "maria@example.it", NEW: "", FISSO: "0801234", CF: " cqvmrs49l66a893r ", Multiproprietari: "" },
        { comune: "Bitonto", TIPO: "", CELLULARE: "3331112222", WHATSAPP: "", EMAIL: "MARIA@example.it", NEW: "", FISSO: "0805678", CF: "CQVMRS49L66A893R", Multiproprietari: "" },
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Contatti");
      XLSX.writeFile(workbook, filePath);

      const adapter = new ExcelContactsAdapter(filePath);
      await adapter.load();
      expect(adapter.findByTaxCode("CQVMRS49L66A893R")).toMatchObject({
        matchedRows: 2,
        mobiles: ["3331112222"],
        landlines: ["0801234", "0805678"],
        emails: ["maria@example.it"],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

