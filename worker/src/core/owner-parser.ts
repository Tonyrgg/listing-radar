import type { CadastralOwner } from "../types.js";
import { normalizeTaxCode, parseShare } from "./normalize.js";

const PERSON_LINE = /^(.*?)\s+n(?:at[oa]|\.)\s+a\s+(.+?)(?:\s+\(([A-Z]{2})\))?\s+il\s+(\d{2}\/\d{2}\/\d{4})\s*$/i;
const TAX_CODE_LINE = /^(?:[A-Z0-9]{16}|\d{11})$/i;

function isoDate(value: string): string | null {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
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
  return ["proprieta", "nuda proprieta"].includes(normalizeRightType(value));
}

export function parseOwnerBlock(raw: string): CadastralOwner {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const personIndex = lines.findIndex((line) => PERSON_LINE.test(line));
  const personMatch = personIndex >= 0 ? lines[personIndex]!.match(PERSON_LINE) : null;
  const taxCode = lines.find((line) => TAX_CODE_LINE.test(normalizeTaxCode(line))) ?? null;
  const shareLine = [...lines].reverse().find((line) => /^\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?$/.test(line)) ?? "";
  const rightType = lines.find((line, index) => index > personIndex && !TAX_CODE_LINE.test(normalizeTaxCode(line)) && line !== shareLine) ?? "";
  const shareWasDefaulted = !shareLine && isOwnershipRight(rightType);
  const share = parseShare(shareWasDefaulted ? "1/1" : shareLine);

  return {
    fullName: personMatch?.[1]?.trim() ?? lines[0] ?? "",
    birthPlace: personMatch?.[2]?.trim() ?? null,
    birthProvince: personMatch?.[3]?.toUpperCase() ?? null,
    birthDate: personMatch?.[4] ? isoDate(personMatch[4]) : null,
    taxCode: taxCode ? normalizeTaxCode(taxCode) : null,
    rightType,
    shareOriginal: share.original,
    shareNumerator: share.numerator,
    shareDenominator: share.denominator,
    sharePercentage: share.percentage,
    rawPayload: { text: raw, lines, shareDefaulted: shareWasDefaulted },
  };
}

