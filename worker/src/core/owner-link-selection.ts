import { normalizePhone } from "./normalize.js";
import type { OwnerLinkResult } from "../types.js";

export interface OwnerLookupCandidate {
  personId: string;
  text: string;
}

function optionPhones(value: string): string[] {
  return (value.match(/(?:\+|00)?\d[\d\s()./-]{6,}\d/g) ?? []).map(normalizePhone).filter(Boolean);
}

function normalizedName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function selectOwnerLookupCandidate(
  candidates: OwnerLookupCandidate[],
  expectedPersonId: string,
  expectedPhones: string[],
  searchLabel: string,
): { index: number; selection: OwnerLinkResult["selection"]; note: string | null } | null {
  if (!candidates.length) return null;
  const expectedName = normalizedName(searchLabel);
  const matchingNameIndexes = candidates
    .map((candidate, index) => normalizedName(candidate.text).includes(expectedName) ? index : -1)
    .filter((index) => index >= 0);
  if (!matchingNameIndexes.length) return null;

  const normalizedPhones = new Set(expectedPhones.map(normalizePhone).filter(Boolean));
  if (normalizedPhones.size) {
    const phoneIndexes = matchingNameIndexes.filter((index) =>
      optionPhones(candidates[index]!.text).some((phone) => normalizedPhones.has(phone)));
    const verifiedIdIndexes = phoneIndexes.filter((index) => candidates[index]!.personId === expectedPersonId);
    if (verifiedIdIndexes.length === 1) return { index: verifiedIdIndexes[0]!, selection: "crm_id", note: null };
    if (phoneIndexes.length === 1) return { index: phoneIndexes[0]!, selection: "phone", note: null };
    // Se abbiamo un telefono raccolto, nessuna corrispondenza telefonica e' piu'
    // sicura di una selezione anticipata basata soltanto sul nome.
    return null;
  }

  const exactIndexes = matchingNameIndexes.filter((index) => candidates[index]!.personId === expectedPersonId);
  if (exactIndexes.length === 1) return { index: exactIndexes[0]!, selection: "crm_id", note: null };
  if (matchingNameIndexes.length === 1) return { index: matchingNameIndexes[0]!, selection: "single", note: null };
  return {
    index: matchingNameIndexes[0]!,
    selection: "first_ambiguous",
    note: `Selezionato il primo di ${matchingNameIndexes.length} omonimi per ${searchLabel}: nessun cellulare raccolto ha consentito una distinzione univoca.`,
  };
}
