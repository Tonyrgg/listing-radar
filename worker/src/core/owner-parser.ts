import type { CadastralOwner } from "../types.js";
import { normalizeTaxCode, parseShare } from "./normalize.js";

const PERSON_LINE = /^(.*?)\s+n(?:at[oa]|\.)\s+a\s+(.+?)(?:\s+\(([A-Z]{2})\))?\s+il\s+(\d{2}[/.\-]\d{2}[/.\-]\d{4})\s*$/i;
const PERSON_LINE_DATE_FIRST = /^(.*?)\s+n(?:at[oa]|\.)\s+il\s+(\d{2}[/.\-]\d{2}[/.\-]\d{4})\s+a\s+(.+?)(?:\s+\(([A-Z]{2})\))?\s*$/i;
function taxCodeFromLine(line: string): string | null {
  const withoutLabel = line.replace(/^\s*(?:codice\s+fiscale|c\.?\s*f\.?)\s*[:\-]?\s*/i, "");
  const normalized = normalizeTaxCode(withoutLabel);
  return /^(?:[A-Z0-9]{16}|\d{11})$/i.test(normalized) ? normalized : null;
}

function isoDate(value: string): string | null {
  const match = value.match(/^(\d{2})[/.\-](\d{2})[/.\-](\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

export function normalizeRightType(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .trim()
    .toLowerCase();
}

export function isOwnershipRight(value: string): boolean {
  const normalized = normalizeRightType(value).replace(/\s+/g, " ");
  return /^(?:(?:piena|nuda)\s+)?proprieta(?:\s|$)/.test(normalized)
    || /^(?:nudo\s+)?proprietari[oa](?:\s|$)/.test(normalized);
}

export function parseOwnerBlock(raw: string): CadastralOwner {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const personIndex = lines.findIndex((line) => PERSON_LINE.test(line) || PERSON_LINE_DATE_FIRST.test(line));
  const personLine = personIndex >= 0 ? lines[personIndex]! : "";
  const personMatch = personLine.match(PERSON_LINE);
  const dateFirstMatch = personMatch ? null : personLine.match(PERSON_LINE_DATE_FIRST);
  const taxCode = lines.map(taxCodeFromLine).find(Boolean) ?? null;
  const shareText = lines.map((line, index) => ({ line, index })).reverse()
    .filter(({ line, index }) => index > personIndex && !taxCodeFromLine(line))
    .map(({ line }) => line.match(/\b(\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?)\b/)?.[1] ?? "")
    .find(Boolean) ?? "";
  const rightType = lines.find((line, index) =>
    index > personIndex
    && !taxCodeFromLine(line)
    && isOwnershipRight(line)) ?? "";
  const shareWasDefaulted = !shareText && isOwnershipRight(rightType);
  const share = parseShare(shareWasDefaulted ? "1/1" : shareText);

  return {
    fullName: personMatch?.[1]?.trim() ?? dateFirstMatch?.[1]?.trim() ?? lines[0] ?? "",
    birthPlace: personMatch?.[2]?.trim() ?? dateFirstMatch?.[3]?.trim() ?? null,
    birthProvince: personMatch?.[3]?.toUpperCase() ?? dateFirstMatch?.[4]?.toUpperCase() ?? null,
    birthDate: personMatch?.[4] ? isoDate(personMatch[4]) : dateFirstMatch?.[2] ? isoDate(dateFirstMatch[2]) : null,
    taxCode: taxCode ? normalizeTaxCode(taxCode) : null,
    rightType,
    shareOriginal: share.original,
    shareNumerator: share.numerator,
    shareDenominator: share.denominator,
    sharePercentage: share.percentage,
    rawPayload: { text: raw, lines, shareDefaulted: shareWasDefaulted, parserVersion: 2 },
  };
}

