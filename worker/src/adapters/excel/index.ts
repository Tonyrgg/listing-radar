import * as fs from "node:fs";
import * as XLSX from "xlsx";

import { consolidateContacts, normalizeTaxCode } from "../../core/normalize.js";
import type { ContactMatchResult, ContactsAdapter } from "../../types.js";

export const REQUIRED_CONTACT_COLUMNS = [
  "comune", "TIPO", "CELLULARE", "WHATSAPP", "EMAIL", "NEW", "FISSO", "CF", "Multiproprietari",
] as const;

type ContactRow = Record<string, unknown>;

// SheetJS ESM keeps Node filesystem access explicit.
XLSX.set_fs(fs);

export class ExcelContactsAdapter implements ContactsAdapter {
  private readonly byTaxCode = new Map<string, ContactRow[]>();
  private headers: string[] = [];

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    const workbook = XLSX.readFile(this.path, { cellDates: false, raw: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("Il file Excel non contiene fogli");
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error("Primo foglio Excel non leggibile");
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    this.headers = (matrix[0] ?? []).map((value) => String(value).trim());
    const missing = REQUIRED_CONTACT_COLUMNS.filter((column) => !this.headers.includes(column));
    if (missing.length) throw new Error(`Colonne Excel mancanti: ${missing.join(", ")}`);
    const rows = XLSX.utils.sheet_to_json<ContactRow>(sheet, { defval: "", raw: false });
    for (const row of rows) {
      const taxCode = normalizeTaxCode(row.CF);
      if (!taxCode) continue;
      this.byTaxCode.set(taxCode, [...(this.byTaxCode.get(taxCode) ?? []), row]);
    }
  }

  getHeaders(): string[] {
    return [...this.headers];
  }

  findByTaxCode(taxCode: string): ContactMatchResult {
    const normalized = normalizeTaxCode(taxCode);
    const rows = this.byTaxCode.get(normalized) ?? [];
    return consolidateContacts(normalized, rows.map((row) => ({
      mobile: row.CELLULARE,
      landline: row.FISSO,
      email: row.EMAIL,
      whatsapp: row.WHATSAPP,
    })));
  }
}
