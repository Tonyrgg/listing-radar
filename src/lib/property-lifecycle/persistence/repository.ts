import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProcessedAsset } from "@/lib/property-lifecycle/assets/pipeline";
import {
  hashValue,
  normalizedListingV2Schema,
  type NormalizedListingV2,
} from "@/lib/property-lifecycle/contracts/normalized-listing";
import {
  decidePropertyIdentity,
  type IdentityCandidate,
  type IdentityDecision,
  type IdentityObservation,
} from "@/lib/property-lifecycle/identity/scoring";
import { mergeTrueMarketStart } from "@/lib/property-lifecycle/lifecycle/market-age";
import { trueMarketAgeDays } from "@/lib/property-lifecycle/lifecycle/market-age";
import { resolveAuthoritativeValue } from "@/lib/property-lifecycle/lifecycle/manual-overrides";
import { classifyPriceChange } from "@/lib/property-lifecycle/lifecycle/price-history";
import {
  assessSaleStatus,
  type SaleStatus,
} from "@/lib/property-lifecycle/lifecycle/sale-intelligence";
import { assessOpportunity } from "@/lib/property-lifecycle/opportunities/rules";
import {
  agencyStateForPublication,
  evaluatePublicationPresence,
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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value))
  );
}

function observationFromListing(
  listing: NormalizedListingV2,
  processedAssets: ProcessedAsset[],
): IdentityObservation {
  return {
    agencyReference: listing.source.agencyReference,
    address: listing.location.streetName ?? listing.location.rawText,
    locality: listing.location.locality,
    propertyType: listing.commercial.propertyType,
    surfaceSqm: listing.commercial.surfaceSqm,
    rooms: listing.commercial.rooms,
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
    observedCount: number;
    expectedCount: number | null;
    parseErrorCount: number;
    structureFingerprint: string;
    reasons: string[];
    diagnostics: Record<string, unknown>;
    responseStatus?: number | null;
  }): Promise<void> {
    const { error } = await this.db.from("adapter_health").insert({
      agency_id: input.agencyId,
      sync_run_id: input.syncRunId,
      state: input.state,
      observed_count: input.observedCount,
      expected_count: input.expectedCount,
      parse_error_count: input.parseErrorCount,
      structure_fingerprint: input.structureFingerprint,
      response_status: input.responseStatus ?? null,
      reasons: input.reasons,
      diagnostics: input.diagnostics,
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
        "id,property_type,primary_location_id,true_market_start_lower_bound,true_market_start_upper_bound,true_market_start_method,true_market_start_confidence,first_public_evidence_at,canonical_attributes",
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

    const propertyIds = rows.map((row) => row.id);
    const [{ data: refsData, error: refsError }, { data: imagesData, error: imagesError }, { data: plansData, error: plansError }] =
      await Promise.all([
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
    throwIfError(refsError);
    throwIfError(imagesError);
    throwIfError(plansError);

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
    identityStatus: "PROVISIONAL" | "REVIEW",
  ): Promise<string> {
    const { data, error } = await this.db
      .from("properties")
      .insert({
        primary_location_id: locationId,
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
          address: listing.location.streetName ?? listing.location.rawText,
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
            listing.location.streetName ??
            listing.location.rawText,
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
    if (decision.candidates.length > 0) {
      const { error } = await this.db.from("property_match_candidates").upsert(
        decision.candidates.map((candidate) => ({
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
            candidates: decision.candidates.map((candidate) => candidate.propertyId),
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

    if (listing.adapterKey === "vistocasa") {
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
          claimKey: "publication.originalMediaAvailableBy",
          sourceUrl: earliestMediaDate.asset.canonicalUrl,
          extractionMethod: "VISTOCASA_ORIGINAL_MEDIA_LAST_MODIFIED",
          rawValue: earliestMediaDate.asset.lastModified,
          normalizedValue: { lowerBound: null, upperBound: sourceRecordedAt },
          confidence: 0.55,
          observedAt: listing.observedAt,
          sourceRecordedAt,
          metadata: {
            limitation: "media may be prepared before publication or reused",
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
            method: "VISTOCASA_ORIGINAL_MEDIA_LAST_MODIFIED",
            confidence: 0.55,
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
  ): Promise<PersistedObservation> {
    const locationId = await this.upsertLocation(listing);
    const existingPublication = await this.publicationBySource(
      agencyId,
      listing.source.sourceKey,
    );
    let propertyId: string | null = null;
    let identityDecision: IdentityDecision;
    let createdProperty = false;

    if (existingPublication) {
      propertyId = (await this.agencyListing(existingPublication.agency_listing_id)).property_id;
      identityDecision = {
        outcome: "AUTO_MATCH",
        propertyId,
        score: 1,
        margin: 1,
        candidates: [],
      };
    } else {
      const candidates = await this.identityCandidates(agencyId);
      identityDecision = decidePropertyIdentity(
        observationFromListing(listing, processedAssets),
        candidates,
      );
      propertyId = identityDecision.propertyId;
      if (!propertyId) {
        propertyId = await this.createProperty(
          listing,
          locationId,
          identityDecision.outcome === "REVIEW_REQUIRED" ? "REVIEW" : "PROVISIONAL",
        );
        createdProperty = true;
      }
    }

    await this.updatePropertyObservation(propertyId, listing, locationId);
    const agencyListing = existingPublication
      ? await this.agencyListing(existingPublication.agency_listing_id)
      : await this.ensureAgencyListing(agencyId, propertyId, listing);
    let priorPublicationIds: string[] = [];
    let priorOtherAgencyListings: AgencyListingRow[] = [];
    if (!existingPublication) {
      const { data: priorPublications, error: priorPublicationsError } = await this.db
        .from("publications")
        .select("id")
        .eq("agency_listing_id", agencyListing.id);
      throwIfError(priorPublicationsError);
      priorPublicationIds = ((priorPublications ?? []) as Array<{ id: string }>).map(
        (row) => row.id,
      );
      if (!createdProperty) {
        const { data: priorAgencyData, error: priorAgencyError } = await this.db
          .from("agency_listings")
          .select("id,agency_id,property_id,state")
          .eq("property_id", propertyId)
          .neq("agency_id", agencyId);
        throwIfError(priorAgencyError);
        priorOtherAgencyListings = (priorAgencyData ?? []) as AgencyListingRow[];
      }
    }
    let publication = existingPublication;
    let createdPublication = false;
    const initialState: PublicationState = listing.status.value === "SOLD" ? "SOLD_MARKED" : "ACTIVE";

    if (!publication) {
      const { data, error } = await this.db
        .from("publications")
        .insert({
          agency_id: agencyId,
          agency_listing_id: agencyListing.id,
          source_key: listing.source.sourceKey,
          external_id: listing.source.externalId,
          canonical_url: listing.source.canonicalUrl,
          transaction_type: listing.source.transactionType,
          state: initialState,
          source_status: listing.status.value,
          first_seen_at: listing.observedAt,
          last_seen_at: listing.observedAt,
        })
        .select(
          "id,agency_listing_id,source_key,state,source_status,missing_healthy_run_count,missing_since,removed_at",
        )
        .single();
      publication = requiredData(data as PublicationRow | null, error, "Create publication");
      createdPublication = true;
    } else {
      const transition = evaluatePublicationPresence({
        current: {
          state: publication.state,
          sourceStatus: publication.source_status,
          missingHealthyRunCount: publication.missing_healthy_run_count,
          missingSince: publication.missing_since,
          removedAt: publication.removed_at,
        },
        healthState: "HEALTHY",
        inventoryComplete: true,
        observedPresent: true,
        observedSourceStatus: listing.status.value,
        observedAt: listing.observedAt,
      });
      const { error } = await this.db
        .from("publications")
        .update({
          external_id: listing.source.externalId,
          canonical_url: listing.source.canonicalUrl,
          state: transition.next.state,
          source_status: transition.next.sourceStatus,
          missing_healthy_run_count: transition.next.missingHealthyRunCount,
          missing_since: transition.next.missingSince,
          removed_at: transition.next.removedAt,
          last_seen_at: listing.observedAt,
        })
        .eq("id", publication.id);
      throwIfError(error);
      for (const eventType of transition.events) {
        await this.recordEvent({
          propertyId,
          agencyListingId: agencyListing.id,
          publicationId: publication.id,
          syncRunId,
          eventType,
          occurredAt: listing.observedAt,
          dedupeKey: `${publication.id}:${eventType}:${listing.contentHash}`,
          payload: { sourceStatus: listing.status.value },
        });
      }
      publication = { ...publication, state: transition.next.state };
    }

    const { count: otherActivePublicationCount, error: otherActivePublicationError } =
      await this.db
        .from("publications")
        .select("id", { count: "exact", head: true })
        .eq("agency_listing_id", agencyListing.id)
        .neq("id", publication.id)
        .in("state", ["ACTIVE", "MISSING_PENDING"]);
    throwIfError(otherActivePublicationError);
    const nextAgencyState = agencyStateForPublication(
      publication.state,
      agencyListing.state,
      { hasOtherActivePublication: (otherActivePublicationCount ?? 0) > 0 },
    );
    if (nextAgencyState !== agencyListing.state) {
      const { error } = await this.db
        .from("agency_listings")
        .update({
          state: nextAgencyState,
          last_seen_at: listing.observedAt,
          closed_at: nextAgencyState === "CLOSED_SOLD" ? listing.observedAt : null,
          state_confidence: listing.status.confidence,
          state_reason: { sourceStatus: listing.status.value },
        })
        .eq("id", agencyListing.id);
      throwIfError(error);
    }

    if (!existingPublication) {
      await this.recordIdentityDecision(publication.id, identityDecision, propertyId);
    }
    const previousSnapshot = await this.latestSnapshot(publication.id);
    const { snapshotId, evidenceIds } = await this.recordSnapshotAndEvidence(
      listing,
      propertyId,
      publication.id,
      syncRunId,
    );
    await this.recordAssetFingerprints(
      listing,
      propertyId,
      publication.id,
      snapshotId,
      syncRunId,
      processedAssets,
    );

    if (previousSnapshot) {
      const previousListingResult = normalizedListingV2Schema.safeParse(
        previousSnapshot.normalized_payload,
      );
      const previousListing = previousListingResult.success
        ? previousListingResult.data
        : null;
      const previousPerceptual = await this.previousPerceptualFingerprints(
        previousSnapshot.id,
      );
      const currentPerceptual = {
        images: processedAssets
          .filter((asset) => asset.classification !== "FLOORPLAN")
          .map((asset) => asset.perceptualHash),
        floorplans: processedAssets
          .filter((asset) => asset.classification === "FLOORPLAN")
          .map((asset) => asset.perceptualHash),
      };
      const photoUrlsChanged = previousListing
        ? !sameStringSet(
            previousListing.assets
              .filter((asset) => asset.kind === "IMAGE")
              .map((asset) => asset.canonicalUrl),
            listing.assets
              .filter((asset) => asset.kind === "IMAGE")
              .map((asset) => asset.canonicalUrl),
          )
        : false;
      const floorplanUrlsChanged = previousListing
        ? !sameStringSet(
            previousListing.assets
              .filter((asset) => asset.kind === "FLOORPLAN")
              .map((asset) => asset.canonicalUrl),
            listing.assets
              .filter((asset) => asset.kind === "FLOORPLAN")
              .map((asset) => asset.canonicalUrl),
          )
        : false;
      const photoContentChanged =
        previousPerceptual.images.length > 0 &&
        currentPerceptual.images.length > 0 &&
        !sameStringSet(previousPerceptual.images, currentPerceptual.images);
      const floorplanContentChanged =
        previousPerceptual.floorplans.length > 0 &&
        currentPerceptual.floorplans.length > 0 &&
        !sameStringSet(previousPerceptual.floorplans, currentPerceptual.floorplans);

      for (const change of [
        {
          changed: photoUrlsChanged || photoContentChanged,
          eventType: "PHOTO_CHANGED",
          method: photoContentChanged ? "PERCEPTUAL_HASH" : "CANONICAL_URL_SET",
        },
        {
          changed: floorplanUrlsChanged || floorplanContentChanged,
          eventType: "FLOORPLAN_CHANGED",
          method: floorplanContentChanged ? "PERCEPTUAL_HASH" : "CANONICAL_URL_SET",
        },
      ]) {
        if (change.changed) {
          await this.recordEvent({
            propertyId,
            agencyListingId: agencyListing.id,
            publicationId: publication.id,
            syncRunId,
            eventType: change.eventType,
            occurredAt: listing.observedAt,
            dedupeKey: `${publication.id}:${change.eventType}:${previousSnapshot.id}:${snapshotId}`,
            payload: {
              previousSnapshotId: previousSnapshot.id,
              snapshotId,
              method: change.method,
            },
            evidenceIds,
          });
        }
      }
    }

    if (previousSnapshot && previousSnapshot.content_hash !== listing.contentHash) {
      await this.recordEvent({
        propertyId,
        agencyListingId: agencyListing.id,
        publicationId: publication.id,
        syncRunId,
        eventType: "PUBLICATION_CONTENT_CHANGED",
        occurredAt: listing.observedAt,
        dedupeKey: `${publication.id}:PUBLICATION_CONTENT_CHANGED:${previousSnapshot.id}:${listing.contentHash}`,
        payload: {
          previousSnapshotId: previousSnapshot.id,
          snapshotId,
        },
        evidenceIds,
      });
    }
    const priceChange = previousSnapshot
      ? classifyPriceChange(previousSnapshot.price_amount, listing.commercial.priceAmount)
      : null;
    if (previousSnapshot && priceChange) {
      await this.recordEvent({
        propertyId,
        agencyListingId: agencyListing.id,
        publicationId: publication.id,
        syncRunId,
        eventType: priceChange.eventType,
        occurredAt: listing.observedAt,
        dedupeKey: `${publication.id}:${priceChange.eventType}:${previousSnapshot.id}:${listing.commercial.priceAmount}`,
        payload: {
          oldPrice: priceChange.oldPrice,
          newPrice: priceChange.newPrice,
          absoluteDelta: priceChange.absoluteDelta,
          percentageDelta: priceChange.percentageDelta,
          currency: listing.commercial.priceCurrency,
        },
        evidenceIds,
      });
    }

    if (createdProperty) {
      await this.recordEvent({
        propertyId,
        agencyListingId: agencyListing.id,
        publicationId: publication.id,
        syncRunId,
        eventType: "PROPERTY_DISCOVERED",
        occurredAt: listing.observedAt,
        dedupeKey: `${propertyId}:PROPERTY_DISCOVERED`,
        payload: { identityOutcome: identityDecision.outcome },
        evidenceIds,
      });
    }
    if (createdPublication) {
      await this.recordEvent({
        propertyId,
        agencyListingId: agencyListing.id,
        publicationId: publication.id,
        syncRunId,
        eventType: "PUBLICATION_DISCOVERED",
        occurredAt: listing.observedAt,
        dedupeKey: `${publication.id}:PUBLICATION_DISCOVERED`,
        payload: { sourceKey: listing.source.sourceKey },
        evidenceIds,
      });
      if (priorPublicationIds.length > 0) {
        const relaunchEventId = await this.recordEvent({
          propertyId,
          agencyListingId: agencyListing.id,
          publicationId: publication.id,
          syncRunId,
          eventType: "PUBLICATION_RELAUNCHED",
          occurredAt: listing.observedAt,
          dedupeKey: `${publication.id}:PUBLICATION_RELAUNCHED`,
          payload: { priorPublicationIds },
          evidenceIds,
        });
        if (relaunchEventId) {
          const { error } = await this.db.rpc("increment_property_relaunch_count", {
            p_property_id: propertyId,
          });
          throwIfError(error);
        }
      }
      if (priorOtherAgencyListings.length > 0) {
        const switchable = priorOtherAgencyListings.filter((prior) =>
          ["EXIT_PENDING", "OFF_MARKET_NO_SALE_EVIDENCE"].includes(prior.state),
        );
        const activeElsewhere = priorOtherAgencyListings.filter(
          (prior) => prior.state === "ACTIVE",
        );
        if (switchable.length > 0) {
          const switchedIds: string[] = [];
          for (const prior of switchable) {
            const manualState = await this.authoritativeManualValue<AgencyListingState | null>({
              targetType: "AGENCY_LISTING",
              targetId: prior.id,
              key: "state",
              derivedValue: null,
            });
            if (!manualState) {
              const { error } = await this.db
                .from("agency_listings")
                .update({
                  state: "CLOSED_SWITCHED",
                  closed_at: listing.observedAt,
                  outcome_source: "CROSS_AGENCY_IDENTITY_V1",
                  outcome_confidence: identityDecision.score,
                })
                .eq("id", prior.id);
              throwIfError(error);
              switchedIds.push(prior.id);
            }
          }
          if (switchedIds.length > 0) {
            await this.recordEvent({
              propertyId,
              agencyListingId: agencyListing.id,
              publicationId: publication.id,
              syncRunId,
              eventType: "AGENCY_SWITCH_DETECTED",
              occurredAt: listing.observedAt,
              dedupeKey: `${publication.id}:AGENCY_SWITCH_DETECTED`,
              confidence: identityDecision.score,
              payload: { previousAgencyListingIds: switchedIds },
              evidenceIds,
            });
          }
        } else if (activeElsewhere.length > 0) {
          await this.recordEvent({
            propertyId,
            agencyListingId: agencyListing.id,
            publicationId: publication.id,
            syncRunId,
            eventType: "MULTI_AGENCY_PUBLICATION_OBSERVED",
            occurredAt: listing.observedAt,
            dedupeKey: `${publication.id}:MULTI_AGENCY_PUBLICATION_OBSERVED`,
            confidence: identityDecision.score,
            payload: { otherAgencyListingIds: activeElsewhere.map((row) => row.id) },
            evidenceIds,
          });
        }
      }
      if (listing.status.value === "SOLD") {
        await this.recordEvent({
          propertyId,
          agencyListingId: agencyListing.id,
          publicationId: publication.id,
          syncRunId,
          eventType: "SOURCE_MARKED_SOLD",
          occurredAt: listing.observedAt,
          dedupeKey: `${publication.id}:SOURCE_MARKED_SOLD:${listing.contentHash}`,
          confidence: listing.status.confidence,
          evidenceIds,
        });
      }
    }

    await this.updateSaleFromObservation({
      propertyId,
      publicationId: publication.id,
      listing,
    });
    await this.refreshPropertyIntelligence(propertyId);

    return {
      propertyId,
      agencyListingId: agencyListing.id,
      publicationId: publication.id,
      snapshotId,
      identityDecision,
      createdProperty,
      createdPublication,
    };
  }

  async recordGeographyReview(input: {
    agencyId: string;
    syncRunId: string;
    listing: NormalizedListingV2;
  }): Promise<void> {
    const { error } = await this.db.from("review_queue").upsert(
      {
        review_type: "GEOGRAPHY",
        status: "OPEN",
        agency_id: input.agencyId,
        sync_run_id: input.syncRunId,
        title: "Listing geography requires review",
        details: {
          sourceKey: input.listing.source.sourceKey,
          canonicalUrl: input.listing.source.canonicalUrl,
          location: input.listing.location,
        },
        dedupe_key: `geography:${input.agencyId}:${input.listing.source.sourceKey}`,
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
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("property_id", propertyId)
      .in("event_type", ["PRIVATE_RELIST", "AGENCY_TO_PRIVATE"]);
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
        agencyListingState: "OFF_MARKET_NO_SALE_EVIDENCE",
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
  }): Promise<string> {
    const { data: agencyListingData, error: agencyListingError } = await this.db
      .from("agency_listings")
      .select("id,agency_id,property_id,state")
      .eq("id", input.agencyListingId)
      .single();
    const agencyListing = requiredData(
      agencyListingData as AgencyListingRow | null,
      agencyListingError,
      "Post-exit agency listing",
    );
    const publicationQuery = this.db
      .from("publications")
      .select("id,state,source_status")
      .eq("agency_listing_id", agencyListing.id)
      .order("last_seen_at", { ascending: false })
      .limit(1);
    const { data: publicationData, error: publicationError } = input.publicationId
      ? await publicationQuery.eq("id", input.publicationId).single()
      : await publicationQuery.single();
    throwIfError(publicationError);
    const publication = requiredData(
      publicationData as { id: string; state: PublicationState; source_status: string } | null,
      null,
      "Post-exit publication",
    );
    const { count: switchedCount, error: switchedError } = await this.db
      .from("agency_listings")
      .select("id", { count: "exact", head: true })
      .eq("property_id", agencyListing.property_id)
      .neq("agency_id", agencyListing.agency_id)
      .eq("state", "ACTIVE");
    throwIfError(switchedError);
    const { count: privateCount, error: privateError } = await this.db
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("property_id", agencyListing.property_id)
      .in("event_type", ["PRIVATE_RELIST", "AGENCY_TO_PRIVATE"]);
    throwIfError(privateError);

    const manualOutcome = await this.authoritativeManualValue<AgencyListingState | null>({
      targetType: "AGENCY_LISTING",
      targetId: agencyListing.id,
      key: "state",
      derivedValue: null,
    });
    const reappeared = publication.state === "ACTIVE";
    const explicitSold =
      publication.state === "SOLD_MARKED" || publication.source_status === "SOLD";
    const switched = (switchedCount ?? 0) > 0;
    const privateRelist = (privateCount ?? 0) > 0;
    const outcome = manualOutcome ??
      (reappeared
        ? "ACTIVE"
        : explicitSold
          ? "CLOSED_SOLD"
          : switched
            ? "CLOSED_SWITCHED"
            : privateRelist
              ? "CLOSED_TO_PRIVATE"
              : "OFF_MARKET_NO_SALE_EVIDENCE");
    const checkOutcome = outcome === "ACTIVE" ? "REAPPEARED" : outcome;
    const confidence = manualOutcome
      ? 1
      : explicitSold || switched || privateRelist
        ? 0.95
        : reappeared
          ? 1
          : 0.85;
    const { error: checkError } = await this.db.from("post_exit_checks").insert({
      agency_listing_id: agencyListing.id,
      publication_id: publication.id,
      job_id: input.jobId,
      technical_disappearance_confirmed: publication.state === "REMOVED",
      explicit_sale_evidence: explicitSold,
      switched_agency_evidence: switched,
      private_relist_evidence: privateRelist,
      reappearance_evidence: reappeared,
      outcome: checkOutcome,
      confidence,
      evidence_summary: { manualOutcome },
    });
    throwIfError(checkError);

    if (outcome !== "ACTIVE") {
      const { error } = await this.db
        .from("agency_listings")
        .update({
          state: outcome,
          closed_at: new Date().toISOString(),
          exit_confirmed_at: new Date().toISOString(),
          outcome_source: manualOutcome ? "MANUAL_OVERRIDE" : "POST_EXIT_MONITOR_V1",
          outcome_confidence: confidence,
        })
        .eq("id", agencyListing.id);
      throwIfError(error);
    }
    await this.recordEvent({
      propertyId: agencyListing.property_id,
      agencyListingId: agencyListing.id,
      publicationId: publication.id,
      eventType:
        checkOutcome === "REAPPEARED" ? "PUBLICATION_REAPPEARED" : "POST_EXIT_CLASSIFIED",
      occurredAt: new Date().toISOString(),
      dedupeKey: `${agencyListing.id}:POST_EXIT:${input.jobId}`,
      confidence,
      payload: { outcome: checkOutcome },
    });
    await this.refreshPropertyIntelligence(agencyListing.property_id);
    return checkOutcome;
  }

  async recordManualOverride(input: {
    targetType:
      | "PROPERTY"
      | "AGENCY_LISTING"
      | "PUBLICATION"
      | "EVENT"
      | "IDENTITY_MATCH"
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
  }): Promise<{ missingCount: number; transitionedCount: number }> {
    if (input.healthState !== "HEALTHY" || !input.inventoryComplete) {
      return { missingCount: 0, transitionedCount: 0 };
    }

    const { data, error } = await this.db
      .from("publications")
      .select(
        "id,agency_listing_id,source_key,state,source_status,missing_healthy_run_count,missing_since,removed_at",
      )
      .eq("agency_id", input.agencyId)
      .in("state", ["ACTIVE", "MISSING_PENDING"]);
    throwIfError(error);
    const publications = (data ?? []) as PublicationRow[];
    let missingCount = 0;
    let transitionedCount = 0;
    const affectedPropertyIds = new Set<string>();

    for (const publication of publications) {
      if (input.observedSourceKeys.has(publication.source_key)) {
        continue;
      }
      const agencyListing = await this.agencyListing(publication.agency_listing_id);
      affectedPropertyIds.add(agencyListing.property_id);
      const transition = evaluatePublicationPresence({
        current: {
          state: publication.state,
          sourceStatus: publication.source_status,
          missingHealthyRunCount: publication.missing_healthy_run_count,
          missingSince: publication.missing_since,
          removedAt: publication.removed_at,
        },
        healthState: input.healthState,
        inventoryComplete: input.inventoryComplete,
        observedPresent: false,
        observedAt: input.observedAt,
        missingHealthyRunThreshold: input.missingHealthyRunThreshold,
      });
      const { error: updateError } = await this.db
        .from("publications")
        .update({
          state: transition.next.state,
          missing_healthy_run_count: transition.next.missingHealthyRunCount,
          missing_since: transition.next.missingSince,
          removed_at: transition.next.removedAt,
        })
        .eq("id", publication.id);
      throwIfError(updateError);
      missingCount += 1;

      const { count: otherActiveCount, error: otherActiveError } = await this.db
        .from("publications")
        .select("id", { count: "exact", head: true })
        .eq("agency_listing_id", agencyListing.id)
        .neq("id", publication.id)
        .in("state", ["ACTIVE", "MISSING_PENDING"]);
      throwIfError(otherActiveError);
      const nextAgencyState = agencyStateForPublication(
        transition.next.state,
        agencyListing.state,
        { hasOtherActivePublication: (otherActiveCount ?? 0) > 0 },
      );
      if (nextAgencyState !== agencyListing.state) {
        const { error: agencyError } = await this.db
          .from("agency_listings")
          .update({ state: nextAgencyState, state_reason: { publicationState: transition.next.state } })
          .eq("id", agencyListing.id);
        throwIfError(agencyError);
      }

      if (
        transition.next.state === "REMOVED" &&
        nextAgencyState === "EXIT_PENDING" &&
        (otherActiveCount ?? 0) === 0
      ) {
        const { error: jobError } = await this.db.from("lifecycle_jobs").insert({
          job_type: "POST_EXIT_CHECK",
          agency_id: input.agencyId,
          payload: {
            agencyListingId: agencyListing.id,
            publicationId: publication.id,
          },
          dedupe_key: `POST_EXIT_CHECK:${agencyListing.id}:${publication.id}:${transition.next.missingHealthyRunCount}`,
        });
        if (jobError?.code !== "23505") {
          throwIfError(jobError);
        }
      }

      for (const eventType of transition.events) {
        const event = await this.recordEvent({
          propertyId: agencyListing.property_id,
          agencyListingId: agencyListing.id,
          publicationId: publication.id,
          syncRunId: input.syncRunId,
          eventType,
          occurredAt: input.observedAt,
          dedupeKey: `${publication.id}:${eventType}:${transition.next.missingHealthyRunCount}`,
          payload: { missingHealthyRunCount: transition.next.missingHealthyRunCount },
        });
        if (event) {
          transitionedCount += 1;
        }
      }
    }

    for (const propertyId of affectedPropertyIds) {
      await this.refreshPropertyIntelligence(propertyId);
    }

    return { missingCount, transitionedCount };
  }
}
