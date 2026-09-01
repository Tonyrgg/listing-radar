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

/**
 * La data di nascita scritta dentro il codice fiscale.
 *
 * SISTER la stampa quasi sempre accanto al nominativo, ma non sempre: quando
 * manca, il requisito d'eta' scartava la persona invece di leggerla da dove
 * comunque c'e'. Non e' una stima — il codice fiscale la contiene per
 * costruzione: due cifre d'anno, una lettera di mese, due cifre di giorno con
 * quaranta aggiunto alle donne.
 *
 * L'omocodia sostituisce le cifre con lettere secondo una tabella fissa, e
 * vanno rilette come cifre. Del secolo il codice non dice niente: si prende
 * l'anno piu' recente che non cada nel futuro.
 */
const OMOCODIA = "LMNPQRSTUV";
const MESI_CODICE_FISCALE = "ABCDEHLMPRST";

function cifreCodiceFiscale(pezzo: string): string {
  return [...pezzo].map((carattere) => {
    const omocodia = OMOCODIA.indexOf(carattere);
    return omocodia >= 0 ? String(omocodia) : carattere;
  }).join("");
}

export function birthDateFromTaxCode(value: unknown, asOf = new Date()): string | null {
  const taxCode = normalizeTaxCode(value);
  if (!/^[A-Z0-9]{16}$/.test(taxCode)) return null;

  const anno = Number(cifreCodiceFiscale(taxCode.slice(6, 8)));
  const mese = MESI_CODICE_FISCALE.indexOf(taxCode[8] ?? "") + 1;
  const giornoGrezzo = Number(cifreCodiceFiscale(taxCode.slice(9, 11)));
  if (!Number.isFinite(anno) || mese < 1 || !Number.isFinite(giornoGrezzo)) return null;

  /* Sopra il quaranta e' una donna: il giorno vero e' quello meno quaranta. */
  const giorno = giornoGrezzo > 40 ? giornoGrezzo - 40 : giornoGrezzo;
  if (giorno < 1 || giorno > 31) return null;

  const recente = 2000 + anno;
  const annoIntero = recente > asOf.getUTCFullYear() ? 1900 + anno : recente;
  const data = new Date(Date.UTC(annoIntero, mese - 1, giorno));
  /* Un 31 di novembre non esiste: se il calendario lo sposta, il codice non
   * portava una data vera. */
  if (data.getUTCMonth() !== mese - 1 || data.getUTCDate() !== giorno) return null;
  return data.toISOString().slice(0, 10);
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
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(Number(value.toFixed(2)));
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

const NO_CIVIC_TOKEN = "(?:S\\s*\\.?\\s*(?:N\\s*\\.?\\s*)?C\\s*\\.?|SENZA\\s+(?:N(?:UMERO)?\\s*)?CIVICO|NON\\s+(?:NUMERATO|DISPONIBILE)|N\\s*\\.?\\s*D\\s*\\.?)";
const NO_CIVIC_PATTERN = new RegExp(`(?:\\bN(?:\\.|\\u00B0|\\u00BA)?\\s*)?\\b${NO_CIVIC_TOKEN}(?=\\s|$)`, "i");
const NO_CIVIC_AT_END_PATTERN = new RegExp(`^(.*?)\\s+${NO_CIVIC_PATTERN.source}`, "i");

/** True when SISTER explicitly marks the address as without a civic number. */
export function hasNoCivicNumber(value: string | null | undefined): boolean {
  return NO_CIVIC_PATTERN.test(String(value ?? "").replace(/\s+/g, " ").trim());
}

/** SISTER can expose a civic range; long runs use its first civic number. */
export function extractFirstCivicNumber(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (hasNoCivicNumber(normalized)) return ".";
  const explicit = normalized.match(/\bN(?:\.|°|º)?\s*(\d+)(?:\s*\/\s*([A-Z])|([A-Z]))?/i);
  if (explicit?.[1]) return `${explicit[1]}${explicit[2] ?? explicit[3] ?? ""}`.toUpperCase();
  const fallback = normalized.match(/^(.*?\D)\s*(\d+)(?:\s*(?:\/\s*)?([A-Z]))?(?:\s*-\s*\d+[A-Z]?)*\s*$/i);
  return fallback?.[2] ? `${fallback[2]}${fallback[3] ?? ""}`.toUpperCase() : null;
}

/** Split the canonical civic identity into the two distinct CRM fields. */
export function splitCivicNumberAndLetter(value: string | null | undefined): { number: string; letter: string } {
  const normalized = String(value ?? "").replace(/\s+/g, "").toUpperCase();
  if (!normalized) return { number: "", letter: "" };
  if (normalized === ".") return { number: ".", letter: "" };
  const match = normalized.match(/^(\d+)(?:\/)?([A-Z])?$/);
  return match
    ? { number: match[1]!, letter: match[2] ?? "" }
    : { number: normalized, letter: "" };
}

/** A SISTER result can list several addresses; a street run keeps its own one. */
export function selectSisterAddressForStreet(
  value: string | null | undefined,
  requestedStreet: string | null | undefined,
): string {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  const requested = String(requestedStreet ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  if (!raw || !requested) return raw;
  const segment = raw.split(/\s*;\s*|[\r\n]+/).map((item) => item.trim()).find((item) => {
    const normalized = item.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9]+/gi, " ").trim().replace(/\s+/g, " ").toUpperCase();
    return normalized === requested || normalized.startsWith(`${requested} `);
  });
  return segment ?? raw;
}

export function splitStreetAndFirstCivic(value: string | null | undefined): { street: string; civicNumber: string | null } {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return { street: "", civicNumber: null };
  const noCivic = normalized.match(NO_CIVIC_AT_END_PATTERN);
  if (noCivic?.[1]) return { street: noCivic[1].trim(), civicNumber: "." };
  const explicit = normalized.match(/^(.*?)\s+N(?:\.|°|º)?\s*(\d+)(?:\s*\/\s*([A-Z])|([A-Z]))?/i);
  if (explicit) return {
    street: explicit[1]!.trim(),
    civicNumber: `${explicit[2]}${explicit[3] ?? explicit[4] ?? ""}`.toUpperCase(),
  };
  const fallback = normalized.match(/^(.*?\D)\s*(\d+)(?:\s*(?:\/\s*)?([A-Z]))?(?:\s*-\s*\d+[A-Z]?)*\s*$/i);
  return fallback
    ? { street: fallback[1]!.trim(), civicNumber: `${fallback[2]}${fallback[3] ?? ""}`.toUpperCase() }
    : { street: normalized, civicNumber: null };
}

export function parsePropertyAddress(value: string | null | undefined): ParsedPropertyAddress {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  const locationMatch = raw.match(/^(.*?)(?:,\s*|\s+)(\d{5})\s+(.+?)\s*\(([A-Z]{2})\)\s*$/i);
  const addressWithInternal = (locationMatch?.[1] ?? raw).trim().replace(/,$/, "").trim();
  const bracketInternalMatch = addressWithInternal.match(/\[\s*([^\]]+?)\s*\]\s*$/);
  const namedInternalMatch = addressWithInternal.match(/\bINTERNO\s+([A-Z0-9/-]+)\b/i);
  const addressWithoutBracket = (bracketInternalMatch
    ? addressWithInternal.slice(0, bracketInternalMatch.index)
    : addressWithInternal).trim();
  const detailStart = addressWithoutBracket.search(/\s+(?:EDIFICIO|SCALA|INTERNO|PIANO)\b/i);
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
  const identity = splitStreetAndFirstCivic(normalized);
  return identity.street && identity.civicNumber
    ? { street: identity.street.replace(/\s+/g, " "), civic: identity.civicNumber, internal: parsed.internal }
    : null;
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

/**
 * Recovery used only after the immutable cadastral triple has matched.
 * CRM/Google can persist `195` after SISTER's `195/C`; different suffixes
 * (`195A` vs `195B`) remain a hard conflict.
 */
export function samePropertyAddressWithMissingCivicSuffix(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftIdentity = addressIdentity(left);
  const rightIdentity = addressIdentity(right);
  if (!leftIdentity || !rightIdentity || leftIdentity.street !== rightIdentity.street) return false;
  const leftCivic = leftIdentity.civic.match(/^(\d+)([A-Z])?$/);
  const rightCivic = rightIdentity.civic.match(/^(\d+)([A-Z])?$/);
  if (!leftCivic || !rightCivic || leftCivic[1] !== rightCivic[1]) return false;
  const leftSuffix = leftCivic[2] ?? "";
  const rightSuffix = rightCivic[2] ?? "";
  if (Boolean(leftSuffix) === Boolean(rightSuffix)) return false;
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
