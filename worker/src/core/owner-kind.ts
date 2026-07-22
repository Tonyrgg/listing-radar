import { normalizeTaxCode } from "./normalize.js";

export type BusinessOwnerReason = "business-tax-code" | "legal-form";

const LEGAL_FORM = /\b(?:SRL|SRLS|SPA|SAPA|SNC|SAS|SCARL|SOCIETA|COOPERATIVA|CONSORZIO|FONDAZIONE|ASSOCIAZIONE|IMPRESA|DITTA)\b/;

function normalizeBusinessName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\bS\W*R\W*L\W*S\b/g, " SRLS ")
    .replace(/\bS\W*R\W*L\b/g, " SRL ")
    .replace(/\bS\W*P\W*A\b/g, " SPA ")
    .replace(/\bS\W*A\W*P\W*A\b/g, " SAPA ")
    .replace(/\bS\W*N\W*C\b/g, " SNC ")
    .replace(/\bS\W*A\W*S\b/g, " SAS ")
    .replace(/\bS\W*C\W*A\W*R\W*L\b/g, " SCARL ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function businessOwnerReason(fullName: string, taxCode: string | null): BusinessOwnerReason | null {
  const normalizedTaxCode = normalizeTaxCode(taxCode);
  if (/^\d{11}$/.test(normalizedTaxCode)) return "business-tax-code";
  return LEGAL_FORM.test(normalizeBusinessName(fullName)) ? "legal-form" : null;
}

export function isBusinessOwner(fullName: string, taxCode: string | null): boolean {
  return businessOwnerReason(fullName, taxCode) !== null;
}

export function maskOwnerTaxCode(value: string | null): string | null {
  const normalized = normalizeTaxCode(value);
  if (!normalized) return null;
  if (normalized.length <= 4) return "*".repeat(normalized.length);
  return `${normalized.slice(0, 3)}${"*".repeat(normalized.length - 5)}${normalized.slice(-2)}`;
}
