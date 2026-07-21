import type { CadastralKey, ContactMatchResult } from "../types.js";

const INVISIBLE_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

export function normalizeTaxCode(value: unknown): string {
  return String(value ?? "")
    .replace(INVISIBLE_CHARACTERS, "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

export function normalizePhone(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const leadingPlus = raw.startsWith("+") ? "+" : "";
  return leadingPlus + raw.replace(/\D/g, "");
}

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function uniqueNonEmpty(values: unknown[], normalize: (value: unknown) => string): string[] {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

export function parseShare(value: unknown): {
  original: string;
  numerator: number | null;
  denominator: number | null;
  percentage: number | null;
} {
  const original = String(value ?? "").trim();
  const match = original.match(/^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/);
  if (!match) return { original, numerator: null, denominator: null, percentage: null };
  const numerator = Number(match[1]!.replace(",", "."));
  const denominator = Number(match[2]!.replace(",", "."));
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return { original, numerator: null, denominator: null, percentage: null };
  }
  const percentage = Number(((numerator / denominator) * 100).toFixed(6));
  return { original, numerator, denominator, percentage };
}

export function formatShareForUi(value: number): string {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 6 }).format(value);
}

export function buildCadastralKey(key: CadastralKey): string {
  return [key.municipality, key.sheet, key.parcel, key.subaltern]
    .map((value) => value.trim().toUpperCase())
    .join("|");
}

export function addressIdentity(value: string | null | undefined): { street: string; civic: string } | null {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[.,;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = normalized.match(/^(.*?\D)\s*(\d+)\s*(?:\/\s*)?([A-Z])?$/);
  if (!match) return null;
  const street = match[1]!.trim().replace(/\s+/g, " ");
  const civic = `${match[2]}${match[3] ?? ""}`;
  return street && civic ? { street, civic } : null;
}

export function sameStreetAndCivic(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftIdentity = addressIdentity(left);
  const rightIdentity = addressIdentity(right);
  return Boolean(
    leftIdentity
      && rightIdentity
      && leftIdentity.street === rightIdentity.street
      && leftIdentity.civic === rightIdentity.civic,
  );
}

function fiscalNamePart(value: string, firstName: boolean) {
  const letters = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
  const consonants = letters.replace(/[AEIOU]/g, "");
  const vowels = letters.replace(/[^AEIOU]/g, "");
  if (firstName && consonants.length >= 4) return `${consonants[0]}${consonants[2]}${consonants[3]}`;
  return `${consonants}${vowels}XXX`.slice(0, 3);
}

export function splitPersonName(fullName: string, taxCode: string | null | undefined): { firstName: string; lastName: string; verified: boolean } {
  const words = fullName.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const normalizedTaxCode = normalizeTaxCode(taxCode);
  if (words.length < 2) return { firstName: "", lastName: fullName.trim(), verified: false };
  const expectedLastName = normalizedTaxCode.slice(0, 3);
  const expectedFirstName = normalizedTaxCode.slice(3, 6);
  for (let index = 1; index < words.length; index += 1) {
    const lastName = words.slice(0, index).join(" ");
    const firstName = words.slice(index).join(" ");
    if (fiscalNamePart(lastName, false) === expectedLastName && fiscalNamePart(firstName, true) === expectedFirstName) {
      return { firstName, lastName, verified: true };
    }
  }
  return { firstName: words.slice(1).join(" "), lastName: words[0]!, verified: false };
}

export function consolidateContacts(
  taxCode: string,
  rows: Array<{ mobile?: unknown; landline?: unknown; email?: unknown; whatsapp?: unknown }>,
): ContactMatchResult {
  const mobiles = uniqueNonEmpty(rows.map((row) => row.mobile), normalizePhone);
  const landlines = uniqueNonEmpty(rows.map((row) => row.landline), normalizePhone)
    .filter((phone) => !mobiles.includes(phone));
  const emails = uniqueNonEmpty(rows.map((row) => row.email), normalizeEmail);
  const whatsapp = uniqueNonEmpty(rows.map((row) => row.whatsapp), normalizePhone);
  const allPhones = [...mobiles, ...landlines];
  return {
    taxCode: normalizeTaxCode(taxCode),
    matchedRows: rows.length,
    mobiles,
    landlines,
    emails,
    whatsapp,
    overflowPhones: allPhones.slice(2),
    notes: allPhones.length > 2 ? [`Recapiti oltre i campi principali: ${allPhones.slice(2).join(", ")}`] : [],
  };
}
