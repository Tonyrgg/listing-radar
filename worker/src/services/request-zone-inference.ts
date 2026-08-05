import type { CrmRequestDetail } from "../adapters/crm/requests.js";

export type RequestInferenceZone = {
  id: string;
  zone_number: number | null;
  name: string;
  aliases: string[];
  landmarks: string[];
  associated_streets: string[];
};

export type InferredRequestZone = {
  zone_id: string;
  zone_number: number | null;
  zone_name: string;
  preference_level: "preferred" | "excluded";
  matched_phrase: string;
  evidence: string;
};

type PhraseOccurrence = {
  zone: RequestInferenceZone;
  phrase: string;
  start: number;
  end: number;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").replace(/[^a-z0-9]+/g, " ").trim();
}

function requestEvidenceText(detail: CrmRequestDetail) {
  const field = (label: string) => typeof detail.fields[label] === "string" ? detail.fields[label] as string : null;
  return [
    field("Esigenze"),
    field("Dettaglio Esigenza"),
    detail.evolutionText,
    ...detail.activities.flatMap((activity) => [activity.subject, activity.description]),
  ].filter((value): value is string => Boolean(value?.trim())).join(" | ");
}

function phraseOccurrences(source: string, zone: RequestInferenceZone): PhraseOccurrence[] {
  const aliases = zone.aliases.map((alias) => {
    const normalized = normalize(alias);
    return normalized.includes(" ") ? normalized : `zona ${normalized}`;
  });
  const phrases = [zone.name, ...aliases, ...zone.landmarks, ...zone.associated_streets]
    .map(normalize)
    .filter((phrase, index, values) => phrase.length >= 4 && values.indexOf(phrase) === index);
  return phrases.flatMap((phrase) => {
    const occurrences: PhraseOccurrence[] = [];
    let cursor = 0;
    while (cursor < source.length) {
      const start = source.indexOf(phrase, cursor);
      if (start < 0) break;
      const end = start + phrase.length;
      const before = start === 0 ? " " : source[start - 1];
      const after = end === source.length ? " " : source[end];
      if (before === " " && after === " ") occurrences.push({ zone, phrase, start, end });
      cursor = start + Math.max(1, phrase.length);
    }
    return occurrences;
  });
}

function isExcluded(source: string, occurrence: PhraseOccurrence) {
  const before = source.slice(Math.max(0, occurrence.start - 56), occurrence.start).trim();
  const after = source.slice(occurrence.end, Math.min(source.length, occurrence.end + 24)).trim();
  return /(?:^|\s)(?:no|non|esclude|esclusa|escluso|evita|evitare|fuori|tranne)(?:\s+dal|\s+dalla|\s+da|\s+il|\s+la|\s+zona)?\s*$/i.test(before)
    || /^(?:no|esclusa|escluso|da evitare)(?:\s|$)/i.test(after);
}

export function inferRequestZonePreferences(detail: CrmRequestDetail, zones: RequestInferenceZone[]): InferredRequestZone[] {
  const source = normalize(requestEvidenceText(detail));
  if (!source) return [];

  const selected: PhraseOccurrence[] = [];
  const occurrences = zones.flatMap((zone) => phraseOccurrences(source, zone))
    .sort((left, right) => (right.end - right.start) - (left.end - left.start) || left.start - right.start);
  for (const occurrence of occurrences) {
    const overlapsLongerMatch = selected.some((current) => occurrence.start < current.end && occurrence.end > current.start);
    if (!overlapsLongerMatch) selected.push(occurrence);
  }

  const byZone = new Map<string, InferredRequestZone>();
  for (const occurrence of selected.sort((left, right) => left.start - right.start)) {
    const preferenceLevel = isExcluded(source, occurrence) ? "excluded" as const : "preferred" as const;
    const evidence = source.slice(Math.max(0, occurrence.start - 38), Math.min(source.length, occurrence.end + 54)).trim();
    const current = byZone.get(occurrence.zone.id);
    if (!current || preferenceLevel === "excluded") {
      byZone.set(occurrence.zone.id, {
        zone_id: occurrence.zone.id,
        zone_number: occurrence.zone.zone_number,
        zone_name: occurrence.zone.name,
        preference_level: preferenceLevel,
        matched_phrase: occurrence.phrase,
        evidence,
      });
    }
  }
  return [...byZone.values()].sort((left, right) => (left.zone_number ?? 999) - (right.zone_number ?? 999));
}
