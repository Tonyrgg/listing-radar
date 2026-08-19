export interface IdentityObservation {
  agencyReference: string | null;
  address: string | null;
  locality: string | null;
  propertyType: string | null;
  surfaceSqm: number | null;
  rooms: number | null;
  imageFingerprints: string[];
  floorplanFingerprints: string[];
}

export interface IdentityCandidate extends IdentityObservation {
  propertyId: string;
  knownAgencyReferences: string[];
}

export interface IdentityFeatureScore {
  value: number;
  weight: number;
  contribution: number;
  available: boolean;
}

export interface RankedIdentityCandidate {
  propertyId: string;
  score: number;
  rank: number;
  features: Record<string, IdentityFeatureScore>;
  contradictions: string[];
}

export type IdentityOutcome = "AUTO_MATCH" | "REVIEW_REQUIRED" | "NEW_PROPERTY";

export interface IdentityDecision {
  outcome: IdentityOutcome;
  propertyId: string | null;
  score: number;
  margin: number;
  candidates: RankedIdentityCandidate[];
}

const FEATURE_WEIGHTS = {
  agencyReference: 0.3,
  address: 0.25,
  locality: 0.08,
  image: 0.2,
  floorplan: 0.25,
  surface: 0.1,
  rooms: 0.04,
  propertyType: 0.03,
} as const;

function normalizedTokens(value: string | null): Set<string> {
  return new Set(
    (value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("it")
      .replace(/\b(?:via|viale|piazza|zona|contrada|strada|di|del|della)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  const intersection = [...left].filter((value) => right.has(value)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function overlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value)) ? 1 : 0;
}

function comparableText(left: string | null, right: string | null): boolean {
  return Boolean(left && right);
}

function exactText(left: string | null, right: string | null): number {
  if (!left || !right) {
    return 0;
  }
  return left.localeCompare(right, "it", { sensitivity: "base" }) === 0 ? 1 : 0;
}

function numericSimilarity(left: number | null, right: number | null, tolerance: number): number {
  if (left == null || right == null) {
    return 0;
  }
  const relativeDifference = Math.abs(left - right) / Math.max(left, right, 1);
  return Math.max(0, 1 - relativeDifference / tolerance);
}

function feature(value: number, weight: number, available: boolean): IdentityFeatureScore {
  return { value, weight, available, contribution: available ? value * weight : 0 };
}

export function scoreIdentityCandidate(
  observation: IdentityObservation,
  candidate: IdentityCandidate,
): Omit<RankedIdentityCandidate, "rank"> {
  const addressTokens = normalizedTokens(observation.address);
  const candidateAddressTokens = normalizedTokens(candidate.address);
  const agencyReferenceAvailable = Boolean(
    observation.agencyReference && candidate.knownAgencyReferences.length > 0,
  );
  const agencyReferenceScore = observation.agencyReference
    ? candidate.knownAgencyReferences.some(
        (value) => value.localeCompare(observation.agencyReference ?? "", "it", { sensitivity: "base" }) === 0,
      )
      ? 1
      : 0
    : 0;
  const features = {
    agencyReference: feature(
      agencyReferenceScore,
      FEATURE_WEIGHTS.agencyReference,
      agencyReferenceAvailable,
    ),
    address: feature(
      jaccard(addressTokens, candidateAddressTokens),
      FEATURE_WEIGHTS.address,
      addressTokens.size > 0 && candidateAddressTokens.size > 0,
    ),
    locality: feature(
      exactText(observation.locality, candidate.locality),
      FEATURE_WEIGHTS.locality,
      comparableText(observation.locality, candidate.locality),
    ),
    image: feature(
      overlap(observation.imageFingerprints, candidate.imageFingerprints),
      FEATURE_WEIGHTS.image,
      observation.imageFingerprints.length > 0 && candidate.imageFingerprints.length > 0,
    ),
    floorplan: feature(
      overlap(observation.floorplanFingerprints, candidate.floorplanFingerprints),
      FEATURE_WEIGHTS.floorplan,
      observation.floorplanFingerprints.length > 0 && candidate.floorplanFingerprints.length > 0,
    ),
    surface: feature(
      numericSimilarity(observation.surfaceSqm, candidate.surfaceSqm, 0.2),
      FEATURE_WEIGHTS.surface,
      observation.surfaceSqm != null && candidate.surfaceSqm != null,
    ),
    rooms: feature(
      numericSimilarity(observation.rooms, candidate.rooms, 0.35),
      FEATURE_WEIGHTS.rooms,
      observation.rooms != null && candidate.rooms != null,
    ),
    propertyType: feature(
      exactText(observation.propertyType, candidate.propertyType),
      FEATURE_WEIGHTS.propertyType,
      comparableText(observation.propertyType, candidate.propertyType),
    ),
  };
  const contradictions: string[] = [];

  if (
    addressTokens.size >= 2 &&
    candidateAddressTokens.size >= 2 &&
    features.address.value === 0
  ) {
    contradictions.push("explicit_address_conflict");
  }
  if (
    comparableText(observation.locality, candidate.locality) &&
    features.locality.value === 0
  ) {
    contradictions.push("locality_conflict");
  }
  if (
    observation.surfaceSqm != null &&
    candidate.surfaceSqm != null &&
    Math.abs(observation.surfaceSqm - candidate.surfaceSqm) /
      Math.max(observation.surfaceSqm, candidate.surfaceSqm, 1) >
      0.35
  ) {
    contradictions.push("surface_conflict");
  }
  if (
    comparableText(observation.propertyType, candidate.propertyType) &&
    features.propertyType.value === 0
  ) {
    contradictions.push("property_type_conflict");
  }

  const availableFeatures = Object.values(features).filter((value) => value.available);
  const availableWeight = availableFeatures.reduce((sum, value) => sum + value.weight, 0);
  const weightedScore =
    availableWeight > 0
      ? availableFeatures.reduce((sum, value) => sum + value.contribution, 0) / availableWeight
      : 0;
  const contradictionPenalty = Math.min(0.75, contradictions.length * 0.25);

  return {
    propertyId: candidate.propertyId,
    score: Number(Math.max(0, weightedScore - contradictionPenalty).toFixed(4)),
    features,
    contradictions,
  };
}

export function decidePropertyIdentity(
  observation: IdentityObservation,
  candidates: IdentityCandidate[],
): IdentityDecision {
  const ranked = candidates
    .map((candidate) => scoreIdentityCandidate(observation, candidate))
    .sort((left, right) => right.score - left.score)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const top = ranked[0];

  if (!top || top.score < 0.58) {
    return {
      outcome: "NEW_PROPERTY",
      propertyId: null,
      score: top?.score ?? 0,
      margin: top ? top.score - (ranked[1]?.score ?? 0) : 0,
      candidates: ranked,
    };
  }

  const margin = Number((top.score - (ranked[1]?.score ?? 0)).toFixed(4));
  const availableWeight = Object.values(top.features)
    .filter((featureScore) => featureScore.available)
    .reduce((sum, featureScore) => sum + featureScore.weight, 0);
  const hasStrongEvidence = [
    top.features.agencyReference,
    top.features.address,
    top.features.image,
    top.features.floorplan,
  ].some((featureScore) => featureScore.available && featureScore.value >= 0.8);
  const autoMatch =
    top.score >= 0.86 &&
    margin >= 0.12 &&
    availableWeight >= 0.35 &&
    hasStrongEvidence &&
    top.contradictions.length === 0;

  return {
    outcome: autoMatch ? "AUTO_MATCH" : "REVIEW_REQUIRED",
    propertyId: autoMatch ? top.propertyId : null,
    score: top.score,
    margin,
    candidates: ranked,
  };
}
