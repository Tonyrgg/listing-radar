import type { MatchClassification, MatchingConfig } from "./types";

export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  thresholds: { compatible: 85, almostCompatible: 65, weak: 40 },
  budgetTolerance: { near: 0.05, weak: 0.15 },
  commercialSqm: { minimumFactor: 1.1, maximumFactor: 1.2 },
  weights: {
    propertyType: 15, zone: 20, budget: 20, internalSqm: 15,
    rooms: 10, floor: 5, condition: 5, availability: 5,
  },
};

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function classifyScore(score: number, config = DEFAULT_MATCHING_CONFIG): MatchClassification {
  if (score >= config.thresholds.compatible) return "compatible";
  if (score >= config.thresholds.almostCompatible) return "almost_compatible";
  if (score >= config.thresholds.weak) return "weak";
  return "not_relevant";
}

export function scoreBudget(
  value: number | null,
  ideal: number | null,
  maximum: number | null,
  config = DEFAULT_MATCHING_CONFIG,
) {
  if (value == null || (ideal == null && maximum == null)) return 0.65;
  const target = ideal ?? maximum!;
  const limit = maximum ?? target;
  if (value <= target) return 1;
  if (value <= limit) return 0.85;
  if (value <= limit * (1 + config.budgetTolerance.near)) return 0.55;
  if (value <= limit * (1 + config.budgetTolerance.weak)) return 0.25;
  return 0;
}

export function scoreRange(
  value: number | null,
  minimum: number | null,
  ideal: number | null,
  maximum: number | null,
) {
  if (value == null || (minimum == null && ideal == null && maximum == null)) return 0.65;
  if (minimum != null && value < minimum) return Math.max(0, value / minimum);
  if (maximum != null && value > maximum) return Math.max(0, 1 - (value - maximum) / maximum);
  if (ideal == null) return 1;
  return Math.max(0.75, 1 - Math.abs(value - ideal) / Math.max(ideal, 1));
}

export function estimateCommercialSqm(
  internalSqm: number | null,
  config = DEFAULT_MATCHING_CONFIG,
) {
  if (internalSqm == null) return { minimum: null, maximum: null };
  return {
    minimum: Math.round(internalSqm * config.commercialSqm.minimumFactor),
    maximum: Math.round(internalSqm * config.commercialSqm.maximumFactor),
  };
}

export function sqmCoherenceWarnings(internalSqm: number | null, rooms: number | null) {
  if (internalSqm == null || rooms == null) return [];
  if (rooms >= 5 && internalSqm <= 45) return ["Vani elevati rispetto alla metratura interna"];
  if (rooms <= 2 && internalSqm >= 160) return ["Metratura elevata rispetto al numero di vani"];
  return [];
}

