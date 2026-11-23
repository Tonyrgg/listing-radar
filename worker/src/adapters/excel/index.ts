import { readFile, stat } from "node:fs/promises";

import { consolidateContacts, normalizeTaxCode } from "../../core/normalize.js";
import type { ContactMatchResult, ContactsAdapter } from "../../types.js";

export const REQUIRED_CONTACT_COLUMNS = [
  "comune", "TIPO", "CELLULARE", "WHATSAPP", "EMAIL", "NEW", "FISSO", "CF", "Multiproprietari",
] as const;

type ContactRow = Record<string, unknown>;

function contactHeaders(XLSX: typeof import("xlsx"), sheet: import("xlsx").WorkSheet) {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  range.e.r = range.s.r;
  const [row] = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", range });
  return (row ?? []).map(value => String(value).trim());
}

/**
 * Le colonne del file recapiti, senza aprire tutto il file.
 *
 * Il controllo dei collegamenti gira ogni trenta secondi e per rispondere
 * «Recapiti: a posto» apriva e sgranava l'intero foglio: tutte le righe, due
 * volte, piu' l'indice per codice fiscale. La lettura di un file Excel e'
 * sincrona: per tutto quel tempo il processo principale dell'app non poteva
 * fare altro, e la finestra restava ferma. Ogni mezzo minuto, anche a worker
 * spento.
 *
 * Qui serve sapere due cose: che il file ci sia, e che abbia le colonne
 * giuste. Bastano l'intestazione e, se il file non e' cambiato, nemmeno
 * quella.
 */
const intestazioniInCache = new Map<string, { firma: string; headers: string[] }>();

export async function readContactsHeaders(percorso: string): Promise<string[]> {
  const info = await stat(percorso);
  const firma = `${info.mtimeMs}:${info.size}`;
  const inCache = intestazioniInCache.get(percorso);
  if (inCache?.firma === firma) return inCache.headers;

  /* `sheetRows: 1` ferma la lettura alla prima riga: e' l'unica che serve. */
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await readFile(percorso), { type: "buffer", sheets: 0, sheetRows: 1, cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Il file Excel non contiene fogli");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("Primo foglio Excel non leggibile");
  const headers = contactHeaders(XLSX, sheet);

  intestazioniInCache.clear();
  intestazioniInCache.set(percorso, { firma, headers });
  return headers;
}

/** Verifica che il file recapiti sia utilizzabile. Non ne legge le righe. */
export async function verifyContactsFile(percorso: string): Promise<string[]> {
  const headers = await readContactsHeaders(percorso);
  const missing = REQUIRED_CONTACT_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`Colonne Excel mancanti: ${missing.join(", ")}`);
  return headers;
}

export class ExcelContactsAdapter implements ContactsAdapter {
  private byTaxCode = new Map<string, ContactRow[]>();
  private headers: string[] = [];

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await readFile(this.path), { type: "buffer", sheets: 0, cellDates: false, raw: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("Il file Excel non contiene fogli");
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error("Primo foglio Excel non leggibile");
    const headers = contactHeaders(XLSX, sheet);
    const missing = REQUIRED_CONTACT_COLUMNS.filter((column) => !headers.includes(column));
    if (missing.length) throw new Error(`Colonne Excel mancanti: ${missing.join(", ")}`);
    const rows = XLSX.utils.sheet_to_json<ContactRow>(sheet, { defval: "", raw: false });
    const index = new Map<string, ContactRow[]>();
    for (const row of rows) {
      const taxCode = normalizeTaxCode(row.CF);
      if (!taxCode) continue;
      /* Ricopiare l'elenco a ogni riga costava un tempo quadratico sui
       * proprietari che compaiono piu' volte: qui si aggiunge in coda. */
      const contact = { CELLULARE: row.CELLULARE, FISSO: row.FISSO, EMAIL: row.EMAIL, WHATSAPP: row.WHATSAPP };
      const esistenti = index.get(taxCode);
      if (esistenti) esistenti.push(contact);
      else index.set(taxCode, [contact]);
    }
    this.byTaxCode = index;
    this.headers = headers;
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
