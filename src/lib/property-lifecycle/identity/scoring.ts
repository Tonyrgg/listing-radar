export interface IdentityObservation {
  agencyReference: string | null;
  address: string | null;
  locality: string | null;
  propertyType: string | null;
  surfaceSqm: number | null;
  rooms: number | null;
  floor?: string | null;
  priceAmount?: number | null;
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
  retrieval?: {
    inputCount: number;
    includedCount: number;
    discardedCount: number;
    discardedReasons: Record<string, number>;
  };
}

export interface IdentityDecisionOptions {
  allowExactCivicAddressEvidence?: boolean;
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
  floor: 0.05,
  price: 0.07,
} as const;

/**
 * Una differenza di prezzo o metratura può essere un semplice aggiornamento;
 * oltre queste soglie non è più una candidata utile senza una correzione
 * esplicita della fonte. Una via nominata in modo diverso è sempre un blocco.
 */
export const IDENTITY_HARD_CONFLICT_THRESHOLDS = {
  /* Un ribasso fisiologico non deve spezzare una storia, ma un quarto del
   * valore o della superficie non descrive piu la stessa unita senza una
   * prova forte e verificabile. */
  priceRelativeDifference: 0.28,
  surfaceRelativeDifference: 0.25,
  roomsAbsoluteDifference: 2,
  /* Due scostamenti moderati insieme sono piu affidabili di uno solo:
   * evitano che un 3-locali da 80 mq a tutt'altro prezzo finisca in coda
   * soltanto perche ciascun dato, isolato, resta appena sotto soglia. */
  priceAndSurface: {
    priceRelativeDifference: 0.2,
    surfaceRelativeDifference: 0.15,
  },
  priceAndRooms: {
    priceRelativeDifference: 0.2,
    roomsAbsoluteDifference: 1,
  },
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

function normalizedAddressTokens(value: string | null): Set<string> {
  const tokens = normalizedTokens(value);
  for (const genericPlace of ["bitonto", "palombaio", "mariotto", "bari", "ba"]) {
    tokens.delete(genericPlace);
  }
  return tokens;
}

function namedStreetTokens(value: string | null): Set<string> {
  return new Set(
    [...normalizedAddressTokens(value)].filter((token) => !/\d/.test(token)),
  );
}

function hasExplicitStreetConflict(left: string | null, right: string | null): boolean {
  const leftTokens = namedStreetTokens(left);
  const rightTokens = namedStreetTokens(right);
  return (
    leftTokens.size > 0 &&
    rightTokens.size > 0 &&
    ![...leftTokens].some((token) => rightTokens.has(token))
  );
}

function sharesCivicToken(left: string | null, right: string | null): boolean {
  const rightTokens = normalizedAddressTokens(right);
  return [...normalizedAddressTokens(left)].some(
    (token) => /\d/.test(token) && rightTokens.has(token),
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

function perceptualSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  const [leftAlgorithm, leftValue] = left.split(":", 2);
  const [rightAlgorithm, rightValue] = right.split(":", 2);
  if (
    leftAlgorithm !== "DHASH64" ||
    rightAlgorithm !== "DHASH64" ||
    !leftValue ||
    !rightValue ||
    leftValue.length !== rightValue.length ||
    !/^[01]+$/.test(leftValue) ||
    !/^[01]+$/.test(rightValue)
  ) {
    return 0;
  }
  let differences = 0;
  for (let index = 0; index < leftValue.length; index += 1) {
    if (leftValue[index] !== rightValue[index]) {
      differences += 1;
    }
  }
  return 1 - differences / leftValue.length;
}

function overlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  return Math.max(
    ...left.flatMap((leftValue) =>
      right.map((rightValue) => perceptualSimilarity(leftValue, rightValue)),
    ),
  );
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

function normalizedFloor(value: string | null | undefined): string | null {
  const normalized = (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/\b(?:piano|°|º)\b/g, " ")
    .replace(/[^a-z0-9+-]+/g, " ")
    .trim();
  return normalized || null;
}

function relativeDifference(left: number | null | undefined, right: number | null | undefined): number | null {
  if (left == null || right == null) {
    return null;
  }
  return Math.abs(left - right) / Math.max(left, right, 1);
}

/** Motivi deterministici per cui due annunci non possono essere la stessa casa. */
export function identityHardConflicts(
  observation: IdentityObservation,
  candidate: IdentityObservation,
): string[] {
  const conflicts: string[] = [];
  const surfaceDifference = relativeDifference(observation.surfaceSqm, candidate.surfaceSqm);
  const priceDifference = relativeDifference(observation.priceAmount, candidate.priceAmount);
  const roomsDifference =
    observation.rooms == null || candidate.rooms == null
      ? null
      : Math.abs(observation.rooms - candidate.rooms);

  if (hasExplicitStreetConflict(observation.address, candidate.address)) {
    conflicts.push("street_hard_conflict");
  }
  if (
    surfaceDifference != null &&
    surfaceDifference > IDENTITY_HARD_CONFLICT_THRESHOLDS.surfaceRelativeDifference
  ) {
    conflicts.push("surface_hard_conflict");
  }
  if (
    priceDifference != null &&
    priceDifference > IDENTITY_HARD_CONFLICT_THRESHOLDS.priceRelativeDifference
  ) {
    conflicts.push("price_hard_conflict");
  }
  if (
    roomsDifference != null &&
    roomsDifference >= IDENTITY_HARD_CONFLICT_THRESHOLDS.roomsAbsoluteDifference
  ) {
    conflicts.push("rooms_hard_conflict");
  }
  if (
    priceDifference != null &&
    surfaceDifference != null &&
    priceDifference > IDENTITY_HARD_CONFLICT_THRESHOLDS.priceAndSurface.priceRelativeDifference &&
    surfaceDifference > IDENTITY_HARD_CONFLICT_THRESHOLDS.priceAndSurface.surfaceRelativeDifference
  ) {
    conflicts.push("price_surface_hard_conflict");
  }
  if (
    priceDifference != null &&
    roomsDifference != null &&
    priceDifference > IDENTITY_HARD_CONFLICT_THRESHOLDS.priceAndRooms.priceRelativeDifference &&
    roomsDifference >= IDENTITY_HARD_CONFLICT_THRESHOLDS.priceAndRooms.roomsAbsoluteDifference
  ) {
    conflicts.push("price_rooms_hard_conflict");
  }
  return conflicts;
}

function propertyTypeFamily(value: string | null): string | null {
  const normalized = [...normalizedTokens(value)].join(" ");
  if (!normalized) return null;
  if (/garage|box|posto auto|autorimessa/.test(normalized)) return "GARAGE";
  if (/terreno|agricol|suolo/.test(normalized)) return "LAND";
  if (/locale|negozio|commerciale|ufficio|deposito|capannone/.test(normalized)) return "COMMERCIAL";
  if (/villa|casa indipendente|palazzo|stabile/.test(normalized)) return "INDEPENDENT";
  if (/appartamento|attico|mansarda|loft/.test(normalized)) return "APARTMENT";
  return normalized;
}

/**
 * Barriera unica usata sia durante l'acquisizione sia quando una vecchia
 * revisione viene riletta. Una candidata incompatibile non puo riapparire
 * soltanto perche il caso e nato con regole meno severe.
 */
export function identityCandidateIncompatibilities(
  observation: IdentityObservation,
  candidate: IdentityObservation,
): string[] {
  const conflicts = identityHardConflicts(observation, candidate);
  if (
    comparableText(observation.locality, candidate.locality) &&
    exactText(observation.locality, candidate.locality) !== 1
  ) {
    conflicts.push("locality_conflict");
  }
  const observationFamily = propertyTypeFamily(observation.propertyType);
  const candidateFamily = propertyTypeFamily(candidate.propertyType);
  if (
    observationFamily &&
    candidateFamily &&
    observationFamily !== candidateFamily
  ) {
    conflicts.push("property_type_hard_conflict");
  }
  return conflicts;
}

function incrementReason(target: Record<string, number>, reason: string): void {
  target[reason] = (target[reason] ?? 0) + 1;
}

export function retrieveIdentityCandidates(
  observation: IdentityObservation,
  candidates: IdentityCandidate[],
): {
  candidates: IdentityCandidate[];
  discardedCount: number;
  discardedReasons: Record<string, number>;
} {
  const included: IdentityCandidate[] = [];
  const discardedReasons: Record<string, number> = {};
  const observationAddress = normalizedAddressTokens(observation.address);

  for (const candidate of candidates) {
    const candidateAddress = normalizedAddressTokens(candidate.address);
    const localityMatches = exactText(observation.locality, candidate.locality) === 1;
    const surfaceDifference = relativeDifference(observation.surfaceSqm, candidate.surfaceSqm);
    const roomsDifference =
      observation.rooms == null || candidate.rooms == null
        ? null
        : Math.abs(observation.rooms - candidate.rooms);
    const hardConflicts = identityCandidateIncompatibilities(observation, candidate);
    if (hardConflicts.length) {
      hardConflicts.forEach((reason) => incrementReason(discardedReasons, reason));
      continue;
    }

    const exactAgencyReference = Boolean(
      observation.agencyReference &&
        candidate.knownAgencyReferences.some(
          (reference) =>
            reference.localeCompare(observation.agencyReference ?? "", "it", {
              sensitivity: "base",
            }) === 0,
        ),
    );
    const addressScore = jaccard(observationAddress, candidateAddress);
    const exactCivic = sharesCivicToken(observation.address, candidate.address);
    const imageScore = overlap(
      observation.imageFingerprints,
      candidate.imageFingerprints,
    );
    const floorplanScore = overlap(
      observation.floorplanFingerprints,
      candidate.floorplanFingerprints,
    );
    const floorsMatch =
      normalizedFloor(observation.floor) != null &&
      normalizedFloor(observation.floor) === normalizedFloor(candidate.floor);
    const strongMedia = imageScore >= 0.78 || floorplanScore >= 0.8;
    const exactCivicBlock = exactCivic && addressScore >= 0.5;
    const streetAndFactsBlock =
      addressScore >= 0.5 &&
      surfaceDifference != null &&
      surfaceDifference <= 0.25 &&
      (roomsDifference == null || roomsDifference <= 1);
    const incompleteLocationBlock =
      localityMatches &&
      surfaceDifference != null &&
      surfaceDifference <= 0.12 &&
      roomsDifference != null &&
      roomsDifference <= 0.5 &&
      floorsMatch;

    if (
      exactAgencyReference ||
      strongMedia ||
      exactCivicBlock ||
      streetAndFactsBlock ||
      incompleteLocationBlock
    ) {
      included.push(candidate);
    } else {
      incrementReason(discardedReasons, "insufficient_blocking_evidence");
    }
  }

  return {
    candidates: included,
    discardedCount: candidates.length - included.length,
    discardedReasons,
  };
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
  const addressTokens = normalizedAddressTokens(observation.address);
  const candidateAddressTokens = normalizedAddressTokens(candidate.address);
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
  const imageSimilarity = overlap(
    observation.imageFingerprints,
    candidate.imageFingerprints,
  );
  const floorplanSimilarity = overlap(
    observation.floorplanFingerprints,
    candidate.floorplanFingerprints,
  );
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
      imageSimilarity,
      FEATURE_WEIGHTS.image,
      observation.imageFingerprints.length > 0 &&
        candidate.imageFingerprints.length > 0 &&
        imageSimilarity >= 0.55,
    ),
    floorplan: feature(
      floorplanSimilarity,
      FEATURE_WEIGHTS.floorplan,
      observation.floorplanFingerprints.length > 0 &&
        candidate.floorplanFingerprints.length > 0 &&
        floorplanSimilarity >= 0.7,
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
    floor: feature(
      exactText(normalizedFloor(observation.floor), normalizedFloor(candidate.floor)),
      FEATURE_WEIGHTS.floor,
      comparableText(normalizedFloor(observation.floor), normalizedFloor(candidate.floor)),
    ),
    price: feature(
      numericSimilarity(observation.priceAmount ?? null, candidate.priceAmount ?? null, 0.35),
      FEATURE_WEIGHTS.price,
      observation.priceAmount != null && candidate.priceAmount != null,
    ),
  };
  const contradictions: string[] = [];

  identityHardConflicts(observation, candidate).forEach((conflict) => {
    contradictions.push(conflict);
  });

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
      IDENTITY_HARD_CONFLICT_THRESHOLDS.surfaceRelativeDifference
  ) {
    contradictions.push("surface_conflict");
  }
  if (
    comparableText(observation.propertyType, candidate.propertyType) &&
    features.propertyType.value === 0
  ) {
    contradictions.push("property_type_conflict");
  }
  if (
    (relativeDifference(observation.priceAmount, candidate.priceAmount) ?? 0) >
    IDENTITY_HARD_CONFLICT_THRESHOLDS.priceRelativeDifference
  ) {
    contradictions.push("price_conflict");
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
  options: IdentityDecisionOptions = {},
): IdentityDecision {
  const retrieval = retrieveIdentityCandidates(observation, candidates);
  const ranked = retrieval.candidates
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
      retrieval: {
        inputCount: candidates.length,
        includedCount: retrieval.candidates.length,
        discardedCount: retrieval.discardedCount,
        discardedReasons: retrieval.discardedReasons,
      },
    };
  }

  const margin = Number((top.score - (ranked[1]?.score ?? 0)).toFixed(4));
  const topCandidate = retrieval.candidates.find(
    (candidate) => candidate.propertyId === top.propertyId,
  );
  const availableWeight = Object.values(top.features)
    .filter((featureScore) => featureScore.available)
    .reduce((sum, featureScore) => sum + featureScore.weight, 0);
  const strongImage = top.features.image.available && top.features.image.value >= 0.8;
  const strongFloorplan =
    top.features.floorplan.available && top.features.floorplan.value >= 0.8;
  const exactReference =
    top.features.agencyReference.available && top.features.agencyReference.value === 1;
  const referenceCorroborated = Boolean(
    exactReference &&
      topCandidate &&
      (strongImage ||
        strongFloorplan ||
        sharesCivicToken(observation.address, topCandidate.address) ||
        (top.features.surface.available &&
          top.features.surface.value >= 0.9 &&
          top.features.floor.available &&
          top.features.floor.value === 1)),
  );
  const hasStrongEvidence = strongImage || strongFloorplan || referenceCorroborated;
  const hasExactCivicEvidence = Boolean(
    options.allowExactCivicAddressEvidence &&
      topCandidate &&
      top.features.address.available &&
      top.features.address.value >= 0.8 &&
      sharesCivicToken(observation.address, topCandidate.address),
  );
  const floorplanNeedsCorroboration =
    top.features.floorplan.available &&
    top.features.floorplan.value >= 0.8 &&
    ![
      top.features.agencyReference,
      top.features.address,
      top.features.image,
      top.features.surface,
    ].some((featureScore) => featureScore.available && featureScore.value >= 0.8);
  const autoMatch =
    top.score >= 0.86 &&
    margin >= 0.12 &&
    availableWeight >= 0.35 &&
    (hasStrongEvidence || hasExactCivicEvidence) &&
    !floorplanNeedsCorroboration &&
    top.contradictions.length === 0;

  return {
    outcome: autoMatch ? "AUTO_MATCH" : "REVIEW_REQUIRED",
    propertyId: autoMatch ? top.propertyId : null,
    score: top.score,
    margin,
    candidates: ranked,
    retrieval: {
      inputCount: candidates.length,
      includedCount: retrieval.candidates.length,
      discardedCount: retrieval.discardedCount,
      discardedReasons: retrieval.discardedReasons,
    },
  };
}
