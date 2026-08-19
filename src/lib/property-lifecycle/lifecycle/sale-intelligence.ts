export type SaleStatus =
  | "UNKNOWN"
  | "PROBABLE_SOLD"
  | "SOLD_CONFIRMED"
  | "NOT_SOLD_CONFIRMED";

export interface SaleEvidenceInput {
  explicitSourceSold: boolean;
  soldGraphic: boolean;
  trustedPortalSold: boolean;
  manualStatus?: SaleStatus | null;
  otherActivePublication: boolean;
}

export interface SaleAssessment {
  status: SaleStatus;
  confidence: number;
  reasons: string[];
  requiresReview: boolean;
}

export function assessSaleStatus(input: SaleEvidenceInput): SaleAssessment {
  if (input.manualStatus) {
    return {
      status: input.manualStatus,
      confidence: 1,
      reasons: ["human_verified_override"],
      requiresReview: false,
    };
  }

  const deterministicEvidence = [
    input.explicitSourceSold && "explicit_source_sold",
    input.soldGraphic && "sold_graphic",
    input.trustedPortalSold && "trusted_portal_sold",
  ].filter((reason): reason is string => Boolean(reason));

  if (deterministicEvidence.length > 0 && input.otherActivePublication) {
    return {
      status: "PROBABLE_SOLD",
      confidence: 0.65,
      reasons: [...deterministicEvidence, "conflicting_active_publication"],
      requiresReview: true,
    };
  }

  if (deterministicEvidence.length > 0) {
    return {
      status: "SOLD_CONFIRMED",
      confidence: 0.98,
      reasons: deterministicEvidence,
      requiresReview: false,
    };
  }

  return {
    status: "UNKNOWN",
    confidence: 0.2,
    reasons: ["no_deterministic_sale_evidence"],
    requiresReview: false,
  };
}
