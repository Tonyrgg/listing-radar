import type { SellerType } from "@/types";

const AGENCY_SOURCES = new Set([
  "admaiora",
  "futura",
  "iconacasa",
  "ingegnericolapinto",
  "immobiliaririunite",
  "puntocasa",
  "studisanti",
  "vistocasa",
]);

const AGENCY_NAME_PATTERNS = [
  /\bagenzia\b/i,
  /\bimmobiliar(?:e|i)\b/i,
  /\breal\s+estate\b/i,
  /\bprofessionista\b/i,
  /\b(?:tecnocasa|tecnorete|tempocasa|gabetti|re\/?max|professionecasa|toscano|iconacasa)\b/i,
  /\b(?:s\.?r\.?l\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|s\.?p\.?a\.?)\b/i,
  /\b(?:intermediazione|mediazione)\s+immobiliare\b/i,
];

const AGENCY_CONTENT_PATTERNS = [
  /\bagenzia\s+immobiliare\b/i,
  /\bnostr[ao]\s+agenzia\b/i,
  /\bconsulent[ei]\s+immobiliar[ei]\b/i,
  /\bprovvigione\b/i,
  /\bintermediazione\s+immobiliare\b/i,
  /\bcod(?:ice)?\.?\s*(?:annuncio|rif(?:erimento)?)\b/i,
];

const PRIVATE_PATTERNS = [
  /\bprivato\s+(?:vende|affitta|propone)\b/i,
  /\bvendita\s+(?:diretta|da\s+privato)\b/i,
  /\baffitto\s+da\s+privato\b/i,
  /\bno\s+(?:agenzie|intermediari)\b/i,
  /\bsenza\s+(?:agenzia|intermediazione)\b/i,
];

export type SellerClassification = {
  sellerType: SellerType;
  confidence: number;
  reasons: string[];
};

export type SellerClassificationInput = {
  source?: string | null;
  declaredType?: SellerType | null;
  sellerName?: string | null;
  title?: string | null;
  description?: string | null;
};

function matchingLabels(value: string, patterns: RegExp[]) {
  return patterns
    .filter((pattern) => pattern.test(value))
    .map((pattern) => pattern.source);
}

export function classifySeller(
  input: SellerClassificationInput,
): SellerClassification {
  const source = (input.source ?? "").trim().toLowerCase();
  const sellerName = input.sellerName ?? "";
  const content = [input.title, input.description].filter(Boolean).join(" ");
  const agencyNameSignals = matchingLabels(sellerName, AGENCY_NAME_PATTERNS);
  const agencyContentSignals = matchingLabels(content, AGENCY_CONTENT_PATTERNS);
  const privateSignals = matchingLabels(
    [sellerName, content].filter(Boolean).join(" "),
    PRIVATE_PATTERNS,
  );

  if (AGENCY_SOURCES.has(source)) {
    return {
      sellerType: "agency",
      confidence: 1,
      reasons: [`agency-source:${source}`],
    };
  }

  if (agencyNameSignals.length) {
    return {
      sellerType: "agency",
      confidence: 0.99,
      reasons: agencyNameSignals.map((signal) => `agency-name:${signal}`),
    };
  }

  if (input.declaredType === "agency" || agencyContentSignals.length >= 2) {
    return {
      sellerType: "agency",
      confidence: input.declaredType === "agency" ? 0.97 : 0.92,
      reasons: [
        ...(input.declaredType === "agency" ? ["portal-declared:agency"] : []),
        ...agencyContentSignals.map((signal) => `agency-content:${signal}`),
      ],
    };
  }

  if (privateSignals.length) {
    return {
      sellerType: "private",
      confidence: 0.96,
      reasons: privateSignals.map((signal) => `private-content:${signal}`),
    };
  }

  if (input.declaredType === "private") {
    return {
      sellerType: "private",
      confidence: 0.72,
      reasons: ["portal-declared:private"],
    };
  }

  return {
    sellerType: "unknown",
    confidence: 0,
    reasons: ["no-reliable-seller-signal"],
  };
}

export function mergeSellerType(
  current: SellerType | null | undefined,
  incoming: SellerType,
): SellerType {
  if (current === "agency" || incoming === "agency") return "agency";
  if (current === "private" || incoming === "private") return "private";
  return "unknown";
}
