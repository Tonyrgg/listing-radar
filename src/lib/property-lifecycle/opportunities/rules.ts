import type { AgencyListingState } from "@/lib/property-lifecycle/lifecycle/transitions";
import type { SaleStatus } from "@/lib/property-lifecycle/lifecycle/sale-intelligence";

export type OpportunityLevel = "NONE" | "WATCH" | "INTERESTING" | "HIGH" | "HOT";

export interface OpportunityInput {
  saleStatus: SaleStatus;
  /**
   * Null when no agency has ever listed this property. That is not an agency
   * exit: the exit branches below must not fire for a property whose departure
   * from an agency was never observed.
   */
  agencyListingState: AgencyListingState | null;
  agencyToPrivate: boolean;
  trueMarketAgeDays: number | null;
  priceDropCount: number;
  relaunchCount: number;
}

export interface OpportunityAssessment {
  level: OpportunityLevel;
  score: number;
  reasons: string[];
}

export function assessOpportunity(input: OpportunityInput): OpportunityAssessment {
  if (input.saleStatus === "SOLD_CONFIRMED" || input.agencyListingState === "CLOSED_SOLD") {
    return { level: "NONE", score: 0, reasons: ["sold_confirmed"] };
  }
  if (input.agencyToPrivate || input.agencyListingState === "CLOSED_TO_PRIVATE") {
    return { level: "HOT", score: 100, reasons: ["agency_to_private_confirmed"] };
  }
  if (input.agencyListingState === "OFF_MARKET_NO_SALE_EVIDENCE") {
    return {
      level: "HIGH",
      score: 85,
      reasons: ["agency_exit_confirmed", "no_sale_evidence", "no_new_agency_evidence"],
    };
  }
  if (input.agencyListingState === "CLOSED_SWITCHED") {
    return { level: "INTERESTING", score: 55, reasons: ["agency_switch_confirmed"] };
  }
  if (input.agencyListingState === "EXIT_PENDING") {
    return { level: "INTERESTING", score: 50, reasons: ["agency_exit_under_review"] };
  }

  const reasons: string[] = [];
  let score = 0;
  if ((input.trueMarketAgeDays ?? 0) >= 150) {
    reasons.push("true_market_age_at_least_150_days");
    score += 25;
  }
  if (input.priceDropCount > 0) {
    reasons.push(`price_drops:${input.priceDropCount}`);
    score += Math.min(15, input.priceDropCount * 5);
  }
  if (input.relaunchCount > 0) {
    reasons.push(`relaunches:${input.relaunchCount}`);
    score += Math.min(15, input.relaunchCount * 5);
  }

  return score > 0
    ? { level: "WATCH", score, reasons }
    : { level: "NONE", score: 0, reasons: ["no_current_opportunity_signal"] };
}
