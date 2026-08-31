export const BITONTO_OFFICIAL_STREETS_URL =
  "https://www.opendata.maggioli.cloud/dataset/0bc6079a-6e58-4d67-aefc-03d4ad0f04ac/resource/2a14cced-3d18-42c6-91fd-58cbcc59977b/download/comune-di-bitonto-elenco-delle-aree-di-circolazione.csv";

export const BITONTO_OFFICIAL_STREETS_DATASET_URL =
  "https://dati.puglia.it/ckan/dataset/comune-di-bitonto-elenco-delle-aree-di-circolazione1";

export type OfficialStreetCsvRow = {
  Codvia: string;
  Specie: string;
  Descrizione: string;
  Cap: string;
  Comune: string;
};

export type CanonicalStreetImportRecord = {
  official_code: string;
  municipality: string;
  locality: string | null;
  official_type: string;
  official_description: string;
  canonical_name: string;
  normalized_name: string;
  sister_search_name: string;
  record_status: "active" | "needs_review";
  source_payload: OfficialStreetCsvRow;
};

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV ufficiale non valido: virgolette non chiuse");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function normalizeStreetName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`]/g, "'")
    .replace(/[^A-Z0-9']+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function cleanOfficialField(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function inferredLocality(type: string, description: string): string | null {
  const normalized = normalizeStreetName(`${type} ${description}`);
  if (/\bMARIOTTO\b/.test(normalized)) return "MARIOTTO";
  if (/\bPALOMBAIO\b/.test(normalized)) return "PALOMBAIO";
  return null;
}

function requiresReview(type: string, description: string): boolean {
  const normalized = normalizeStreetName(`${type} ${description}`);
  return !type
    || type === "ALTRO"
    || normalized.length < 4
    || /\bSOPPRESS[AOE]?\b/.test(normalized)
    || normalized === "STRADA"
    || normalized === "TRAVERSA";
}

export function parseOfficialStreetInventory(csv: string): CanonicalStreetImportRecord[] {
  const [header, ...body] = parseCsv(csv.replace(/^\uFEFF/, ""));
  const expected = ["Codvia", "Specie", "Descrizione", "Cap", "Comune"];
  if (!header || header.length !== expected.length || header.some((value, index) => value !== expected[index])) {
    throw new Error(`Intestazione CSV inattesa: ${header?.join(",") ?? "assente"}`);
  }

  const seenCodes = new Set<string>();
  return body.filter((columns) => columns.some(Boolean)).map((columns, rowIndex) => {
    if (columns.length !== expected.length) {
      throw new Error(`Riga CSV ${rowIndex + 2} non valida: attese ${expected.length} colonne, trovate ${columns.length}`);
    }
    const row: OfficialStreetCsvRow = {
      Codvia: cleanOfficialField(columns[0] ?? ""),
      Specie: cleanOfficialField(columns[1] ?? ""),
      Descrizione: cleanOfficialField(columns[2] ?? ""),
      Cap: cleanOfficialField(columns[3] ?? ""),
      Comune: cleanOfficialField(columns[4] ?? ""),
    };
    if (!row.Codvia) throw new Error(`Riga CSV ${rowIndex + 2} senza Codvia`);
    if (seenCodes.has(row.Codvia)) throw new Error(`Codvia duplicato nel CSV: ${row.Codvia}`);
    if (!row.Descrizione) throw new Error(`Riga CSV ${rowIndex + 2} senza descrizione`);
    if (normalizeStreetName(row.Comune) !== "BITONTO") {
      throw new Error(`Comune inatteso per Codvia ${row.Codvia}: ${row.Comune}`);
    }
    seenCodes.add(row.Codvia);

    const canonicalName = cleanOfficialField(`${row.Specie} ${row.Descrizione}`);
    const normalizedName = normalizeStreetName(canonicalName);
    return {
      official_code: row.Codvia,
      municipality: "BITONTO",
      locality: inferredLocality(row.Specie, row.Descrizione),
      official_type: row.Specie,
      official_description: row.Descrizione,
      canonical_name: canonicalName,
      normalized_name: normalizedName,
      sister_search_name: normalizedName,
      record_status: requiresReview(row.Specie, row.Descrizione) ? "needs_review" : "active",
      source_payload: row,
    };
  });
}

