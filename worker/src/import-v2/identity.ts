import { createHash } from "node:crypto";

import { ImportV2Error } from "./errors.js";
import type { CadastralIdentity, CrmPropertySummary, ImportV2Plan, SourceProperty } from "./model.js";
import { isManagedOwnershipRight } from "./ownership-policy.js";

const DIACRITICS = /[\u0300-\u036f]/g;

export function canonicalTaxCode(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

export function isUsableTaxCode(value: unknown): boolean {
  return /^[A-Z0-9]{16}$/.test(canonicalTaxCode(value));
}

export function canonicalPhone(value: unknown): string {
  const raw = String(value ?? "").trim();
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0039")) digits = digits.slice(4);
  else if (digits.startsWith("39") && digits.length > 10) digits = digits.slice(2);
  return digits;
}

export function canonicalEmail(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase("it-IT");
}

function fiscalNameCode(value: string, firstName: boolean): string {
  const letters = value.normalize("NFD").replace(DIACRITICS, "").toUpperCase().replace(/[^A-Z]/g, "");
  const consonants = letters.replace(/[AEIOU]/g, "");
  const vowels = letters.replace(/[^AEIOU]/g, "");
  const selectedConsonants = firstName && consonants.length >= 4
    ? `${consonants[0]}${consonants[2]}${consonants[3]}`
    : consonants;
  return `${selectedConsonants}${vowels}XXX`.slice(0, 3);
}

/** SISTER emits surname then given name; the fiscal code proves the split. */
export function splitSourcePersonName(fullName: string, taxCode: string): { firstName: string; lastName: string } {
  const words = fullName.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const normalizedTaxCode = canonicalTaxCode(taxCode);
  if (words.length < 2 || normalizedTaxCode.length !== 16) {
    throw new ImportV2Error("Nome completo non separabile in modo verificabile", "invalid_source");
  }
  const expectedLast = normalizedTaxCode.slice(0, 3);
  const expectedFirst = normalizedTaxCode.slice(3, 6);
  const matches = [] as Array<{ firstName: string; lastName: string }>;
  for (let boundary = 1; boundary < words.length; boundary += 1) {
    const lastName = words.slice(0, boundary).join(" ");
    const firstName = words.slice(boundary).join(" ");
    if (fiscalNameCode(lastName, false) === expectedLast && fiscalNameCode(firstName, true) === expectedFirst) {
      matches.push({ firstName, lastName });
    }
  }
  if (matches.length !== 1) {
    throw new ImportV2Error("Nome e cognome non coincidono in modo univoco con il codice fiscale", "invalid_source", {
      details: { candidateCount: matches.length },
    });
  }
  return matches[0]!;
}

function plainWords(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toUpperCase()
    .replace(/[.,;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type AddressIdentity = {
  street: string;
  civic: string;
  internal: string | null;
  location: string | null;
};

export function propertyNameToAddress(displayName: string): string {
  const hasPropertyPrefix = /^\s*IM\s*-\s*/i.test(displayName);
  const withoutPrefix = displayName.replace(/^\s*IM\s*-\s*/i, "").trim();
  const parts = withoutPrefix.split(/\s+-\s+/);
  return hasPropertyPrefix && parts.length > 1 ? parts.slice(0, -1).join(" - ").trim() : withoutPrefix;
}

export function addressIdentity(value: unknown): AddressIdentity | null {
  let raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  raw = propertyNameToAddress(raw);
  const locationMatch = raw.match(/,\s*(\d{5})\s+(.+?)\s*\(([A-Z]{2})\)\s*$/i);
  const location = locationMatch
    ? plainWords(`${locationMatch[1]} ${locationMatch[2]} ${locationMatch[3]}`)
    : null;
  raw = raw.replace(/,\s*\d{5}\s+.+?\s*\([A-Z]{2}\)\s*$/i, "").trim();
  raw = raw.replace(/\s+PIANO\s+.+$/i, "").trim();
  const internalMatch = raw.match(/\[\s*([^\]]+?)\s*\]\s*$/) ?? raw.match(/\bINTERNO\s+([A-Z0-9/-]+)\b/i);
  const internalToken = internalMatch?.[1] ? plainWords(internalMatch[1]) : "";
  const internal = internalToken && !["NC", "SNC"].includes(internalToken) ? internalToken : null;
  raw = raw.replace(/\[\s*[^\]]+?\s*\]\s*$/, "").replace(/\bINTERNO\s+[A-Z0-9/-]+\b/i, "").trim();
  const normalized = plainWords(raw).replace(/\bN(?:UMERO)?\s+(?=\d)/, "");
  const civicMatch = normalized.match(/^(.*?\D)\s+(\d+(?:\s*\/\s*[A-Z]|[A-Z])?)$/i);
  const missingCivicMatch = normalized.match(/^(.*?)\s+(?:N\s+)?(?:S\s*N\s*C|SNC|NC)$/i);
  if ((!civicMatch?.[1] || !civicMatch[2]) && !missingCivicMatch?.[1]) return null;
  return {
    street: (civicMatch?.[1] ?? missingCivicMatch?.[1] ?? "").trim(),
    civic: civicMatch?.[2] ? civicMatch[2].replace(/[\s/]/g, "").toUpperCase() : "NC",
    internal,
    location,
  };
}

export function sameAddress(left: unknown, right: unknown): boolean {
  const a = addressIdentity(left);
  const b = addressIdentity(right);
  if (!a || !b || a.street !== b.street || a.civic !== b.civic) return false;
  if (a.location && b.location && a.location !== b.location) return false;
  return a.internal === b.internal || (!a.internal && !b.internal);
}

function canonicalCadastralToken(value: unknown): string {
  return plainWords(value).replace(/\s+/g, "");
}

function canonicalIncome(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

export function sameCadastralIdentity(left: CadastralIdentity | null, right: CadastralIdentity | null): boolean {
  if (!left || !right) return false;
  const tokenMatches = (expected: unknown, actual: unknown) => {
    const source = canonicalCadastralToken(expected);
    return !source || source === canonicalCadastralToken(actual);
  };
  const expectedIncome = canonicalIncome(left.income);
  return tokenMatches(left.urbanSection, right.urbanSection)
    && tokenMatches(left.sheet, right.sheet)
    && tokenMatches(left.parcel, right.parcel)
    && tokenMatches(left.parcelDenomination, right.parcelDenomination)
    && tokenMatches(left.subaltern, right.subaltern)
    && (expectedIncome == null || expectedIncome === canonicalIncome(right.income));
}

export function choosePropertyCandidate(source: SourceProperty, candidates: CrmPropertySummary[]):
  | { kind: "create"; candidate: null }
  | { kind: "exact" | "address_update" | "cadastral_update"; candidate: CrmPropertySummary } {
  const unique = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
  const addressMatches = unique.filter((candidate) => sameAddress(source.fullAddress, candidate.fullAddress ?? candidate.displayName));
  const exact = addressMatches.filter((candidate) => sameCadastralIdentity(source.cadastral, candidate.cadastral));
  if (exact.length === 1) return { kind: "exact", candidate: exact[0]! };
  if (exact.length > 1) {
    throw new ImportV2Error("Più immobili coincidono sia per indirizzo sia per dati catastali", "ambiguous_identity", {
      details: { candidateIds: exact.map((candidate) => candidate.id) },
    });
  }
  if (addressMatches.length === 1) return { kind: "address_update", candidate: addressMatches[0]! };
  if (addressMatches.length > 1) {
    throw new ImportV2Error("Più immobili condividono l'indirizzo e non sono distinguibili con interno e catasto", "ambiguous_identity", {
      details: { candidateIds: addressMatches.map((candidate) => candidate.id) },
    });
  }
  const cadastralOnly = unique.filter((candidate) => sameCadastralIdentity(source.cadastral, candidate.cadastral));
  if (cadastralOnly.length === 1) return { kind: "cadastral_update", candidate: cadastralOnly[0]! };
  if (cadastralOnly.length > 1) {
    throw new ImportV2Error("Più immobili condividono lo stesso catasto e non sono distinguibili", "ambiguous_identity", {
      details: { candidateIds: cadastralOnly.map((candidate) => candidate.id) },
    });
  }
  return { kind: "create", candidate: null };
}

export function buildPlan(source: SourceProperty): ImportV2Plan {
  if (!source.sourcePropertyId || !source.jobId || !source.fullAddress.trim()) {
    throw new ImportV2Error("Immobile privo degli identificatori obbligatori", "invalid_source");
  }
  if (!source.owners.length) throw new ImportV2Error("Immobile senza intestatari SISTER", "invalid_source");
  const leakedBusinessOwners = source.owners.filter((owner) => /^\d{11}$/.test(canonicalTaxCode(owner.taxCode)));
  if (source.hasBusinessOwners || leakedBusinessOwners.length) {
    throw new ImportV2Error("Immobile con soggetto aziendale: import V2 accantonato", "unsupported_case", {
      details: { sourcePersonIds: leakedBusinessOwners.map((owner) => owner.sourcePersonId) },
    });
  }
  const inScopeOwners = source.owners.filter((owner) => {
    return isManagedOwnershipRight(owner.rightType);
  });
  const normalizedOwners = inScopeOwners.map((owner) => ({
    ...owner,
    taxCode: canonicalTaxCode(owner.taxCode),
    fullName: owner.fullName.replace(/\s+/g, " ").trim(),
    contacts: {
      phones: [...new Set(owner.contacts.phones.map(canonicalPhone).filter(Boolean))],
      emails: [...new Set(owner.contacts.emails.map(canonicalEmail).filter(Boolean))],
    },
  }));
  const invalidOwners = normalizedOwners.filter((owner) => !isUsableTaxCode(owner.taxCode));
  if (!normalizedOwners.length) {
    throw new ImportV2Error("Immobile senza proprietari privati nel perimetro V2", "invalid_source");
  }
  if (invalidOwners.length) {
    throw new ImportV2Error("Uno o più intestatari non hanno un codice fiscale utilizzabile", "invalid_source", {
      details: { sourcePersonIds: invalidOwners.map((owner) => owner.sourcePersonId) },
    });
  }
  const duplicateTaxCodes = normalizedOwners
    .map((owner) => owner.taxCode)
    .filter((taxCode, index, all) => all.indexOf(taxCode) !== index);
  if (duplicateTaxCodes.length) {
    throw new ImportV2Error("Lo stesso codice fiscale compare più volte tra gli intestatari", "invalid_source", {
      details: { taxCodes: [...new Set(duplicateTaxCodes)] },
    });
  }
  const normalizedSource: SourceProperty = { ...source, owners: normalizedOwners };
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)]));
    }
    return value;
  };
  const canonical = JSON.stringify(stable(normalizedSource));
  return {
    version: 2,
    fingerprint: createHash("sha256").update(canonical).digest("hex"),
    source: normalizedSource,
  };
}
