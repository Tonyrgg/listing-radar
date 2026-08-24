import { normalizePhone } from "./normalize.js";
import type { OwnerLinkResult } from "../types.js";

export interface OwnerLookupCandidate {
  personId: string;
  text: string;
}

function optionPhones(value: string): string[] {
  return (value.match(/(?:\+|00)?\d[\d\s()./-]{6,}\d/g) ?? []).map(normalizePhone).filter(Boolean);
}

export function selectOwnerLookupCandidate(
  candidates: OwnerLookupCandidate[],
  expectedPersonId: string,
  expectedPhones: string[],
  searchLabel: string,
): { index: number; selection: OwnerLinkResult["selection"]; note: string | null } | null {
  if (!candidates.length) return null;
  const exactIndexes = candidates
    .map((candidate, index) => candidate.personId === expectedPersonId ? index : -1)
    .filter((index) => index >= 0);
  if (exactIndexes.length === 1) return { index: exactIndexes[0]!, selection: "crm_id", note: null };

  const normalizedPhones = new Set(expectedPhones.map(normalizePhone).filter(Boolean));
  const phoneIndexes = candidates
    .map((candidate, index) => optionPhones(candidate.text).some((phone) => normalizedPhones.has(phone)) ? index : -1)
    .filter((index) => index >= 0);
  if (phoneIndexes.length === 1) return { index: phoneIndexes[0]!, selection: "phone", note: null };
  if (candidates.length === 1) return { index: 0, selection: "single", note: null };
  return {
    index: 0,
    selection: "first_ambiguous",
    note: `Selezionato il primo di ${candidates.length} omonimi per ${searchLabel}: nessun cellulare ha consentito una distinzione univoca.`,
  };
}
