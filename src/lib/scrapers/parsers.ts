import { createHash } from "node:crypto";

import { decodeHtmlEntities } from "@/lib/scrapers/html";

export function cleanText(value: string | null | undefined) {
  return decodeHtmlEntities(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value: string) {
  const normalized = value
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

export function parsePrice(text: string | null | undefined) {
  const value = cleanText(text);

  if (!value || /prezzo\s+su\s+richiesta/i.test(value)) {
    return null;
  }

  const amountWithCurrency = value.match(
    /(?:\u20ac\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,\d{1,2})?\s*(?:\u20ac|eur|euro)/i,
  );
  const amount = amountWithCurrency?.[1] ?? null;

  return amount ? parseNumber(amount) : null;
}

export function parseSqm(text: string | null | undefined) {
  const value = cleanText(text);
  const match = value.match(/(\d+(?:[,.]\d+)?)\s*(?:m\u00b2|mq|m2|metri\s+quadri)/i);
  const parsed = match?.[1] ? parseNumber(match[1]) : null;

  return parsed == null ? null : Math.round(parsed);
}

export function parseRooms(text: string | null | undefined) {
  const value = cleanText(text).toLowerCase();
  const namedRooms: Record<string, number> = {
    monolocale: 1,
    bilocale: 2,
    trilocale: 3,
    quadrilocale: 4,
    quadrivani: 4,
    pentavani: 5,
  };

  for (const [label, count] of Object.entries(namedRooms)) {
    if (value.includes(label)) {
      return count;
    }
  }

  const match = value.match(
    /(\d+(?:[,.]\d+)?)\s*(?:locali|locale|vani|vano|stanze|stanza)/i,
  );

  return match?.[1] ? parseNumber(match[1]) : null;
}

export function normalizeUrl(url: string) {
  const normalized = new URL(url, "https://www.subito.it");
  const removableParams = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "from",
  ];

  normalized.hash = "";

  for (const param of removableParams) {
    normalized.searchParams.delete(param);
  }

  return normalized.toString();
}

export function hashDescription(description: string | null | undefined) {
  return createHash("sha1").update(description ?? "").digest("hex");
}
