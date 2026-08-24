import type { CadastralKey, ContactMatchResult } from "../types.js";

const INVISIBLE_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

export function normalizeTaxCode(value: unknown): string {
  return String(value ?? "")
    .replace(INVISIBLE_CHARACTERS, "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

export function formatPersonName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("it-IT")
    .replace(/(^|[\s'’\-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("it-IT"));
}

export function genderFromTaxCode(value: unknown): "M" | "F" | null {
  const taxCode = normalizeTaxCode(value);
  if (!/^[A-Z0-9]{16}$/.test(taxCode)) return null;
  const encodedDay = Number(taxCode.slice(9, 11));
  if (encodedDay >= 1 && encodedDay <= 31) return "M";
  if (encodedDay >= 41 && encodedDay <= 71) return "F";
  return null;
}

export function normalizePhone(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0039")) digits = digits.slice(4);
  else if (raw.startsWith("+39") || (digits.startsWith("39") && digits.length >= 11 && digits.length <= 13)) digits = digits.slice(2);
  return digits;
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

export type ParsedPropertyAddress = {
  address: string;
  internal: string | null;
  postalCode: string | null;
  municipality: string | null;
  province: string | null;
};

export function parsePropertyAddress(value: string | null | undefined): ParsedPropertyAddress {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  const locationMatch = raw.match(/^(.*?)(?:,\s*|\s+)(\d{5})\s+(.+?)\s*\(([A-Z]{2})\)\s*$/i);
  const addressWithInternal = (locationMatch?.[1] ?? raw).trim().replace(/,$/, "").trim();
  const bracketInternalMatch = addressWithInternal.match(/\[\s*([^\]]+?)\s*\]\s*$/);
  const namedInternalMatch = addressWithInternal.match(/\bINTERNO\s+([A-Z0-9/-]+)\b/i);
  const addressWithoutBracket = (bracketInternalMatch
    ? addressWithInternal.slice(0, bracketInternalMatch.index)
    : addressWithInternal).trim();
  const detailStart = addressWithoutBracket.search(/\s+(?:SCALA|INTERNO|PIANO)\b/i);
  const address = (detailStart >= 0 ? addressWithoutBracket.slice(0, detailStart) : addressWithoutBracket)
    .replace(/\s+N(?:\.|°)?\s*(?=\d)/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/,$/, "")
    .trim();
  return {
    address,
    internal: bracketInternalMatch?.[1]?.trim() || namedInternalMatch?.[1]?.trim() || null,
    postalCode: locationMatch?.[2] ?? null,
    municipality: locationMatch?.[3]?.trim() ?? null,
    province: locationMatch?.[4]?.toUpperCase() ?? null,
  };
}

export function addressIdentity(value: string | null | undefined): { street: string; civic: string; internal: string | null } | null {
  const parsed = parsePropertyAddress(value);
  const normalized = parsed.address
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
  return street && civic ? { street, civic, internal: parsed.internal } : null;
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

export function samePropertyAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftIdentity = addressIdentity(left);
  const rightIdentity = addressIdentity(right);
  if (!leftIdentity || !rightIdentity) return false;
  if (leftIdentity.street !== rightIdentity.street || leftIdentity.civic !== rightIdentity.civic) return false;
  return !leftIdentity.internal || !rightIdentity.internal || leftIdentity.internal === rightIdentity.internal;
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
