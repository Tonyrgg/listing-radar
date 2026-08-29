import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProcessedAsset } from "@/lib/property-lifecycle/assets/pipeline";
import type { BootstrapExistingState } from "@/lib/property-lifecycle/bootstrap/dry-run";
import { canonicalBuildingAddress } from "@/lib/property-lifecycle/buildings/address";
import {
  hashValue,
  type NormalizedListingV2,
} from "@/lib/property-lifecycle/contracts/normalized-listing";
import {
  decidePropertyIdentity,
  type IdentityCandidate,
  type IdentityDecision,
  type IdentityObservation,
} from "@/lib/property-lifecycle/identity/scoring";
import {
  emptyHealthBaseline,
  evaluateHealthBaseline,
  type AdapterHealthBaseline,
  type HealthBaselineEvaluation,
} from "@/lib/property-lifecycle/health/baseline";
import { mergeTrueMarketStart } from "@/lib/property-lifecycle/lifecycle/market-age";
import { trueMarketAgeDays } from "@/lib/property-lifecycle/lifecycle/market-age";
import { resolveAuthoritativeValue } from "@/lib/property-lifecycle/lifecycle/manual-overrides";
import {
  assessSaleStatus,
  type SaleStatus,
} from "@/lib/property-lifecycle/lifecycle/sale-intelligence";
import { assessOpportunity } from "@/lib/property-lifecycle/opportunities/rules";
import {
  type AgencyListingState,
  type PublicationPresence,
  type PublicationState,
} from "@/lib/property-lifecycle/lifecycle/transitions";

interface DatabaseError {
  code?: string;
  message: string;
}

interface AgencyRow {
  id: string;
  slug: string;
  adapter_key: string;
  settings: Record<string, unknown>;
}

interface PublicationRow {
  id: string;
  agency_listing_id: string;
  source_key: string;
  state: PublicationState;
  source_status: PublicationPresence["sourceStatus"];
  missing_healthy_run_count: number;
  missing_since: string | null;
  removed_at: string | null;
}

interface AgencyListingRow {
  id: string;
  agency_id: string;
  property_id: string;
  state: AgencyListingState;
}

interface PropertyRow {
  id: string;
  building_id: string | null;
  property_type: string | null;
  primary_location_id: string | null;
  true_market_start_lower_bound: string | null;
  true_market_start_upper_bound: string | null;
  true_market_start_method: string | null;
  true_market_start_confidence: number | null;
  first_public_evidence_at: string | null;
  canonical_attributes: Record<string, unknown>;
}

export interface SyncRunCounts {
  discoveredCount: number;
  normalizedCount: number;
  inScopeCount: number;
  excludedCount: number;
  errorCount: number;
  missingCount: number;
  transitionedCount: number;
}

export interface PersistedObservation {
  propertyId: string;
  agencyListingId: string;
  publicationId: string;
  snapshotId: string;
  identityDecision: IdentityDecision;
  createdProperty: boolean;
  createdPublication: boolean;
}

export type ObservationFailurePoint =
  | "AFTER_PUBLICATION"
  | "AFTER_SNAPSHOT"
  | "DURING_EVENT_GENERATION"
  | "DURING_LIFECYCLE_UPDATE";

function throwIfError(error: DatabaseError | null): void {
  if (error) {
    throw new Error(error.message);
  }
}

function requiredData<T>(data: T | null, error: DatabaseError | null, context: string): T {
  throwIfError(error);
  if (data == null) {
    throw new Error(`${context} returned no data.`);
  }
  return data;
}

async function allDatabaseRows<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => Promise<{ data: T[] | null; error: DatabaseError | null }>,
): Promise<T[]> {
  const pageSize = 1_000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    throwIfError(error);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) {
      return rows;
    }
  }
}

const POSTGREST_ID_BATCH_SIZE = 75;

function batchesOf<T>(values: T[], size = POSTGREST_ID_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function identityAddress(listing: NormalizedListingV2): string | null {
  if (listing.location.streetName) {
    return [listing.location.streetName, listing.location.streetNumber]
      .filter(Boolean)
      .join(" ");
  }
  return listing.location.rawText;
}

export function identityObservationFromListing(
  listing: NormalizedListingV2,
  processedAssets: ProcessedAsset[],
): IdentityObservation {
  return {
    agencyReference: listing.source.agencyReference,
    address: identityAddress(listing),
    locality: listing.location.locality,
    propertyType: listing.commercial.propertyType,
    surfaceSqm: listing.commercial.surfaceSqm,
    rooms: listing.commercial.rooms,
    floor: listing.commercial.floor,
    priceAmount: listing.commercial.priceAmount,
    imageFingerprints:
      processedAssets.length > 0
        ? processedAssets
            .filter((asset) => asset.classification === "IMAGE")
            .map((asset) => `DHASH64:${asset.perceptualHash}`)
        : listing.assets
            .filter((asset) => asset.kind === "IMAGE")
            .map((asset) => `SOURCE_URL_SHA256:${hashValue(asset.canonicalUrl)}`),
    floorplanFingerprints:
      processedAssets.length > 0
        ? processedAssets
            .filter((asset) => asset.classification === "FLOORPLAN")
            .map((asset) => `DHASH64:${asset.perceptualHash}`)
        : listing.assets
            .filter((asset) => asset.kind === "FLOORPLAN")
            .map((asset) => `SOURCE_URL_SHA256:${hashValue(asset.canonicalUrl)}`),
  };
}

function mediaMarketStartEvidence(
  listing: NormalizedListingV2,
  processedAssets: ProcessedAsset[],
): Record<string, unknown> | null {
  const policy =
    listing.adapterKey === "vistocasa"
      ? {
          method: "VISTOCASA_ORIGINAL_MEDIA_LAST_MODIFIED",
          claimKey: "publication.originalMediaAvailableBy",
          confidence: 0.55,
          limitation: "media may be prepared before publication or reused",
        }
      : listing.adapterKey === "futura"
        ? {
            method: "FUTURA_ORIGINAL_MEDIA_LAST_MODIFIED",
            claimKey: "publication.originalMediaAvailableBy",
            confidence: 0.6,
            limitation:
              "coherent gallery upload batches can predate a relaunch; media may still be reused",
          }
        : listing.adapterKey === "garofalo"
          ? {
              method: "GAROFALO_ORIGINAL_MEDIA_LAST_MODIFIED",
              claimKey: "publication.originalMediaAvailableBy",
              confidence: 0.65,
              limitation:
                "only original globaluserfiles media is eligible; media may predate publication or be reused",
            }
          : listing.adapterKey === "trio"
            ? {
                method: "TRIO_TROVACASA_MEDIA_LAST_MODIFIED",
                claimKey: "publication.portalMediaAvailableBy",
                confidence: 0.5,
                limitation:
                  "TrovaCasa resized gallery availability is public evidence, not contractual start; media may be reused",
              }
            : listing.adapterKey === "momento"
              ? {
                  method: "MOMENTO_TROVACASA_MEDIA_LAST_MODIFIED",
                  claimKey: "publication.portalMediaAvailableBy",
                  confidence: 0.5,
                  limitation:
                    "TrovaCasa resized gallery availability is public evidence, not contractual start; media may be reused",
                }
              : null;
  if (!policy) {
    return null;
  }
  const observedTime = Date.parse(listing.observedAt);
  const earliest = processedAssets
    .filter((asset) => asset.classification !== "SOLD_GRAPHIC" && asset.lastModified)
    .map((asset) => ({ asset, time: Date.parse(asset.lastModified as string) }))
    .filter(
      (candidate) =>
        Number.isFinite(candidate.time) &&
        candidate.time >= Date.UTC(2000, 0, 1) &&
        candidate.time <= observedTime,
    )
    .sort((left, right) => left.time - right.time)[0];
  if (!earliest) {
    return null;
  }
  const sourceRecordedAt = new Date(earliest.time).toISOString();
  return {
    sourceUrl: earliest.asset.canonicalUrl,
    method: policy.method,
    claimKey: policy.claimKey,
    rawValue: earliest.asset.lastModified,
    normalizedValue: { lowerBound: null, upperBound: sourceRecordedAt },
    confidence: policy.confidence,
    observedAt: listing.observedAt,
    sourceRecordedAt,
    metadata: {
      limitation: policy.limitation,
      classification: earliest.asset.classification,
    },
  };
}

export class PropertyLifecycleRepository {
  constructor(private readonly db: SupabaseClient) {}

  async getAgencyBySlug(slug: string): Promise<AgencyRow> {
    const { data, error } = await this.db
      .from("agencies")
      .select("id,slug,adapter_key,settings")
      .eq("slug", slug)
      .single();
    return requiredData(data as AgencyRow | null, error, `Agency ${slug}`);
  }

  async loadBootstrapState(): Promise<BootstrapExistingState> {
    type AgencyStateRow = {
      id: string;
      slug: string;
    };
    type PropertyStateRow = {
      id: string;
      property_type: string | null;
      canonical_attributes: Record<string, unknown>;
    };
    type AgencyListingStateRow = {
      property_id: string;
      agency_id: string;
      agency_reference: string | null;
    };
    type PublicationStateRow = {
      agency_id: string;
      source_key: string;
    };
    type FingerprintStateRow = {
      property_id: string;
      algorithm: string;
      fingerprint: string;
    };
    const [agencies, properties, agencyListings, publications, images, floorplans] =
      await Promise.all([
        allDatabaseRows<AgencyStateRow>(async (from, to) => {
          const { data, error } = await this.db
            .from("agencies")
            .select("id,slug")
            .order("id")
            .range(from, to);
          return { data: data as AgencyStateRow[] | null, error };
        }),
        allDatabaseRows<PropertyStateRow>(async (from, to) => {
          const { data, error } = await this.db
            .from("properties")
            .select("id,property_type,canonical_attributes")
            .neq("identity_status", "MERGED")
            .order("id")
            .range(from, to);
          return { data: data as PropertyStateRow[] | null, error };
        }),
        allDatabaseRows<AgencyListingStateRow>(async (from, to) => {
          const { data, error } = await this.db
            .from("agency_listings")
            .select("property_id,agency_id,agency_reference")
            .order("id")
            .range(from, to);
          return { data: data as AgencyListingStateRow[] | null, error };
        }),
        allDatabaseRows<PublicationStateRow>(async (from, to) => {
          const { data, error } = await this.db
            .from("publications")
            .select("agency_id,source_key")
            .order("id")
            .range(from, to);
          return { data: data as PublicationStateRow[] | null, error };
        }),
        allDatabaseRows<FingerprintStateRow>(async (from, to) => {
          const { data, error } = await this.db
            .from("image_fingerprints")
            .select("property_id,algorithm,fingerprint")
            .order("id")
            .range(from, to);
          return { data: data as FingerprintStateRow[] | null, error };
        }),
        allDatabaseRows<FingerprintStateRow>(async (from, to) => {
          const { data, error } = await this.db
            .from("floorplan_fingerprints")
            .select("property_id,algorithm,fingerprint")
            .order("id")
            .range(from, to);
          return { data: data as FingerprintStateRow[] | null, error };
        }),
      ]);
    const agencySlugs = new Map(agencies.map((agency) => [agency.id, agency.slug]));

    return {
      properties: properties.map((property) => {
        const references = agencyListings.filter(
          (listing) => listing.property_id === property.id,
        );
        const referencesByAgency: Record<string, string[]> = {};
        for (const reference of references) {
          const slug = agencySlugs.get(reference.agency_id);
          if (!slug || !reference.agency_reference) {
            continue;
          }
          referencesByAgency[slug] = [
            ...new Set([
              ...(referencesByAgency[slug] ?? []),
              reference.agency_reference,
            ]),
          ];
        }
        return {
          propertyId: property.id,
          agencySlugs: [
            ...new Set(
              references
                .map((reference) => agencySlugs.get(reference.agency_id))
                .filter((slug): slug is string => Boolean(slug)),
            ),
          ],
          agencyReferences: referencesByAgency,
          address: stringValue(property.canonical_attributes.address),
          locality: stringValue(property.canonical_attributes.locality),
          propertyType: property.property_type,
          surfaceSqm: numberValue(property.canonical_attributes.surfaceSqm),
          rooms: numberValue(property.canonical_attributes.rooms),
          floor: stringValue(property.canonical_attributes.floor),
          priceAmount: numberValue(property.canonical_attributes.priceAmount),
          imageFingerprints: images
            .filter((image) => image.property_id === property.id)
            .map((image) => image.algorithm + ":" + image.fingerprint),
          floorplanFingerprints: floorplans
            .filter((floorplan) => floorplan.property_id === property.id)
            .map((floorplan) => floorplan.algorithm + ":" + floorplan.fingerprint),
        };
      }),
      publicationKeys: publications.flatMap((publication) => {
        const slug = agencySlugs.get(publication.agency_id);
        return slug ? [slug + "\u0000" + publication.source_key] : [];
      }),
      warnings: [],
    };
  }

  async createSyncRun(input: {
    agencyId: string;
    adapterKey: string;
    mode: "SYNC" | "DEEP_SYNC" | "BOOTSTRAP" | "FIXTURE";
    jobId?: string | null;
  }): Promise<string> {
    const { data, error } = await this.db
      .from("sync_runs")
      .insert({
        agency_id: input.agencyId,
        adapter_key: input.adapterKey,
        mode: input.mode,
        job_id: input.jobId ?? null,
      })
      .select("id")
      .single();
    return requiredData(data as { id: string } | null, error, "Create sync run").id;
  }

  async recordAdapterHealth(input: {
    agencyId: string;
    syncRunId: string;
    state: string;
    sourceComplete: boolean;
    observedCount: number;
    expectedCount: number | null;
    parseErrorCount: number;
    structureFingerprint: string;
    reasons: string[];
    diagnostics: Record<string, unknown>;
    responseStatus?: number | null;
  }): Promise<HealthBaselineEvaluation> {
    const { data: baselineData, error: baselineError } = await this.db
      .from("adapter_health_baselines")
      .select(
        "successful_run_count,recent_inventory_counts,rolling_median,variability,schema_fingerprint,schema_version,pending_schema_fingerprint,pending_schema_run_count,consecutive_failures,consecutive_healthy_runs",
      )
      .eq("agency_id", input.agencyId)
      .maybeSingle();
    throwIfError(baselineError);
    const row = baselineData as {
      successful_run_count: number;
      recent_inventory_counts: number[];
      rolling_median: number | null;
      variability: number | null;
      schema_fingerprint: string | null;
      schema_version: number;
      pending_schema_fingerprint: string | null;
      pending_schema_run_count: number;
      consecutive_failures: number;
      consecutive_healthy_runs: number;
    } | null;
    const baseline: AdapterHealthBaseline = row
      ? {
          successfulRunCount: row.successful_run_count,
          recentInventoryCounts: row.recent_inventory_counts,
          rollingMedian: row.rolling_median,
          variability: row.variability,
          schemaFingerprint: row.schema_fingerprint,
          schemaVersion: row.schema_version,
          pendingSchemaFingerprint: row.pending_schema_fingerprint,
          pendingSchemaRunCount: row.pending_schema_run_count,
          consecutiveFailures: row.consecutive_failures,
          consecutiveHealthyRuns: row.consecutive_healthy_runs,
        }
      : emptyHealthBaseline();
    const evaluation = evaluateHealthBaseline({
      baseline,
      sourceState: input.state as "HEALTHY" | "DEGRADED" | "FAILED" | "STRUCTURE_CHANGED",
      sourceComplete: input.sourceComplete,
      observedCount: input.observedCount,
      structureFingerprint: input.structureFingerprint,
    });
    const { error } = await this.db.rpc("record_adapter_health_observation", {
      p_agency_id: input.agencyId,
      p_sync_run_id: input.syncRunId,
      p_state: evaluation.effectiveState,
      p_observed_count: input.observedCount,
      p_expected_count: input.expectedCount,
      p_parse_error_count: input.parseErrorCount,
      p_structure_fingerprint: input.structureFingerprint,
      p_reasons: [...new Set([...input.reasons, ...evaluation.reasons])],
      p_diagnostics: {
        ...input.diagnostics,
        sourceState: input.state,
        sourceComplete: input.sourceComplete,
        baselineReady: evaluation.baselineReady,
        anomalyRatio: evaluation.anomalyRatio,
      },
      p_response_status: input.responseStatus ?? null,
      p_baseline: evaluation.next,
      p_observed_at: new Date().toISOString(),
    });
    throwIfError(error);
    return evaluation;
  }

  async recordObservationCommitFailure(syncRunId: string): Promise<void> {
    const { error } = await this.db.rpc("record_observation_commit_failure", {
      p_sync_run_id: syncRunId,
    });
    throwIfError(error);
  }

  async finalizeSyncRun(input: {
    syncRunId: string;
    status: "SUCCEEDED" | "PARTIAL" | "FAILED";
    healthState: string;
    inventoryComplete: boolean;
    absenceEvaluationAllowed: boolean;
    expectedCount: number | null;
    counts: SyncRunCounts;
    structureFingerprint: string;
    diagnostics: Record<string, unknown>;
  }): Promise<void> {
    const { error } = await this.db
      .from("sync_runs")
      .update({
        status: input.status,
        health_state: input.healthState,
        inventory_complete: input.inventoryComplete,
        absence_evaluation_allowed: input.absenceEvaluationAllowed,
        expected_count: input.expectedCount,
        discovered_count: input.counts.discoveredCount,
        normalized_count: input.counts.normalizedCount,
        in_scope_count: input.counts.inScopeCount,
        excluded_count: input.counts.excludedCount,
        error_count: input.counts.errorCount,
        missing_count: input.counts.missingCount,
        transitioned_count: input.counts.transitionedCount,
        structure_fingerprint: input.structureFingerprint,
        diagnostics: input.diagnostics,
        finished_at: new Date().toISOString(),
      })
      .eq("id", input.syncRunId);
    throwIfError(error);
  }

  private async upsertLocation(listing: NormalizedListingV2): Promise<string> {
    const normalizedKey = hashValue({
      municipality: listing.location.municipality,
      locality: listing.location.locality,
      postalCode: listing.location.postalCode,
      streetName: listing.location.streetName,
      streetNumber: listing.location.streetNumber,
      rawText: listing.location.rawText,
    });
    const { data, error } = await this.db
      .from("locations")
      .upsert(
        {
          raw_text: listing.location.rawText,
          municipality: listing.location.municipality,
          locality: listing.location.locality,
          postal_code: listing.location.postalCode,
          street_name: listing.location.streetName,
          street_number: listing.location.streetNumber,
          latitude: listing.location.latitude,
          longitude: listing.location.longitude,
          scope_state: listing.location.scope,
          resolution_method: listing.location.resolutionMethod,
          resolution_confidence: listing.location.resolutionConfidence,
          precision_level: listing.location.precision,
          evidence_source: listing.adapterKey,
          normalized_key: normalizedKey,
          metadata: { reasons: listing.location.reasons },
        },
        { onConflict: "normalized_key" },
      )
      .select("id")
      .single();
    return requiredData(data as { id: string } | null, error, "Upsert location").id;
  }

  private async upsertBuilding(
    listing: NormalizedListingV2,
    locationId: string,
  ): Promise<string | null> {
    const address = canonicalBuildingAddress(listing.location);
    if (!address) {
      return null;
    }
    const existing = await this.db
      .from("buildings")
      .select("id,attributes")
      .eq("normalized_key", address.normalizedKey)
      .maybeSingle();
    throwIfError(existing.error);
    const attributes = {
      ...((existing.data as { attributes?: Record<string, unknown> } | null)
        ?.attributes ?? {}),
      municipality: address.municipality,
      locality: address.locality,
      streetName: address.streetName,
      streetNumber: address.streetNumber,
    };
    if (existing.data) {
      const row = existing.data as { id: string };
      const { error } = await this.db
        .from("buildings")
        .update({
          location_id: locationId,
          display_name: address.displayName,
          attributes,
          last_seen_at: listing.observedAt,
        })
        .eq("id", row.id);
      throwIfError(error);
      return row.id;
    }
    const { data, error } = await this.db
      .from("buildings")
      .insert({
        location_id: locationId,
        normalized_key: address.normalizedKey,
        display_name: address.displayName,
        attributes,
        first_seen_at: listing.observedAt,
        last_seen_at: listing.observedAt,
      })
      .select("id")
      .single();
    return requiredData(data as { id: string } | null, error, "Create building").id;
  }

  private async publicationBySource(
    agencyId: string,
    sourceKey: string,
  ): Promise<PublicationRow | null> {
    const { data, error } = await this.db
      .from("publications")
      .select(
        "id,agency_listing_id,source_key,state,source_status,missing_healthy_run_count,missing_since,removed_at",
      )
      .eq("agency_id", agencyId)
      .eq("source_key", sourceKey)
      .maybeSingle();
    throwIfError(error);
    return data as PublicationRow | null;
  }

  private async agencyListing(id: string): Promise<AgencyListingRow> {
    const { data, error } = await this.db
      .from("agency_listings")
      .select("id,agency_id,property_id,state")
      .eq("id", id)
      .single();
    return requiredData(data as AgencyListingRow | null, error, "Agency listing");
  }

  private async property(id: string): Promise<PropertyRow> {
    const { data, error } = await this.db
      .from("properties")
      .select(
        "id,building_id,property_type,primary_location_id,true_market_start_lower_bound,true_market_start_upper_bound,true_market_start_method,true_market_start_confidence,first_public_evidence_at,canonical_attributes",
      )
      .eq("id", id)
      .single();
    return requiredData(data as PropertyRow | null, error, "Property");
  }

  private async identityCandidates(agencyId: string): Promise<IdentityCandidate[]> {
    const { data: propertiesData, error: propertiesError } = await this.db
      .from("properties")
      .select("id,property_type,canonical_attributes")
      .neq("identity_status", "MERGED")
      .limit(500);
    throwIfError(propertiesError);
    const rows = (propertiesData ?? []) as Array<{
      id: string;
      property_type: string | null;
      canonical_attributes: Record<string, unknown>;
    }>;
    if (rows.length === 0) {
      return [];
    }

    const propertyIdBatches = batchesOf(rows.map((row) => row.id));
    const batchResults = await Promise.all(
      propertyIdBatches.map(async (propertyIds) => {
        const [refs, images, plans] = await Promise.all([
          this.db
            .from("agency_listings")
            .select("property_id,agency_id,agency_reference")
            .in("property_id", propertyIds),
          this.db
            .from("image_fingerprints")
            .select("property_id,algorithm,fingerprint")
            .in("property_id", propertyIds),
          this.db
            .from("floorplan_fingerprints")
            .select("property_id,algorithm,fingerprint")
            .in("property_id", propertyIds),
        ]);
        throwIfError(refs.error);
        throwIfError(images.error);
        throwIfError(plans.error);
        return {
          references: refs.data ?? [],
          images: images.data ?? [],
          plans: plans.data ?? [],
        };
      }),
    );

    const refsData = batchResults.flatMap((result) => result.references);
    const imagesData = batchResults.flatMap((result) => result.images);
    const plansData = batchResults.flatMap((result) => result.plans);

    const references = (refsData ?? []) as Array<{
      property_id: string;
      agency_id: string;
      agency_reference: string | null;
    }>;
    const images = (imagesData ?? []) as Array<{
      property_id: string;
      algorithm: string;
      fingerprint: string;
    }>;
    const plans = (plansData ?? []) as Array<{
      property_id: string;
      algorithm: string;
      fingerprint: string;
    }>;

    return rows.map((row) => ({
      propertyId: row.id,
      agencyReference: null,
      knownAgencyReferences: references
        .filter(
          (reference) =>
            reference.property_id === row.id && reference.agency_id === agencyId,
        )
        .map((reference) => reference.agency_reference)
        .filter((reference): reference is string => Boolean(reference)),
      address: stringValue(row.canonical_attributes.address),
      locality: stringValue(row.canonical_attributes.locality),
      propertyType: row.property_type,
      surfaceSqm: numberValue(row.canonical_attributes.surfaceSqm),
      rooms: numberValue(row.canonical_attributes.rooms),
      floor: stringValue(row.canonical_attributes.floor),
      priceAmount: numberValue(row.canonical_attributes.priceAmount),
      imageFingerprints: images
        .filter((image) => image.property_id === row.id)
        .map((image) => `${image.algorithm}:${image.fingerprint}`),
      floorplanFingerprints: plans
        .filter((plan) => plan.property_id === row.id)
        .map((plan) => `${plan.algorithm}:${plan.fingerprint}`),
    }));
  }

  private async createProperty(
    listing: NormalizedListingV2,
    locationId: string,
    buildingId: string | null,
    identityStatus: "PROVISIONAL" | "REVIEW",
  ): Promise<string> {
    const { data, error } = await this.db
      .from("properties")
      .insert({
        primary_location_id: locationId,
        building_id: buildingId,
        property_type: listing.commercial.propertyType,
        identity_status: identityStatus,
        true_market_start_lower_bound: listing.marketStart.lowerBound,
        true_market_start_upper_bound: listing.marketStart.upperBound,
        true_market_start_method: listing.marketStart.method,
        true_market_start_confidence: listing.marketStart.confidence,
        first_public_evidence_at:
          listing.marketStart.lowerBound ?? listing.marketStart.upperBound ?? listing.observedAt,
        first_seen_at: listing.observedAt,
        last_seen_at: listing.observedAt,
        canonical_attributes: {
          address: identityAddress(listing),
          locality: listing.location.locality,
          surfaceSqm: listing.commercial.surfaceSqm,
          rooms: listing.commercial.rooms,
          propertyType: listing.commercial.propertyType,
        },
      })
      .select("id")
      .single();
    return requiredData(data as { id: string } | null, error, "Create property").id;
  }

  private async choosePrimaryLocation(
    currentLocationId: string | null,
    candidateLocationId: string,
  ): Promise<string> {
    if (!currentLocationId || currentLocationId === candidateLocationId) {
      return candidateLocationId;
    }
    const { data, error } = await this.db
      .from("locations")
      .select("id,precision_level,manually_verified")
      .in("id", [currentLocationId, candidateLocationId]);
    throwIfError(error);
    const rows = (data ?? []) as Array<{
      id: string;
      precision_level: string;
      manually_verified: boolean;
    }>;
    const current = rows.find((row) => row.id === currentLocationId);
    const candidate = rows.find((row) => row.id === candidateLocationId);
    if (current?.manually_verified || !candidate) {
      return currentLocationId;
    }
    const rank: Record<string, number> = {
      UNKNOWN: 0,
      APPROXIMATE_AREA: 1,
      STREET_ONLY: 2,
      EXACT_COORDINATES: 3,
      EXACT_ADDRESS: 4,
    };
    return (rank[candidate.precision_level] ?? 0) >
      (rank[current?.precision_level ?? "UNKNOWN"] ?? 0)
      ? candidateLocationId
      : currentLocationId;
  }

  private async updatePropertyObservation(
    propertyId: string,
    listing: NormalizedListingV2,
    locationId: string,
    buildingId: string | null,
  ): Promise<void> {
    const existing = await this.property(propertyId);
    const marketStart = mergeTrueMarketStart(
      existing.true_market_start_method
        ? {
            lowerBound: existing.true_market_start_lower_bound,
            upperBound: existing.true_market_start_upper_bound,
            method: existing.true_market_start_method,
            confidence: existing.true_market_start_confidence ?? 0,
          }
        : null,
      listing.marketStart,
    );
    const primaryLocationId = await this.choosePrimaryLocation(
      existing.primary_location_id,
      locationId,
    );
    const { error } = await this.db
      .from("properties")
      .update({
        primary_location_id: primaryLocationId,
        building_id:
          primaryLocationId === locationId && buildingId
            ? buildingId
            : existing.building_id,
        property_type: existing.property_type ?? listing.commercial.propertyType,
        true_market_start_lower_bound: marketStart.lowerBound,
        true_market_start_upper_bound: marketStart.upperBound,
        true_market_start_method: marketStart.method,
        true_market_start_confidence: marketStart.confidence,
        first_public_evidence_at: [
          existing.first_public_evidence_at,
          listing.marketStart.lowerBound ?? listing.marketStart.upperBound,
        ]
          .filter((value): value is string => Boolean(value))
          .sort()[0] ?? listing.observedAt,
        last_seen_at: listing.observedAt,
        canonical_attributes: {
          ...existing.canonical_attributes,
          address:
            existing.canonical_attributes.address ??
            identityAddress(listing),
          locality: existing.canonical_attributes.locality ?? listing.location.locality,
          surfaceSqm: listing.commercial.surfaceSqm,
          rooms: listing.commercial.rooms,
          propertyType: listing.commercial.propertyType,
        },
      })
      .eq("id", propertyId);
    throwIfError(error);
  }

  private async ensureAgencyListing(
    agencyId: string,
    propertyId: string,
    listing: NormalizedListingV2,
  ): Promise<AgencyListingRow> {
    const { data, error } = await this.db
      .from("agency_listings")
      .upsert(
        {
          agency_id: agencyId,
          property_id: propertyId,
          agency_reference: listing.source.agencyReference,
          last_seen_at: listing.observedAt,
        },
        { onConflict: "agency_id,property_id" },
      )
      .select("id,agency_id,property_id,state")
      .single();
    return requiredData(data as AgencyListingRow | null, error, "Upsert agency listing");
  }

  private async recordEvent(input: {
    propertyId: string;
    agencyListingId?: string | null;
    publicationId?: string | null;
    syncRunId?: string | null;
    eventType: string;
    occurredAt: string;
    dedupeKey: string;
    confidence?: number;
    actorType?: "SYSTEM" | "ADAPTER" | "USER" | "IMPORT";
    payload?: Record<string, unknown>;
    evidenceIds?: string[];
  }): Promise<string | null> {
    const { data, error } = await this.db
      .from("events")
      .insert({
        property_id: input.propertyId,
        agency_listing_id: input.agencyListingId ?? null,
        publication_id: input.publicationId ?? null,
        sync_run_id: input.syncRunId ?? null,
        event_type: input.eventType,
        occurred_at: input.occurredAt,
        confidence: input.confidence ?? 1,
        actor_type: input.actorType ?? "SYSTEM",
        dedupe_key: input.dedupeKey,
        payload: input.payload ?? {},
      })
      .select("id")
      .single();

    if (error?.code === "23505") {
      return null;
    }
    const eventId = requiredData(data as { id: string } | null, error, "Record event").id;
    if (input.evidenceIds?.length) {
      const { error: linkError } = await this.db.from("event_evidence").insert(
        input.evidenceIds.map((evidenceId) => ({ event_id: eventId, evidence_id: evidenceId })),
      );
      throwIfError(linkError);
    }
    return eventId;
  }

  private async recordIdentityDecision(
    publicationId: string,
    decision: IdentityDecision,
    provisionalPropertyId: string,
  ): Promise<void> {
    const persistedCandidates = decision.candidates.slice(0, 10);
    if (persistedCandidates.length > 0) {
      const { error } = await this.db.from("property_match_candidates").upsert(
        persistedCandidates.map((candidate) => ({
          publication_id: publicationId,
          candidate_property_id: candidate.propertyId,
          evaluation_version: 1,
          candidate_rank: candidate.rank,
          score: candidate.score,
          outcome:
            decision.outcome === "AUTO_MATCH" && candidate.rank === 1
              ? "AUTO_MATCH"
              : decision.outcome,
          feature_scores: candidate.features,
          contradictions: candidate.contradictions,
        })),
        { onConflict: "publication_id,candidate_property_id,evaluation_version" },
      );
      throwIfError(error);
    }

    if (decision.outcome === "REVIEW_REQUIRED") {
      const { error } = await this.db.from("review_queue").upsert(
        {
          review_type: "IDENTITY",
          status: "OPEN",
          property_id: provisionalPropertyId,
          publication_id: publicationId,
          title: "Ambiguous property identity",
          details: {
            score: decision.score,
            margin: decision.margin,
            candidates: persistedCandidates.slice(0, 3).map((candidate) => ({
              propertyId: candidate.propertyId,
              score: candidate.score,
              contradictions: candidate.contradictions,
            })),
          },
          dedupe_key: `identity:${publicationId}:v1`,
        },
        { onConflict: "dedupe_key" },
      );
      throwIfError(error);
    }
  }

  private async recordSnapshotAndEvidence(
    listing: NormalizedListingV2,
    propertyId: string,
    publicationId: string,
    syncRunId: string,
  ): Promise<{ snapshotId: string; evidenceIds: string[] }> {
    const { data, error } = await this.db
      .from("snapshots")
      .insert({
        publication_id: publicationId,
        sync_run_id: syncRunId,
        contract_version: listing.contractVersion,
        observed_at: listing.observedAt,
        content_hash: listing.contentHash,
        normalized_payload: listing,
        title: listing.commercial.title,
        description: listing.commercial.description,
        price_amount: listing.commercial.priceAmount,
        price_currency: listing.commercial.priceCurrency,
        surface_sqm: listing.commercial.surfaceSqm,
        rooms: listing.commercial.rooms,
        source_status: listing.status.value,
        availability: !["SOLD", "REMOVED"].includes(listing.status.value),
        extraction_warnings: listing.extractionWarnings,
      })
      .select("id")
      .single();
    const snapshotId = requiredData(data as { id: string } | null, error, "Record snapshot").id;
    const claims = [
      ...listing.status.evidence,
      ...listing.marketStart.evidence,
      {
        kind: "LOCATION",
        claimKey: "publication.location",
        sourceUrl: listing.source.canonicalUrl,
        extractionMethod: listing.location.resolutionMethod,
        rawValue: listing.location.rawText,
        normalizedValue: {
          municipality: listing.location.municipality,
          locality: listing.location.locality,
          postalCode: listing.location.postalCode,
          streetName: listing.location.streetName,
          precision: listing.location.precision,
          scope: listing.location.scope,
        },
        confidence: listing.location.resolutionConfidence,
        observedAt: listing.observedAt,
        sourceRecordedAt: null,
        metadata: { reasons: listing.location.reasons },
      },
    ];
    if (claims.length === 0) {
      return { snapshotId, evidenceIds: [] };
    }

    const evidenceRows = claims.map((claim) => ({
      property_id: propertyId,
      publication_id: publicationId,
      snapshot_id: snapshotId,
      sync_run_id: syncRunId,
      evidence_kind: claim.kind,
      source_url: claim.sourceUrl,
      extraction_method: claim.extractionMethod,
      claim_key: claim.claimKey,
      raw_value: claim.rawValue,
      normalized_value: claim.normalizedValue,
      confidence: claim.confidence,
      observed_at: claim.observedAt,
      source_recorded_at: claim.sourceRecordedAt,
      evidence_hash: hashValue({ ...claim, observedAt: undefined }),
      metadata: claim.metadata,
    }));
    const { data: evidenceData, error: evidenceError } = await this.db
      .from("evidence")
      .insert(evidenceRows)
      .select("id");
    throwIfError(evidenceError);
    return {
      snapshotId,
      evidenceIds: ((evidenceData ?? []) as Array<{ id: string }>).map((row) => row.id),
    };
  }

  private async latestSnapshot(publicationId: string): Promise<{
    id: string;
    price_amount: number | null;
    content_hash: string;
    normalized_payload: unknown;
  } | null> {
    const { data, error } = await this.db
      .from("snapshots")
      .select("id,price_amount,content_hash,normalized_payload")
      .eq("publication_id", publicationId)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return data as {
      id: string;
      price_amount: number | null;
      content_hash: string;
      normalized_payload: unknown;
    } | null;
  }

  private async previousPerceptualFingerprints(snapshotId: string): Promise<{
    images: string[];
    floorplans: string[];
  }> {
    const [{ data: imageData, error: imageError }, { data: floorplanData, error: floorplanError }] =
      await Promise.all([
        this.db
          .from("image_fingerprints")
          .select("fingerprint")
          .eq("snapshot_id", snapshotId)
          .eq("algorithm", "DHASH64"),
        this.db
          .from("floorplan_fingerprints")
          .select("fingerprint")
          .eq("snapshot_id", snapshotId)
          .eq("algorithm", "DHASH64"),
      ]);
    throwIfError(imageError);
    throwIfError(floorplanError);
    return {
      images: ((imageData ?? []) as Array<{ fingerprint: string }>).map(
        (row) => row.fingerprint,
      ),
      floorplans: ((floorplanData ?? []) as Array<{ fingerprint: string }>).map(
        (row) => row.fingerprint,
      ),
    };
  }

  private async recordAssetFingerprints(
    listing: NormalizedListingV2,
    propertyId: string,
    publicationId: string,
    snapshotId: string,
    syncRunId: string,
    processedAssets: ProcessedAsset[],
  ): Promise<void> {
    const processedByUrl = new Map(
      processedAssets.map((asset) => [asset.canonicalUrl, asset]),
    );
    const imageRows: Array<Record<string, unknown>> = [];
    const floorplanRows: Array<Record<string, unknown>> = [];

    for (const [position, asset] of listing.assets.entries()) {
      const processed = processedByUrl.get(asset.canonicalUrl);
      const algorithms = processed
        ? [
            { algorithm: "SHA256", fingerprint: processed.sha256 },
            { algorithm: "DHASH64", fingerprint: processed.perceptualHash },
          ]
        : [
            {
              algorithm: "SOURCE_URL_SHA256",
              fingerprint: hashValue(asset.canonicalUrl),
            },
          ];
      const isFloorplan =
        processed?.classification === "FLOORPLAN" || asset.kind === "FLOORPLAN";
      const rows = isFloorplan ? floorplanRows : imageRows;

      for (const algorithm of algorithms) {
        rows.push({
          property_id: propertyId,
          publication_id: publicationId,
          snapshot_id: snapshotId,
          canonical_url: asset.canonicalUrl,
          algorithm: algorithm.algorithm,
          fingerprint: algorithm.fingerprint,
          width: processed?.width ?? null,
          height: processed?.height ?? null,
          source_recorded_at: asset.sourceRecordedAt,
          metadata: {
            ...asset.metadata,
            position,
            classification: processed?.classification ?? asset.kind,
            format: processed?.format ?? null,
            contentType: processed?.contentType ?? null,
            etag: processed?.etag ?? null,
            lastModified: processed?.lastModified ?? null,
            exif: processed?.exif ?? null,
          },
        });
      }
    }

    if (imageRows.length > 0) {
      const { error } = await this.db.from("image_fingerprints").insert(imageRows);
      throwIfError(error);
    }
    if (floorplanRows.length > 0) {
      const { error } = await this.db
        .from("floorplan_fingerprints")
        .insert(floorplanRows);
      throwIfError(error);
    }

    const mediaMarketStartPolicy =
      listing.adapterKey === "vistocasa"
        ? {
            method: "VISTOCASA_ORIGINAL_MEDIA_LAST_MODIFIED",
            claimKey: "publication.originalMediaAvailableBy",
            confidence: 0.55,
            limitation: "media may be prepared before publication or reused",
          }
        : listing.adapterKey === "futura"
          ? {
              method: "FUTURA_ORIGINAL_MEDIA_LAST_MODIFIED",
              claimKey: "publication.originalMediaAvailableBy",
              confidence: 0.6,
              limitation:
                "coherent gallery upload batches can predate a relaunch; media may still be reused",
            }
          : listing.adapterKey === "garofalo"
            ? {
                method: "GAROFALO_ORIGINAL_MEDIA_LAST_MODIFIED",
                claimKey: "publication.originalMediaAvailableBy",
                confidence: 0.65,
                limitation:
                  "only original globaluserfiles media is eligible; media may predate publication or be reused",
              }
            : listing.adapterKey === "trio"
              ? {
                  method: "TRIO_TROVACASA_MEDIA_LAST_MODIFIED",
                  claimKey: "publication.portalMediaAvailableBy",
                  confidence: 0.5,
                  limitation:
                    "TrovaCasa resized gallery availability is public evidence, not contractual start; media may be reused",
                }
              : listing.adapterKey === "momento"
                ? {
                    method: "MOMENTO_TROVACASA_MEDIA_LAST_MODIFIED",
                    claimKey: "publication.portalMediaAvailableBy",
                    confidence: 0.5,
                    limitation:
                      "TrovaCasa resized gallery availability is public evidence, not contractual start; media may be reused",
                  }
                : null;

    if (mediaMarketStartPolicy) {
      const observedTime = Date.parse(listing.observedAt);
      const earliestMediaDate = processedAssets
        .filter((asset) => asset.classification !== "SOLD_GRAPHIC" && asset.lastModified)
        .map((asset) => ({ asset, time: Date.parse(asset.lastModified as string) }))
        .filter(
          (candidate) =>
            Number.isFinite(candidate.time) &&
            candidate.time >= Date.UTC(2000, 0, 1) &&
            candidate.time <= observedTime,
        )
        .sort((left, right) => left.time - right.time)[0];

      if (earliestMediaDate) {
        const sourceRecordedAt = new Date(earliestMediaDate.time).toISOString();
        const claim = {
          kind: "MARKET_START_BOUND",
          claimKey: mediaMarketStartPolicy.claimKey,
          sourceUrl: earliestMediaDate.asset.canonicalUrl,
          extractionMethod: mediaMarketStartPolicy.method,
          rawValue: earliestMediaDate.asset.lastModified,
          normalizedValue: { lowerBound: null, upperBound: sourceRecordedAt },
          confidence: mediaMarketStartPolicy.confidence,
          observedAt: listing.observedAt,
          sourceRecordedAt,
          metadata: {
            limitation: mediaMarketStartPolicy.limitation,
            classification: earliestMediaDate.asset.classification,
          },
        };
        const { error: evidenceError } = await this.db.from("evidence").insert({
          property_id: propertyId,
          publication_id: publicationId,
          snapshot_id: snapshotId,
          sync_run_id: syncRunId,
          evidence_kind: claim.kind,
          source_url: claim.sourceUrl,
          extraction_method: claim.extractionMethod,
          claim_key: claim.claimKey,
          raw_value: claim.rawValue,
          normalized_value: claim.normalizedValue,
          confidence: claim.confidence,
          observed_at: claim.observedAt,
          source_recorded_at: claim.sourceRecordedAt,
          evidence_hash: hashValue({ ...claim, observedAt: undefined }),
          metadata: claim.metadata,
        });
        throwIfError(evidenceError);

        const existing = await this.property(propertyId);
        const marketStart = mergeTrueMarketStart(
          existing.true_market_start_method
            ? {
                lowerBound: existing.true_market_start_lower_bound,
                upperBound: existing.true_market_start_upper_bound,
                method: existing.true_market_start_method,
                confidence: existing.true_market_start_confidence ?? 0,
              }
            : null,
          {
            lowerBound: null,
            upperBound: sourceRecordedAt,
            method: mediaMarketStartPolicy.method,
            confidence: mediaMarketStartPolicy.confidence,
          },
        );
        const { error: propertyError } = await this.db
          .from("properties")
          .update({
            true_market_start_lower_bound: marketStart.lowerBound,
            true_market_start_upper_bound: marketStart.upperBound,
            true_market_start_method: marketStart.method,
            true_market_start_confidence: marketStart.confidence,
            first_public_evidence_at: [
              existing.first_public_evidence_at,
              sourceRecordedAt,
            ]
              .filter((value): value is string => Boolean(value))
              .sort()[0] ?? sourceRecordedAt,
          })
          .eq("id", propertyId);
        throwIfError(propertyError);
      }
    }

    const representatives = processedAssets
      .filter(
        (asset) => asset.classification === "IMAGE" && asset.representativeThumbnail,
      )
      .sort((left, right) => left.position - right.position)
      .slice(0, 2);
    if (representatives.length === 0) {
      return;
    }

    const paths: string[] = [];
    for (const representative of representatives) {
      const path = `${propertyId}/${representative.sha256}.webp`;
      const { error } = await this.db.storage
        .from("property-lifecycle-visuals")
        .upload(path, representative.representativeThumbnail as Uint8Array, {
          contentType: "image/webp",
          upsert: true,
        });
      throwIfError(error);
      paths.push(path);
    }

    const { data: propertyData, error: propertyError } = await this.db
      .from("properties")
      .select("representative_image_paths")
      .eq("id", propertyId)
      .single();
    throwIfError(propertyError);
    const existingPaths =
      ((propertyData as { representative_image_paths: string[] } | null)
        ?.representative_image_paths ?? []);
    const { error: updateError } = await this.db
      .from("properties")
      .update({
        representative_image_paths: [...new Set([...existingPaths, ...paths])].slice(0, 2),
      })
      .eq("id", propertyId);
    throwIfError(updateError);
  }

  async persistObservation(
    agencyId: string,
    syncRunId: string,
    listing: NormalizedListingV2,
    processedAssets: ProcessedAsset[] = [],
    options: { failurePoint?: ObservationFailurePoint } = {},
  ): Promise<PersistedObservation> {
    const existingPublication = await this.publicationBySource(
      agencyId,
      listing.source.sourceKey,
    );
    let identityDecision: IdentityDecision;
    if (existingPublication) {
      const propertyId = (
        await this.agencyListing(existingPublication.agency_listing_id)
      ).property_id;
      identityDecision = {
        outcome: "AUTO_MATCH",
        propertyId,
        score: 1,
        margin: 1,
        candidates: [],
      };
    } else {
      identityDecision = decidePropertyIdentity(
        identityObservationFromListing(listing, processedAssets),
        await this.identityCandidates(agencyId),
      );
    }

    const processedPayload = processedAssets.map(
      ({ representativeThumbnail, ...asset }) => {
        void representativeThumbnail;
        return asset;
      },
    );
    const locationNormalizedKey = hashValue({
      municipality: listing.location.municipality,
      locality: listing.location.locality,
      postalCode: listing.location.postalCode,
      streetName: listing.location.streetName,
      streetNumber: listing.location.streetNumber,
      rawText: listing.location.rawText,
    });
    const building = canonicalBuildingAddress(listing.location);

    const { data, error } = await this.db.rpc(
      "persist_property_lifecycle_observation_atomic",
      {
        p_agency_id: agencyId,
        p_sync_run_id: syncRunId,
        p_listing: listing,
        p_identity_decision: identityDecision,
        p_processed_assets: processedPayload,
        p_location_normalized_key: locationNormalizedKey,
        p_building: building,
        p_media_market_start: mediaMarketStartEvidence(listing, processedAssets),
        p_failure_point: options.failurePoint ?? null,
      },
    );
    if (error) {
      await this.recordObservationCommitFailure(syncRunId);
      throwIfError(error);
    }
    const result = requiredData(
      data as {
        propertyId: string;
        agencyListingId: string;
        publicationId: string;
        snapshotId: string;
        createdProperty: boolean;
        createdPublication: boolean;
      } | null,
      null,
      "Atomic observation",
    );

    await this.uploadRepresentativeThumbnails(result.propertyId, processedAssets);
    return {
      propertyId: result.propertyId,
      agencyListingId: result.agencyListingId,
      publicationId: result.publicationId,
      snapshotId: result.snapshotId,
      identityDecision,
      createdProperty: result.createdProperty,
      createdPublication: result.createdPublication,
    };
  }

  private async uploadRepresentativeThumbnails(
    propertyId: string,
    processedAssets: ProcessedAsset[],
  ): Promise<void> {
    const representatives = processedAssets
      .filter(
        (asset) => asset.classification === "IMAGE" && asset.representativeThumbnail,
      )
      .sort((left, right) => left.position - right.position)
      .slice(0, 2);
    if (representatives.length === 0) {
      return;
    }
    try {
      const paths: string[] = [];
      for (const representative of representatives) {
        const path = `${propertyId}/${representative.sha256}.webp`;
        const { error } = await this.db.storage
          .from("property-lifecycle-visuals")
          .upload(path, representative.representativeThumbnail as Uint8Array, {
            contentType: "image/webp",
            upsert: true,
          });
        throwIfError(error);
        paths.push(path);
      }
      const { data, error } = await this.db
        .from("properties")
        .select("representative_image_paths")
        .eq("id", propertyId)
        .single();
      throwIfError(error);
      const existingPaths =
        ((data as { representative_image_paths: string[] } | null)
          ?.representative_image_paths ?? []);
      const { error: updateError } = await this.db
        .from("properties")
        .update({
          representative_image_paths: [...new Set([...existingPaths, ...paths])].slice(0, 2),
        })
        .eq("id", propertyId);
      throwIfError(updateError);
    } catch {
      // Storage is recoverable enrichment and cannot participate in PostgreSQL's transaction.
      // The committed observation remains authoritative and a later deep sync can retry it.
    }
  }

  private geographyDedupeKey(agencyId: string, sourceKey: string): string {
    return `geography:${agencyId}:${sourceKey}`;
  }

  /**
   * La risposta che una persona ha già dato su dove sta questo annuncio.
   *
   * Un caso di posizione non ha una proprietà dietro: l'annuncio resta fuori
   * dall'archivio proprio perché non sappiamo dove metterlo. La decisione vive
   * quindi sulla riga della coda, ed è lì che la sincronia successiva la va a
   * cercare prima di scartare di nuovo lo stesso annuncio.
   */
  async resolvedGeographyScope(input: {
    agencyId: string;
    sourceKey: string;
  }): Promise<"IN_SCOPE" | "OUT_OF_SCOPE" | null> {
    const { data, error } = await this.db
      .from("review_queue")
      .select("resolution")
      .eq("dedupe_key", this.geographyDedupeKey(input.agencyId, input.sourceKey))
      .eq("status", "RESOLVED")
      .maybeSingle();
    throwIfError(error);
    const resolution = (data as { resolution: unknown } | null)?.resolution;
    const decision =
      resolution && typeof resolution === "object"
        ? (resolution as { decision?: unknown }).decision
        : null;
    return decision === "IN_SCOPE" || decision === "OUT_OF_SCOPE" ? decision : null;
  }

  /**
   * Il caso che non ha più niente da chiedere.
   *
   * Quando il risolutore impara a leggere un indirizzo che prima non capiva —
   * «via Modugno» è una via di Bitonto, non il comune di Modugno — i casi già
   * aperti su quegli annunci restavano in coda per sempre, perché nessuno li
   * chiudeva: la sincronia smetteva soltanto di riproporli. Qui si chiudono da
   * soli, e si dice chi li ha chiusi.
   *
   * Le righe già decise da una persona non si toccano: il filtro sullo stato è
   * quello che le protegge.
   */
  async closeSettledGeographyReview(input: {
    agencyId: string;
    sourceKey: string;
    scope: "IN_SCOPE" | "OUT_OF_SCOPE";
    reasons: string[];
  }): Promise<void> {
    const { error } = await this.db
      .from("review_queue")
      .update({
        status: "RESOLVED",
        resolution: {
          decision: input.scope,
          reason: "Il risolutore geografico ora sa leggere questo indirizzo.",
          reasons: input.reasons,
          settledBy: "STRICT_PLACE_NAME_V1",
        },
        resolved_at: new Date().toISOString(),
      })
      .eq("dedupe_key", this.geographyDedupeKey(input.agencyId, input.sourceKey))
      .in("status", ["OPEN", "IN_REVIEW"]);
    throwIfError(error);
  }

  async recordGeographyReview(input: {
    agencyId: string;
    syncRunId: string;
    listing: NormalizedListingV2;
  }): Promise<void> {
    /* `status` non è nel payload di proposito: l'upsert su `dedupe_key`
     * riscrive le colonne che gli passi, e rimetterci 'OPEN' faceva
     * riaprire a ogni sincronia i casi già decisi. La coda non si è mai
     * svuotata per questo. */
    const { error } = await this.db.from("review_queue").upsert(
      {
        review_type: "GEOGRAPHY",
        agency_id: input.agencyId,
        sync_run_id: input.syncRunId,
        title: "Listing geography requires review",
        details: {
          sourceKey: input.listing.source.sourceKey,
          canonicalUrl: input.listing.source.canonicalUrl,
          location: input.listing.location,
        },
        dedupe_key: this.geographyDedupeKey(input.agencyId, input.listing.source.sourceKey),
      },
      { onConflict: "dedupe_key" },
    );
    throwIfError(error);
  }

  private async authoritativeManualValue<T>(input: {
    targetType: string;
    targetId: string;
    key: string;
    derivedValue: T;
  }): Promise<T> {
    const { data, error } = await this.db
      .from("manual_overrides")
      .select(
        "id,override_key,override_value,effective_at,created_at,supersedes_id,reason",
      )
      .eq("target_type", input.targetType)
      .eq("target_id", input.targetId)
      .eq("override_key", input.key);
    throwIfError(error);
    const overrides = (data ?? []) as Array<{
      id: string;
      override_key: string;
      override_value: T;
      effective_at: string;
      created_at: string;
      supersedes_id: string | null;
      reason: string;
    }>;
    return resolveAuthoritativeValue({
      key: input.key,
      derivedValue: input.derivedValue,
      asOf: new Date().toISOString(),
      overrides: overrides.map((override) => ({
        id: override.id,
        overrideKey: override.override_key,
        overrideValue: override.override_value,
        effectiveAt: override.effective_at,
        createdAt: override.created_at,
        supersedesId: override.supersedes_id,
        reason: override.reason,
      })),
    }).value;
  }

  async authoritativePrivatePublicationState(
    privatePublicationId: string,
    derivedState: "ACTIVE" | "REMOVED",
  ): Promise<"ACTIVE" | "REMOVED"> {
    return this.authoritativeManualValue({
      targetType: "PRIVATE_PUBLICATION",
      targetId: privatePublicationId,
      key: "state",
      derivedValue: derivedState,
    });
  }

  private async updateSaleFromObservation(input: {
    propertyId: string;
    publicationId: string;
    listing: NormalizedListingV2;
  }): Promise<void> {
    const { data: agencyListingsData, error: agencyListingsError } = await this.db
      .from("agency_listings")
      .select("id")
      .eq("property_id", input.propertyId);
    throwIfError(agencyListingsError);
    const agencyListingIds = ((agencyListingsData ?? []) as Array<{ id: string }>).map(
      (row) => row.id,
    );
    let otherActivePublication = false;
    if (agencyListingIds.length > 0) {
      const { count, error } = await this.db
        .from("publications")
        .select("id", { count: "exact", head: true })
        .in("agency_listing_id", agencyListingIds)
        .neq("id", input.publicationId)
        .eq("state", "ACTIVE");
      throwIfError(error);
      otherActivePublication = (count ?? 0) > 0;
    }

    const manualStatus = await this.authoritativeManualValue<SaleStatus | null>({
      targetType: "PROPERTY",
      targetId: input.propertyId,
      key: "sale_status",
      derivedValue: null,
    });
    const assessment = assessSaleStatus({
      explicitSourceSold: input.listing.status.value === "SOLD",
      soldGraphic: input.listing.assets.some(
        (asset) => /vendut|sold/i.test(new URL(asset.canonicalUrl).pathname),
      ),
      trustedPortalSold: false,
      manualStatus,
      otherActivePublication,
    });
    const { error } = await this.db
      .from("properties")
      .update({ sale_status: assessment.status })
      .eq("id", input.propertyId);
    throwIfError(error);

    if (assessment.requiresReview) {
      const { error: reviewError } = await this.db.from("review_queue").upsert(
        {
          review_type: "LIFECYCLE",
          status: "OPEN",
          property_id: input.propertyId,
          publication_id: input.publicationId,
          title: "Conflicting sold and active-publication evidence",
          details: assessment,
          dedupe_key: `sale-conflict:${input.propertyId}`,
        },
        { onConflict: "dedupe_key" },
      );
      throwIfError(reviewError);
    }
  }

  async refreshPropertyIntelligence(propertyId: string): Promise<void> {
    const { data: propertyData, error: propertyError } = await this.db
      .from("properties")
      .select(
        "sale_status,true_market_start_lower_bound,true_market_start_upper_bound,true_market_start_method,true_market_start_confidence,relaunch_count",
      )
      .eq("id", propertyId)
      .single();
    throwIfError(propertyError);
    const property = requiredData(
      propertyData as {
        sale_status: SaleStatus;
        true_market_start_lower_bound: string | null;
        true_market_start_upper_bound: string | null;
        true_market_start_method: string | null;
        true_market_start_confidence: number | null;
        relaunch_count: number;
      } | null,
      null,
      "Refresh property intelligence",
    );
    const { data: agencyListingsData, error: agencyListingsError } = await this.db
      .from("agency_listings")
      .select("id,agency_id,state")
      .eq("property_id", propertyId);
    throwIfError(agencyListingsError);
    const agencyListings = (agencyListingsData ?? []) as Array<{
      id: string;
      agency_id: string;
      state: AgencyListingState;
    }>;
    const activeAgencyCount = new Set(
      agencyListings
        .filter((agencyListing) => agencyListing.state === "ACTIVE")
        .map((agencyListing) => agencyListing.agency_id),
    ).size;
    const { count: privateCount, error: privateError } = await this.db
      .from("private_publications")
      .select("id", { count: "exact", head: true })
      .eq("property_id", propertyId)
      .eq("state", "ACTIVE");
    throwIfError(privateError);
    const activePrivate = (privateCount ?? 0) > 0;
    const propertyState =
      property.sale_status === "SOLD_CONFIRMED" && activeAgencyCount === 0 && !activePrivate
        ? "SOLD"
        : activeAgencyCount > 1 && activePrivate
          ? "ACTIVE_AGENCY_AND_PRIVATE"
          : activeAgencyCount > 1
            ? "ACTIVE_MULTI_AGENCY"
            : activeAgencyCount === 1 && activePrivate
              ? "ACTIVE_AGENCY_AND_PRIVATE"
              : activeAgencyCount === 1
                ? "ACTIVE_AGENCY"
                : activePrivate
                  ? "ACTIVE_PRIVATE"
                  : "OFF_MARKET_UNKNOWN";
    const { error: stateError } = await this.db
      .from("properties")
      .update({ property_state: propertyState })
      .eq("id", propertyId);
    throwIfError(stateError);

    const { count: priceDropCount, error: priceError } = await this.db
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("property_id", propertyId)
      .eq("event_type", "PRICE_DROP");
    throwIfError(priceError);
    const age = property.true_market_start_method
      ? trueMarketAgeDays(
          {
            lowerBound: property.true_market_start_lower_bound,
            upperBound: property.true_market_start_upper_bound,
            method: property.true_market_start_method,
            confidence: property.true_market_start_confidence ?? 0,
          },
          new Date().toISOString(),
        ).minimumDays
      : null;
    const assessments = agencyListings.map((agencyListing) =>
      assessOpportunity({
        saleStatus: property.sale_status,
        agencyListingState: agencyListing.state,
        agencyToPrivate: agencyListing.state === "CLOSED_TO_PRIVATE",
        trueMarketAgeDays: age,
        priceDropCount: priceDropCount ?? 0,
        relaunchCount: property.relaunch_count,
      }),
    );
    const levelRank = { NONE: 0, WATCH: 1, INTERESTING: 2, HIGH: 3, HOT: 4 };
    const opportunity = assessments.sort(
      (left, right) => levelRank[right.level] - levelRank[left.level],
    )[0] ??
      assessOpportunity({
        saleStatus: property.sale_status,
        // No agency listing has ever existed for this property, so no agency
        // exit was ever observed. Claiming one here fabricated history the
        // Radar never saw for private-only properties.
        agencyListingState: null,
        agencyToPrivate: false,
        trueMarketAgeDays: age,
        priceDropCount: priceDropCount ?? 0,
        relaunchCount: property.relaunch_count,
      });
    const { error: opportunityError } = await this.db.from("opportunities").upsert(
      {
        property_id: propertyId,
        opportunity_type: "ACQUISITION",
        status:
          opportunity.level === "NONE"
            ? property.sale_status === "SOLD_CONFIRMED"
              ? "DISMISSED"
              : "EXPIRED"
            : "OPEN",
        level: opportunity.level,
        score: opportunity.score,
        evidence_summary: { propertyState },
        reasons: opportunity.reasons,
        rule_version: 1,
        dedupe_key: `acquisition:${propertyId}:v1`,
      },
      { onConflict: "dedupe_key" },
    );
    throwIfError(opportunityError);
  }

  async runPostExitCheck(input: {
    jobId: string;
    agencyListingId: string;
    publicationId?: string | null;
    checkedAt?: string;
  }): Promise<string> {
    const { data, error } = await this.db.rpc("run_post_exit_check_atomic", {
      p_job_id: input.jobId,
      p_agency_listing_id: input.agencyListingId,
      p_publication_id: input.publicationId ?? null,
      p_checked_at: input.checkedAt ?? new Date().toISOString(),
    });
    throwIfError(error);
    if (typeof data !== "string") {
      throw new Error("Atomic post-exit check returned no outcome.");
    }
    return data;
  }

  async recordManualOverride(input: {
    targetType:
      | "PROPERTY"
      | "AGENCY_LISTING"
      | "PUBLICATION"
      | "PRIVATE_PUBLICATION"
      | "EVENT"
      | "IDENTITY_MATCH"
      | "GEOGRAPHY_SCOPE"
      | "MARKET_AGE";
    targetId: string;
    overrideKey: string;
    overrideValue: unknown;
    previousValue: unknown;
    reason: string;
    source: string;
    sourceReference?: string | null;
    createdBy: string;
    supersedesId?: string | null;
  }): Promise<string> {
    if (!input.reason.trim()) {
      throw new Error("Manual override reason is required.");
    }
    if (
      input.targetType === "PRIVATE_PUBLICATION" &&
      input.overrideKey === "state" &&
      input.overrideValue !== "ACTIVE" &&
      input.overrideValue !== "REMOVED"
    ) {
      throw new Error("Private publication state must be ACTIVE or REMOVED.");
    }
    const { data, error } = await this.db
      .from("manual_overrides")
      .insert({
        target_type: input.targetType,
        target_id: input.targetId,
        override_key: input.overrideKey,
        override_value: input.overrideValue,
        previous_value: input.previousValue,
        reason: input.reason,
        source: input.source,
        source_reference: input.sourceReference ?? null,
        supersedes_id: input.supersedesId ?? null,
        created_by: input.createdBy,
      })
      .select("id")
      .single();
    const overrideId = requiredData(
      data as { id: string } | null,
      error,
      "Record manual override",
    ).id;
    let propertyId: string | null = null;

    if (input.targetType === "PROPERTY") {
      propertyId = input.targetId;
      if (input.overrideKey === "sale_status") {
        const { error: updateError } = await this.db
          .from("properties")
          .update({ sale_status: input.overrideValue })
          .eq("id", input.targetId);
        throwIfError(updateError);
      }
    } else if (input.targetType === "AGENCY_LISTING") {
      const agencyListing = await this.agencyListing(input.targetId);
      propertyId = agencyListing.property_id;
      if (input.overrideKey === "state") {
        const { error: updateError } = await this.db
          .from("agency_listings")
          .update({
            state: input.overrideValue,
            outcome_source: input.source,
            outcome_confidence: 1,
          })
          .eq("id", input.targetId);
        throwIfError(updateError);
      }
    } else if (input.targetType === "PUBLICATION") {
      const { data: publicationData, error: publicationError } = await this.db
        .from("publications")
        .select("agency_listing_id")
        .eq("id", input.targetId)
        .single();
      throwIfError(publicationError);
      propertyId = (
        await this.agencyListing(
          (publicationData as { agency_listing_id: string }).agency_listing_id,
        )
      ).property_id;
    } else if (input.targetType === "PRIVATE_PUBLICATION") {
      const { data: privatePublicationData, error: privatePublicationError } =
        await this.db
          .from("private_publications")
          .select("property_id")
          .eq("id", input.targetId)
          .single();
      throwIfError(privatePublicationError);
      propertyId = (
        privatePublicationData as { property_id: string }
      ).property_id;
      if (input.overrideKey === "state") {
        const state = input.overrideValue as "ACTIVE" | "REMOVED";
        const { error: updateError } = await this.db
          .from("private_publications")
          .update({
            state,
            removed_at: state === "REMOVED" ? new Date().toISOString() : null,
          })
          .eq("id", input.targetId);
        throwIfError(updateError);
      }
    }

    if (propertyId) {
      await this.recordEvent({
        propertyId,
        agencyListingId:
          input.targetType === "AGENCY_LISTING" ? input.targetId : null,
        publicationId: input.targetType === "PUBLICATION" ? input.targetId : null,
        eventType: "MANUAL_OVERRIDE_RECORDED",
        occurredAt: new Date().toISOString(),
        dedupeKey: `manual-override:${overrideId}`,
        actorType: "USER",
        confidence: 1,
        payload: {
          overrideId,
          key: input.overrideKey,
          previousValue: input.previousValue,
          newValue: input.overrideValue,
          reason: input.reason,
          source: input.source,
        },
      });
      await this.refreshPropertyIntelligence(propertyId);
    }
    return overrideId;
  }

  async applyMissingObservations(input: {
    agencyId: string;
    syncRunId: string;
    observedSourceKeys: Set<string>;
    observedAt: string;
    healthState: "HEALTHY" | "DEGRADED" | "FAILED" | "STRUCTURE_CHANGED";
    inventoryComplete: boolean;
    missingHealthyRunThreshold: number;
    postExitDelayHours?: number;
    failurePoint?: "AFTER_MISSING_PUBLICATION";
  }): Promise<{ missingCount: number; transitionedCount: number }> {
    if (input.healthState !== "HEALTHY" || !input.inventoryComplete) {
      return { missingCount: 0, transitionedCount: 0 };
    }
    const { data, error } = await this.db.rpc("apply_missing_observations_atomic", {
      p_agency_id: input.agencyId,
      p_sync_run_id: input.syncRunId,
      p_observed_source_keys: [...input.observedSourceKeys],
      p_observed_at: input.observedAt,
      p_missing_threshold: input.missingHealthyRunThreshold,
      p_post_exit_delay_hours: input.postExitDelayHours ?? 48,
      p_failure_point: input.failurePoint ?? null,
    });
    if (error) {
      await this.recordObservationCommitFailure(input.syncRunId);
      throwIfError(error);
    }
    const result = data as { missingCount?: unknown; transitionedCount?: unknown } | null;
    if (
      typeof result?.missingCount !== "number" ||
      typeof result.transitionedCount !== "number"
    ) {
      throw new Error("Atomic missing observation returned invalid counts.");
    }
    return {
      missingCount: result.missingCount,
      transitionedCount: result.transitionedCount,
    };
  }

}
