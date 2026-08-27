import {
  identityCandidateIncompatibilities,
  type IdentityObservation,
} from "@/lib/property-lifecycle/identity/scoring";

import type {
  LifecyclePropertySummary,
  LifecycleReviewItem,
} from "./types";

const RECORDED_HARD_CONFLICTS = new Set([
  "locality_conflict",
  "property_type_hard_conflict",
  "street_hard_conflict",
  "surface_hard_conflict",
  "price_hard_conflict",
  "rooms_hard_conflict",
  "price_surface_hard_conflict",
  "price_rooms_hard_conflict",
]);

function observationFromSummary(
  property: LifecyclePropertySummary,
): IdentityObservation {
  return {
    agencyReference: null,
    address: property.address,
    locality: property.locality,
    propertyType: property.propertyType,
    surfaceSqm: property.surfaceSqm,
    rooms: property.rooms,
    priceAmount: property.currentPrice,
    imageFingerprints: [],
    floorplanFingerprints: [],
  };
}

export function evaluateIdentityReviewCandidates(
  property: LifecyclePropertySummary,
  candidates: LifecycleReviewItem["candidates"],
): Pick<LifecycleReviewItem, "candidates" | "automaticExclusions"> {
  const observation = observationFromSummary(property);
  const accepted: LifecycleReviewItem["candidates"] = [];
  const reasons: Record<string, number> = {};

  for (const candidate of candidates) {
    const conflicts = new Set([
      ...identityCandidateIncompatibilities(
        observation,
        observationFromSummary(candidate.property),
      ),
      ...candidate.contradictions.filter((reason) =>
        RECORDED_HARD_CONFLICTS.has(reason),
      ),
    ]);
    if (conflicts.size === 0) {
      accepted.push(candidate);
      continue;
    }
    for (const reason of conflicts) {
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
  }

  return {
    candidates: accepted.slice(0, 3),
    automaticExclusions: {
      count: candidates.length - accepted.length,
      reasons,
    },
  };
}
