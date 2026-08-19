import {
  canonicalBuildingAddress,
  splitCivicNumbers,
  type CanonicalBuildingAddress,
} from "@/lib/property-lifecycle/buildings/address";
import { hashValue } from "@/lib/property-lifecycle/contracts/normalized-listing";
import { resolveMonitoredGeography } from "@/lib/property-lifecycle/geography/scope";

export const BUILDING_INTERVENTION_TYPES = [
  "MANUTENZIONE_STRAORDINARIA",
  "FRAZIONAMENTO",
  "FUSIONE_ACCOPPIAMENTO",
  "CAMBIO_DESTINAZIONE_USO",
  "AGIBILITA",
  "AMPLIAMENTO",
  "RISTRUTTURAZIONE",
  "NUOVA_COSTRUZIONE",
  "FINE_LAVORI",
  "OTHER",
] as const;

export type BuildingInterventionType =
  (typeof BUILDING_INTERVENTION_TYPES)[number];

export interface BuildingCadastralReference {
  type: string | null;
  section: string | null;
  sheet: string | null;
  parcel: string | null;
  subaltern: string | null;
  lot: string | null;
}

export interface NormalizedBuildingPractice {
  sourceRecordKey: string;
  applicationCode: string;
  practiceNumber: string | null;
  protocolNumber: string | null;
  year: string | null;
  practiceType: string | null;
  practiceStatus: string | null;
  interventionType: BuildingInterventionType;
  occurredAt: string | null;
  addresses: CanonicalBuildingAddress[];
  cadastralReferences: BuildingCadastralReference[];
  sanitizedPayload: Record<string, unknown>;
  contentHash: string;
}

export interface BuildingPracticeNormalizationResult {
  records: NormalizedBuildingPractice[];
  inputRows: number;
  eligibleRows: number;
  skippedApplicationRows: number;
  duplicateRows: number;
  unmatchedRecords: number;
  warnings: string[];
}

type CsvRow = Record<string, string>;

function folded(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function detectDelimiter(value: string): string {
  const firstLine = value.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", ";", "\t"];
  let quoted = false;
  const counts = new Map(candidates.map((candidate) => [candidate, 0]));
  for (let index = 0; index < firstLine.length; index += 1) {
    const character = firstLine[index];
    if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && counts.has(character)) {
      counts.set(character, (counts.get(character) ?? 0) + 1);
    }
  }
  return candidates.sort(
    (left, right) => (counts.get(right) ?? 0) - (counts.get(left) ?? 0),
  )[0] ?? ",";
}

function csvMatrix(value: string): string[][] {
  const delimiter = detectDelimiter(value);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && value[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((cell) => cell.trim())) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }
    field += character;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) {
    rows.push(row);
  }
  return rows;
}

export function parseBuildingPracticeCsv(value: string): CsvRow[] {
  const matrix = csvMatrix(value);
  const headers = (matrix[0] ?? []).map((header, index) =>
    index === 0 ? header.replace(/^\uFEFF/, "").trim() : header.trim(),
  );
  if (headers.length === 0 || !headers.some(Boolean)) {
    throw new Error("Building-practice CSV has no header row.");
  }
  return matrix.slice(1).map((cells) =>
    Object.fromEntries(
      headers.map((header, index) => [header, (cells[index] ?? "").trim()]),
    ),
  );
}

function indexedRow(row: CsvRow): Map<string, string> {
  return new Map(
    Object.entries(row).map(([key, value]) => [folded(key), value.trim()]),
  );
}

function field(row: Map<string, string>, ...aliases: string[]): string | null {
  for (const alias of aliases) {
    const value = row.get(folded(alias));
    if (value?.trim()) {
      return value.trim();
    }
  }
  return null;
}

function parseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const italian = value.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/,
  );
  if (italian?.[1] && italian[2] && italian[3]) {
    const timestamp = Date.UTC(
      Number(italian[3]),
      Number(italian[2]) - 1,
      Number(italian[1]),
      Number(italian[4] ?? 0),
      Number(italian[5] ?? 0),
    );
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function classifyBuildingIntervention(
  ...values: Array<string | null | undefined>
): BuildingInterventionType {
  const value = folded(values.filter(Boolean).join(" "));
  const rules: Array<[BuildingInterventionType, RegExp]> = [
    ["FRAZIONAMENTO", /\bfrazion/],
    ["FUSIONE_ACCOPPIAMENTO", /\b(?:fusion|accorp|unific)/],
    ["CAMBIO_DESTINAZIONE_USO", /\b(?:cambio|mutamento)\b.*\bdestinaz/],
    ["NUOVA_COSTRUZIONE", /\b(?:nuova costru|nuovo fabbricat|edificaz)/],
    ["AMPLIAMENTO", /\bampliament/],
    ["RISTRUTTURAZIONE", /\bristrutturaz/],
    ["MANUTENZIONE_STRAORDINARIA", /\bmanutenzion\w*\s+straordinar/],
    ["AGIBILITA", /\b(?:agibil|abitabil)/],
    ["FINE_LAVORI", /\b(?:fine|ultimazion)\w*\s+(?:dei\s+)?lavor/],
  ];
  return rules.find(([, pattern]) => pattern.test(value))?.[0] ?? "OTHER";
}

function practiceKey(row: Map<string, string>): string {
  const application = folded(field(row, "Applicazione") ?? "unknown");
  const year = folded(field(row, "Anno") ?? "undated");
  const explicit =
    field(row, "Numero Pratica") ??
    field(row, "Codice Pratica") ??
    field(row, "Numero");
  if (explicit) {
    return application + ":" + year + ":" + folded(explicit);
  }
  return (
    application +
    ":fallback:" +
    hashValue({
      protocol: field(row, "Numero Protocollo"),
      protocolDate: field(row, "Data Protocollo"),
      type: field(row, "Tipo Pratica"),
      street: field(row, "Via"),
      civic: field(row, "Civico"),
      sheet: field(row, "Foglio"),
      parcel: field(row, "Particella"),
    })
  );
}

function localityFromStreet(value: string): "Bitonto" | "Palombaio" | "Mariotto" {
  const normalized = folded(value);
  if (normalized.includes("palombaio")) {
    return "Palombaio";
  }
  if (normalized.includes("mariotto")) {
    return "Mariotto";
  }
  return "Bitonto";
}

function streetName(value: string): string {
  return value
    .replace(/^\s*(?:bitonto|palombaio|mariotto)\s*[-,:]\s*/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

function addresses(rows: Map<string, string>[]): CanonicalBuildingAddress[] {
  const result = new Map<string, CanonicalBuildingAddress>();
  for (const row of rows) {
    const rawStreet = field(row, "Via", "Indirizzo");
    if (!rawStreet) {
      continue;
    }
    const street = streetName(rawStreet);
    const letter = field(row, "Lettera");
    let civics = splitCivicNumbers(field(row, "Civico", "Numero Civico"));
    if (letter && civics.length === 1 && !/[a-z]$/i.test(civics[0] ?? "")) {
      civics = splitCivicNumbers((civics[0] ?? "") + letter);
    }
    const municipality = field(row, "Comune") ?? "Bitonto";
    const locality = localityFromStreet(rawStreet);
    for (const civic of civics) {
      const location = resolveMonitoredGeography({
        rawText: street + " " + civic + ", " + locality + ", " + municipality,
        municipality,
        locality,
        streetName: street,
        streetNumber: civic,
      });
      const address = canonicalBuildingAddress(location);
      if (address) {
        result.set(address.normalizedKey, address);
      }
    }
  }
  return [...result.values()].sort((left, right) =>
    left.normalizedKey.localeCompare(right.normalizedKey),
  );
}

function cadastralReferences(
  rows: Map<string, string>[],
): BuildingCadastralReference[] {
  const result = new Map<string, BuildingCadastralReference>();
  for (const row of rows) {
    const reference = {
      type: field(row, "Tipo Catasto"),
      section: field(row, "Sezione"),
      sheet: field(row, "Foglio"),
      parcel: field(row, "Particella"),
      subaltern: field(row, "Subalterno"),
      lot: field(row, "Lotto"),
    };
    if (
      !reference.sheet &&
      !reference.parcel &&
      !reference.subaltern &&
      !reference.lot
    ) {
      continue;
    }
    result.set(JSON.stringify(reference), reference);
  }
  return [...result.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, reference]) => reference);
}

function firstField(rows: Map<string, string>[], ...aliases: string[]): string | null {
  return rows.map((row) => field(row, ...aliases)).find(Boolean) ?? null;
}

export function normalizeBuildingPracticeRows(
  rawRows: CsvRow[],
  options: { applicationCode?: string | null } = { applicationCode: "ape" },
): BuildingPracticeNormalizationResult {
  const rows = rawRows.map(indexedRow);
  const requestedApplication =
    options.applicationCode == null ? null : folded(options.applicationCode);
  const eligible = rows.filter(
    (row) =>
      requestedApplication == null ||
      folded(field(row, "Applicazione")) === requestedApplication,
  );
  const groups = new Map<string, Map<string, string>[]>();
  for (const row of eligible) {
    const key = practiceKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const records = [...groups.entries()].map(([sourceRecordKey, group]) => {
    const interventionType = classifyBuildingIntervention(
      firstField(group, "Oggetto"),
      firstField(group, "Oggetto Fascicolo"),
      firstField(group, "Tipo Pratica"),
    );
    const normalizedAddresses = addresses(group);
    const references = cadastralReferences(group);
    const occurredAt =
      parseDate(firstField(group, "Data Rilascio")) ??
      parseDate(firstField(group, "Data Protocollo")) ??
      parseDate(firstField(group, "Data Apertura")) ??
      parseDate(firstField(group, "Data Fascicolo")) ??
      parseDate(firstField(group, "Data Chiusura")) ??
      parseDate(firstField(group, "Data Ultimazione Lavori"));
    const sanitizedPayload: Record<string, unknown> = {
      sourceRecordKey,
      applicationCode: folded(firstField(group, "Applicazione") ?? "unknown"),
      practiceNumber: firstField(group, "Numero Pratica"),
      protocolNumber: firstField(group, "Numero Protocollo"),
      year: firstField(group, "Anno"),
      practiceType: firstField(group, "Tipo Pratica"),
      practiceStatus: firstField(group, "Situazione Pratica"),
      interventionType,
      occurredAt,
      addresses: normalizedAddresses,
      cadastralReferences: references,
    };
    return {
      sourceRecordKey,
      applicationCode: String(sanitizedPayload.applicationCode),
      practiceNumber: sanitizedPayload.practiceNumber as string | null,
      protocolNumber: sanitizedPayload.protocolNumber as string | null,
      year: sanitizedPayload.year as string | null,
      practiceType: sanitizedPayload.practiceType as string | null,
      practiceStatus: sanitizedPayload.practiceStatus as string | null,
      interventionType,
      occurredAt,
      addresses: normalizedAddresses,
      cadastralReferences: references,
      sanitizedPayload,
      contentHash: hashValue(sanitizedPayload),
    };
  });
  const warnings: string[] = [];
  if (rawRows.length > 0 && !rows.some((row) => field(row, "Applicazione"))) {
    warnings.push("missing_application_column");
  }

  return {
    records,
    inputRows: rows.length,
    eligibleRows: eligible.length,
    skippedApplicationRows: rows.length - eligible.length,
    duplicateRows: Math.max(0, eligible.length - groups.size),
    unmatchedRecords: records.filter((record) => record.addresses.length === 0).length,
    warnings,
  };
}
