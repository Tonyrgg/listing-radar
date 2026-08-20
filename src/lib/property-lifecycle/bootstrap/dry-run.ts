import type { PropertyLifecycleAdapter } from "@/lib/property-lifecycle/adapters/types";
import {
  processListingAssets,
  type AssetProcessingResult,
} from "@/lib/property-lifecycle/assets/pipeline";
import type {
  AdapterHealthState,
  NormalizedListingV2,
} from "@/lib/property-lifecycle/contracts/normalized-listing";
import {
  decidePropertyIdentity,
  type IdentityCandidate,
  type IdentityDecision,
  type IdentityObservation,
} from "@/lib/property-lifecycle/identity/scoring";
import { identityObservationFromListing } from "@/lib/property-lifecycle/persistence/repository";

export interface BootstrapExistingProperty {
  propertyId: string;
  agencySlugs: string[];
  agencyReferences: Record<string, string[]>;
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

export interface BootstrapExistingState {
  properties: BootstrapExistingProperty[];
  publicationKeys: string[];
  warnings?: string[];
}

export interface BootstrapDryRunDecision {
  agencySlug: string;
  sourceKey: string;
  externalId: string;
  action:
    | "EXISTING_PUBLICATION"
    | "CREATE_PROPERTY"
    | "MATCH_PROPERTY"
    | "CREATE_REVIEW_PROPERTY";
  predictedPropertyId: string | null;
  identityOutcome: IdentityDecision["outcome"] | "EXISTING_PUBLICATION";
  score: number;
  margin: number;
  candidateCount: number;
  discardedCandidateCount: number;
  crossAgencyMatch: boolean;
  warnings: string[];
}

export interface BootstrapDryRunAgencyReport {
  agencySlug: string;
  adapterKey: string;
  healthState: AdapterHealthState;
  inventoryComplete: boolean;
  rawListings: number;
  normalizedListings: number;
  acceptedListings: number;
  excludedListings: number;
  errorCount: number;
  warnings: string[];
}

export interface BootstrapDryRunSourceFailure {
  agencySlug: string;
  adapterKey: string;
  healthState: AdapterHealthState;
  reasons: string[];
}

export interface BootstrapDryRunReport {
  reportVersion: 1;
  generatedAt: string;
  nonMutating: true;
  totals: {
    rawListings: number;
    acceptedListings: number;
    predictedProperties: number;
    predictedNewProperties: number;
    predictedPublications: number;
    existingPublications: number;
    duplicateMatches: number;
    crossAgencyMatches: number;
    reviewRequiredCases: number;
    sourceFailures: number;
    warningCount: number;
    scoredCandidatePairs: number;
    discardedCandidatePairs: number;
  };
  agencies: BootstrapDryRunAgencyReport[];
  decisions: BootstrapDryRunDecision[];
  sourceFailures: BootstrapDryRunSourceFailure[];
  warnings: string[];
}

type MutableCandidate = BootstrapExistingProperty;

function publicationKey(agencySlug: string, sourceKey: string): string {
  return agencySlug + "\u0000" + sourceKey;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function identityCandidate(
  candidate: MutableCandidate,
  agencySlug: string,
): IdentityCandidate {
  return {
    propertyId: candidate.propertyId,
    agencyReference: null,
    knownAgencyReferences: candidate.agencyReferences[agencySlug] ?? [],
    address: candidate.address,
    locality: candidate.locality,
    propertyType: candidate.propertyType,
    surfaceSqm: candidate.surfaceSqm,
    rooms: candidate.rooms,
    floor: candidate.floor,
    priceAmount: candidate.priceAmount,
    imageFingerprints: candidate.imageFingerprints,
    floorplanFingerprints: candidate.floorplanFingerprints,
  };
}

function candidateFromObservation(input: {
  propertyId: string;
  agencySlug: string;
  observation: IdentityObservation;
}): MutableCandidate {
  return {
    propertyId: input.propertyId,
    agencySlugs: [input.agencySlug],
    agencyReferences: input.observation.agencyReference
      ? { [input.agencySlug]: [input.observation.agencyReference] }
      : {},
    address: input.observation.address,
    locality: input.observation.locality,
    propertyType: input.observation.propertyType,
    surfaceSqm: input.observation.surfaceSqm,
    rooms: input.observation.rooms,
    floor: input.observation.floor,
    priceAmount: input.observation.priceAmount,
    imageFingerprints: input.observation.imageFingerprints,
    floorplanFingerprints: input.observation.floorplanFingerprints,
  };
}

function mergeObservation(
  candidate: MutableCandidate,
  agencySlug: string,
  observation: IdentityObservation,
): void {
  candidate.agencySlugs = unique([...candidate.agencySlugs, agencySlug]);
  if (observation.agencyReference) {
    candidate.agencyReferences[agencySlug] = unique([
      ...(candidate.agencyReferences[agencySlug] ?? []),
      observation.agencyReference,
    ]);
  }
  candidate.address ??= observation.address;
  candidate.locality ??= observation.locality;
  candidate.propertyType ??= observation.propertyType;
  candidate.surfaceSqm ??= observation.surfaceSqm;
  candidate.rooms ??= observation.rooms;
  candidate.floor ??= observation.floor;
  candidate.priceAmount ??= observation.priceAmount;
  candidate.imageFingerprints = unique([
    ...candidate.imageFingerprints,
    ...observation.imageFingerprints,
  ]);
  candidate.floorplanFingerprints = unique([
    ...candidate.floorplanFingerprints,
    ...observation.floorplanFingerprints,
  ]);
}

function cloneExistingProperty(candidate: BootstrapExistingProperty): MutableCandidate {
  return {
    ...candidate,
    agencySlugs: [...candidate.agencySlugs],
    agencyReferences: Object.fromEntries(
      Object.entries(candidate.agencyReferences).map(([slug, references]) => [
        slug,
        [...references],
      ]),
    ),
    imageFingerprints: [...candidate.imageFingerprints],
    floorplanFingerprints: [...candidate.floorplanFingerprints],
  };
}

function listingWarnings(
  listing: NormalizedListingV2,
  assetResult: AssetProcessingResult,
): string[] {
  return unique([...listing.extractionWarnings, ...assetResult.warnings]);
}

export async function runBootstrapDryRun(input: {
  adapters: PropertyLifecycleAdapter[];
  existingState?: BootstrapExistingState;
  generatedAt?: string;
  assetProcessor?: (listing: NormalizedListingV2) => Promise<AssetProcessingResult>;
}): Promise<BootstrapDryRunReport> {
  const existingState = input.existingState ?? { properties: [], publicationKeys: [] };
  const candidates = existingState.properties.map(cloneExistingProperty);
  const knownPublicationKeys = new Set(existingState.publicationKeys);
  const assignedPropertyIds = new Set<string>();
  const warnings = new Set(existingState.warnings ?? []);
  const agencies: BootstrapDryRunAgencyReport[] = [];
  const decisions: BootstrapDryRunDecision[] = [];
  const sourceFailures: BootstrapDryRunSourceFailure[] = [];
  const assetProcessor = input.assetProcessor ?? processListingAssets;
  let syntheticPropertySequence = 0;
  let predictedNewProperties = 0;
  let predictedPublications = 0;
  let existingPublications = 0;
  let duplicateMatches = 0;
  let crossAgencyMatches = 0;
  let reviewRequiredCases = 0;
  let rawListings = 0;
  let acceptedListings = 0;
  let scoredCandidatePairs = 0;
  let discardedCandidatePairs = 0;

  for (const adapter of input.adapters) {
    const inventory = await adapter.fetchInventory();
    const agencyWarnings = new Set<string>(inventory.diagnostics.reasons);
    rawListings += inventory.items.length;
    const agencyReport: BootstrapDryRunAgencyReport = {
      agencySlug: adapter.agencySlug,
      adapterKey: adapter.key,
      healthState: inventory.healthState,
      inventoryComplete: inventory.complete,
      rawListings: inventory.items.length,
      normalizedListings: 0,
      acceptedListings: 0,
      excludedListings: 0,
      errorCount: 0,
      warnings: [],
    };

    if (inventory.healthState !== "HEALTHY" || !inventory.complete) {
      const reasons = unique([
        ...inventory.diagnostics.reasons,
        ...(!inventory.complete ? ["inventory_incomplete"] : []),
      ]);
      sourceFailures.push({
        agencySlug: adapter.agencySlug,
        adapterKey: adapter.key,
        healthState: inventory.healthState,
        reasons,
      });
      reasons.forEach((reason) => agencyWarnings.add(reason));
      agencyReport.warnings = [...agencyWarnings];
      agencies.push(agencyReport);
      agencyReport.warnings.forEach((warning) =>
        warnings.add(adapter.agencySlug + ":" + warning),
      );
      continue;
    }

    for (const item of inventory.items) {
      try {
        const listing = await adapter.normalize(await adapter.fetchDetail(item));
        agencyReport.normalizedListings += 1;
        listing.extractionWarnings.forEach((warning) => agencyWarnings.add(warning));
        if (listing.location.scope !== "IN_SCOPE") {
          agencyReport.excludedListings += 1;
          continue;
        }

        agencyReport.acceptedListings += 1;
        acceptedListings += 1;
        const key = publicationKey(adapter.agencySlug, listing.source.sourceKey);
        if (knownPublicationKeys.has(key)) {
          existingPublications += 1;
          duplicateMatches += 1;
          decisions.push({
            agencySlug: adapter.agencySlug,
            sourceKey: listing.source.sourceKey,
            externalId: listing.source.externalId,
            action: "EXISTING_PUBLICATION",
            predictedPropertyId: null,
            identityOutcome: "EXISTING_PUBLICATION",
            score: 1,
            margin: 1,
            candidateCount: 0,
            discardedCandidateCount: 0,
            crossAgencyMatch: false,
            warnings: listing.extractionWarnings,
          });
          continue;
        }

        const assetResult = await assetProcessor(listing);
        const decisionWarnings = listingWarnings(listing, assetResult);
        decisionWarnings.forEach((warning) => agencyWarnings.add(warning));
        const observation = identityObservationFromListing(listing, assetResult.assets);
        const identity = decidePropertyIdentity(
          observation,
          candidates.map((candidate) => identityCandidate(candidate, adapter.agencySlug)),
        );
        scoredCandidatePairs += identity.candidates.length;
        discardedCandidatePairs += identity.retrieval?.discardedCount ?? 0;
        let predictedPropertyId = identity.propertyId;
        let action: BootstrapDryRunDecision["action"];
        let crossAgencyMatch = false;

        if (identity.outcome === "AUTO_MATCH" && identity.propertyId) {
          action = "MATCH_PROPERTY";
          duplicateMatches += 1;
          const candidate = candidates.find(
            (value) => value.propertyId === identity.propertyId,
          );
          if (!candidate) {
            throw new Error(
              "Identity candidate " +
                identity.propertyId +
                " disappeared during dry run.",
            );
          }
          crossAgencyMatch =
            candidate.agencySlugs.length > 0 &&
            !candidate.agencySlugs.includes(adapter.agencySlug);
          if (crossAgencyMatch) {
            crossAgencyMatches += 1;
          }
          mergeObservation(candidate, adapter.agencySlug, observation);
        } else {
          syntheticPropertySequence += 1;
          predictedPropertyId = "dry-run-property-" + syntheticPropertySequence;
          predictedNewProperties += 1;
          if (identity.outcome === "REVIEW_REQUIRED") {
            action = "CREATE_REVIEW_PROPERTY";
            reviewRequiredCases += 1;
          } else {
            action = "CREATE_PROPERTY";
          }
          candidates.push(
            candidateFromObservation({
              propertyId: predictedPropertyId,
              agencySlug: adapter.agencySlug,
              observation,
            }),
          );
        }

        predictedPublications += 1;
        knownPublicationKeys.add(key);
        if (predictedPropertyId) {
          assignedPropertyIds.add(predictedPropertyId);
        }
        decisions.push({
          agencySlug: adapter.agencySlug,
          sourceKey: listing.source.sourceKey,
          externalId: listing.source.externalId,
          action,
          predictedPropertyId,
          identityOutcome: identity.outcome,
          score: identity.score,
          margin: identity.margin,
          candidateCount: identity.candidates.length,
          discardedCandidateCount: identity.retrieval?.discardedCount ?? 0,
          crossAgencyMatch,
          warnings: decisionWarnings,
        });
      } catch (error) {
        agencyReport.errorCount += 1;
        agencyWarnings.add(
          "listing_error:" +
            item.sourceKey +
            ":" +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    if (
      agencyReport.rawListings > 0 &&
      agencyReport.errorCount / agencyReport.rawListings > 0.1
    ) {
      agencyReport.healthState = "DEGRADED";
      sourceFailures.push({
        agencySlug: adapter.agencySlug,
        adapterKey: adapter.key,
        healthState: "DEGRADED",
        reasons: ["detail_error_ratio_exceeded"],
      });
      agencyWarnings.add("detail_error_ratio_exceeded");
    }
    agencyReport.warnings = [...agencyWarnings];
    agencyReport.warnings.forEach((warning) =>
      warnings.add(adapter.agencySlug + ":" + warning),
    );
    agencies.push(agencyReport);
  }

  return {
    reportVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    nonMutating: true,
    totals: {
      rawListings,
      acceptedListings,
      predictedProperties: assignedPropertyIds.size,
      predictedNewProperties,
      predictedPublications,
      existingPublications,
      duplicateMatches,
      crossAgencyMatches,
      reviewRequiredCases,
      sourceFailures: sourceFailures.length,
      warningCount: warnings.size,
      scoredCandidatePairs,
      discardedCandidatePairs,
    },
    agencies,
    decisions,
    sourceFailures,
    warnings: [...warnings],
  };
}
