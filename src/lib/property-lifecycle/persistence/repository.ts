import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProcessedAsset } from "@/lib/property-lifecycle/assets/pipeline";
import type { BootstrapExistingState } from "@/lib/property-lifecycle/bootstrap/dry-run";
import { canonicalBuildingAddress } from "@/lib/property-lifecycle/buildings/address";
import {
  hashValue,
  rehashNormalizedListing,
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
import { resolveAuthoritativeValue } from "@/lib/property-lifecycle/lifecycle/manual-overrides";
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
  inventory_url: string;
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
    description: listing.commercial.description,
    latitude: listing.location.latitude,
    longitude: listing.location.longitude,
    coordinatesExact: listing.location.precision === "EXACT_COORDINATES",
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
  private readonly identityCatalog = new Map<string, Promise<IdentityCandidate[]>>();
  private readonly primarySourceHosts = new Map<string,string>();
  constructor(private readonly db: SupabaseClient) {}

  async getAgencyBySlug(slug: string): Promise<AgencyRow> {
    const { data, error } = await this.db
      .from("agencies")
      .select("id,slug,adapter_key,settings,inventory_url")
      .eq("slug", slug)
      .single();
    const agency=requiredData(data as AgencyRow | null,error,`Agency ${slug}`);
    this.primarySourceHosts.set(agency.id,new URL(agency.inventory_url).hostname.toLowerCase().replace(/^www\./,""));
    return agency;
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
    const [agencies, properties, agencyListings, publications] =
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
      ]);
    const { images, plans: floorplans } = await this.identityFingerprints(properties.map(row => row.id));
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
    let corroboratedLowerInventory = false;
    if (input.state === "HEALTHY" && input.sourceComplete && input.observedCount > 0 &&
      input.expectedCount === input.observedCount && input.parseErrorCount === 0 &&
      baseline.rollingMedian && input.observedCount / baseline.rollingMedian < 0.7 &&
      input.structureFingerprint === baseline.schemaFingerprint) {
      const previous = await this.db.from("adapter_health")
        .select("observed_count,expected_count,parse_error_count,structure_fingerprint,checked_at,diagnostics")
        .eq("agency_id", input.agencyId).order("checked_at", {ascending:false}).limit(8);
      throwIfError(previous.error);
      const rows = (previous.data ?? []) as Array<{
        observed_count:number; expected_count:number; parse_error_count:number;
        structure_fingerprint:string; checked_at:string; diagnostics:Record<string,unknown>;
      }>;
      corroboratedLowerInventory = rows.length >= 3 && rows.every(row =>
        Math.abs(row.observed_count-input.observedCount) <= Math.max(1,input.observedCount*0.05) &&
        row.expected_count === row.observed_count &&
        row.parse_error_count === 0 && row.structure_fingerprint === input.structureFingerprint &&
        row.diagnostics.sourceState === "HEALTHY" && row.diagnostics.sourceComplete === true) &&
        Date.parse(rows[0].checked_at) - Date.parse(rows[rows.length-1].checked_at) >= 86_400_000;
    }
    const evaluation = evaluateHealthBaseline({
      baseline,
      sourceState: input.state as "HEALTHY" | "DEGRADED" | "FAILED" | "STRUCTURE_CHANGED",
      sourceComplete: input.sourceComplete,
      observedCount: input.observedCount,
      structureFingerprint: input.structureFingerprint,
      corroboratedLowerInventory,
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

  private identityCandidates(agencyId: string): Promise<IdentityCandidate[]> {
    let catalog = this.identityCatalog.get(agencyId);
    if (!catalog) {
      catalog = this.loadIdentityCandidates(agencyId);
      this.identityCatalog.set(agencyId, catalog);
    }
    return catalog;
  }

  private async identityFingerprints(propertyIds: string[]) {
    type Value = { algorithm: string; fingerprint: string };
    type Row = Value & { property_id: string };
    const images: Row[] = [], plans: Row[] = [];
    // Each RPC returns at most 75 rows, each containing all distinct values for
    // one property. No 1,000-row truncation or repeated offset/DISTINCT scans.
    for (const ids of batchesOf(propertyIds)) {
      const { data, error } = await this.db.rpc("lifecycle_identity_fingerprint_bundles", { p_property_ids: ids });
      throwIfError(error);
      for (const row of (data ?? []) as Array<{ property_id: string; images: Value[]; floorplans: Value[] }>) {
        images.push(...row.images.map(value => ({ ...value, property_id: row.property_id })));
        plans.push(...row.floorplans.map(value => ({ ...value, property_id: row.property_id })));
      }
    }
    return { images, plans };
  }

  private async loadIdentityCandidates(agencyId: string): Promise<IdentityCandidate[]> {
    const rows = await allDatabaseRows<{
      id: string;
      property_type: string | null;
      canonical_attributes: Record<string, unknown>;
    }>(async (from,to)=>await this.db.from("properties").select("id,property_type,canonical_attributes")
      .neq("identity_status","MERGED").order("id").range(from,to));
    if (rows.length === 0) {
      return [];
    }

    const propertyIdBatches = batchesOf(rows.map((row) => row.id));
    const refsData: Array<{ property_id: string; agency_id: string; agency_reference: string | null }> = [];
    for (const propertyIds of propertyIdBatches) {
      const refs = await this.db
            .from("agency_listings")
            .select("property_id,agency_id,agency_reference")
            .in("property_id", propertyIds);
      throwIfError(refs.error);
      refsData.push(...(refs.data ?? []));
    }
    const { images: imagesData, plans: plansData } = await this.identityFingerprints(rows.map(row => row.id));

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
      description: stringValue(row.canonical_attributes.description),
      latitude: numberValue(row.canonical_attributes.latitude),
      longitude: numberValue(row.canonical_attributes.longitude),
      coordinatesExact: row.canonical_attributes.coordinatePrecision === "EXACT_COORDINATES",
      imageFingerprints: images
        .filter((image) => image.property_id === row.id)
        .map((image) => `${image.algorithm}:${image.fingerprint}`),
      floorplanFingerprints: plans
        .filter((plan) => plan.property_id === row.id)
        .map((plan) => `${plan.algorithm}:${plan.fingerprint}`),
    }));
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

  async persistObservation(
    agencyId: string,
    syncRunId: string,
    listing: NormalizedListingV2,
    processedAssets: ProcessedAsset[] = [],
    options: { failurePoint?: ObservationFailurePoint } = {},
  ): Promise<PersistedObservation> {
    let primaryHost=this.primarySourceHosts.get(agencyId);
    if (!primaryHost) {
      const source=await this.db.from("agencies").select("inventory_url").eq("id",agencyId).single();
      const agency=requiredData(source.data as {inventory_url:string}|null,source.error,"Primary publication source");
      primaryHost=new URL(agency.inventory_url).hostname.toLowerCase().replace(/^www\./,"");
      this.primarySourceHosts.set(agencyId,primaryHost);
    }
    const sourceHost=new URL(listing.source.canonicalUrl).hostname.toLowerCase().replace(/^www\./,"");
    if (sourceHost!==primaryHost && !listing.source.sourceKey.startsWith(`${sourceHost}:`)) {
      listing=rehashNormalizedListing(listing,input=>({...input,source:{...input.source,sourceKey:`${sourceHost}:${input.source.sourceKey}`}}));
    }
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
        changed?: boolean;
      } | null,
      null,
      "Atomic observation",
    );

    if (result.createdProperty) {
      const catalog = this.identityCatalog.get(agencyId);
      if (catalog) (await catalog).push({
        ...identityObservationFromListing(listing, processedAssets), propertyId: result.propertyId,
        knownAgencyReferences: listing.source.agencyReference ? [listing.source.agencyReference] : [],
      });
    }
    if (result.changed !== false) await this.uploadRepresentativeThumbnails(result.propertyId, processedAssets);
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
      .slice(0, 1);
    if (representatives.length === 0) {
      return;
    }
    try {
      const paths: string[] = [];
      for (const representative of representatives) {
        const path = `${propertyId}/preview-640-${representative.sha256}.webp`;
        const { error } = await this.db.storage
          .from("property-lifecycle-visuals")
          .upload(path, representative.representativeThumbnail as Uint8Array, {
            contentType: "image/webp",
            cacheControl: "31536000",
            upsert: true,
          });
        throwIfError(error);
        paths.push(path);
      }
      const { error: updateError } = await this.db
        .from("properties")
        .update({
          representative_image_paths: paths.slice(0, 1),
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

  async refreshPropertyIntelligence(propertyId: string): Promise<void> {
    const { error } = await this.db.rpc("refresh_property_lifecycle_intelligence_atomic", {
      p_property_id: propertyId,
    });
    throwIfError(error);
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
