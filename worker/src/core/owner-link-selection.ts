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
  const expectedWords = expectedName.split(" ").filter(Boolean);
  const matchingNameIndexes = candidates
    .map((candidate, index) => {
      const candidateName = normalizedName(candidate.text);
      return expectedWords.length > 0 && expectedWords.every((word) => candidateName.includes(word)) ? index : -1;
    })
    .filter((index) => index >= 0);
  if (!matchingNameIndexes.length) return null;

  const normalizedPhones = new Set(expectedPhones.map(normalizePhone).filter(Boolean));
  const verifiedIdIndexes = matchingNameIndexes.filter((index) => candidates[index]!.personId === expectedPersonId);
  const candidatePhones = (index: number) => optionPhones(candidates[index]!.text);
  // The CRM id comes from the tax-code-verified person record and is
  // definitive. Phones may be stale or duplicated and names can be rendered
  // surname-first by the lookup.
  if (verifiedIdIndexes.length) {
    return { index: verifiedIdIndexes[0]!, selection: "crm_id", note: null };
  }

  if (normalizedPhones.size) {
    const phoneIndexes = matchingNameIndexes.filter((index) =>
      candidatePhones(index).some((phone) => normalizedPhones.has(phone)));
    if (phoneIndexes.length === 1) return { index: phoneIndexes[0]!, selection: "phone", note: null };
    const optionsWithVisiblePhones = matchingNameIndexes.filter((index) => candidatePhones(index).length > 0);
    if (matchingNameIndexes.length === 1 && !optionsWithVisiblePhones.length) {
      return { index: matchingNameIndexes[0]!, selection: "single", note: null };
    }
    // A visible phone that does not match is evidence against the suggestion;
    // do not turn it into a random name-only association.
    return null;
  }

  if (matchingNameIndexes.length === 1) return { index: matchingNameIndexes[0]!, selection: "single", note: null };
  return {
    index: matchingNameIndexes[0]!,
    selection: "first_ambiguous",
    note: `Selezionato il primo di ${matchingNameIndexes.length} omonimi per ${searchLabel}: nessun cellulare raccolto ha consentito una distinzione univoca.`,
  };
}
