import type { SupabaseClient } from "@supabase/supabase-js";

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
import { mergeTrueMarketStart } from "@/lib/property-lifecycle/lifecycle/market-age";
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

function observationFromListing(listing: NormalizedListingV2): IdentityObservation {
  const fingerprints = listing.assets.map((asset) => hashValue(asset.canonicalUrl));
  return {
    agencyReference: listing.source.agencyReference,
    address: listing.location.streetName ?? listing.location.rawText,
    locality: listing.location.locality,
    propertyType: listing.commercial.propertyType,
    surfaceSqm: listing.commercial.surfaceSqm,
    rooms: listing.commercial.rooms,
    imageFingerprints: listing.assets
      .filter((asset) => asset.kind === "IMAGE")
      .map((asset) => fingerprints[listing.assets.indexOf(asset)] ?? hashValue(asset.canonicalUrl)),
    floorplanFingerprints: listing.assets
      .filter((asset) => asset.kind === "FLOORPLAN")
      .map((asset) => fingerprints[listing.assets.indexOf(asset)] ?? hashValue(asset.canonicalUrl)),
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
      .select("id,property_id,state")
      .eq("id", id)
      .single();
    return requiredData(data as AgencyListingRow | null, error, "Agency listing");
  }

  private async property(id: string): Promise<PropertyRow> {
    const { data, error } = await this.db
      .from("properties")
      .select(
        "id,property_type,primary_location_id,true_market_start_lower_bound,true_market_start_upper_bound,true_market_start_method,true_market_start_confidence,canonical_attributes",
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
          .select("property_id,fingerprint")
          .in("property_id", propertyIds),
        this.db
          .from("floorplan_fingerprints")
          .select("property_id,fingerprint")
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
    const images = (imagesData ?? []) as Array<{ property_id: string; fingerprint: string }>;
    const plans = (plansData ?? []) as Array<{ property_id: string; fingerprint: string }>;

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
        .map((image) => image.fingerprint),
      floorplanFingerprints: plans
        .filter((plan) => plan.property_id === row.id)
        .map((plan) => plan.fingerprint),
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
    const { error } = await this.db
      .from("properties")
      .update({
        primary_location_id: existing.primary_location_id ?? locationId,
        property_type: existing.property_type ?? listing.commercial.propertyType,
        true_market_start_lower_bound: marketStart.lowerBound,
        true_market_start_upper_bound: marketStart.upperBound,
        true_market_start_method: marketStart.method,
        true_market_start_confidence: marketStart.confidence,
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
      .select("id,property_id,state")
      .single();
    return requiredData(data as AgencyListingRow | null, error, "Upsert agency listing");
  }

  private async recordEvent(input: {
    propertyId: string;
    agencyListingId?: string | null;
    publicationId?: string | null;
    syncRunId: string;
    eventType: string;
    occurredAt: string;
    dedupeKey: string;
    confidence?: number;
    payload?: Record<string, unknown>;
    evidenceIds?: string[];
  }): Promise<string | null> {
    const { data, error } = await this.db
      .from("events")
      .insert({
        property_id: input.propertyId,
        agency_listing_id: input.agencyListingId ?? null,
        publication_id: input.publicationId ?? null,
        sync_run_id: input.syncRunId,
        event_type: input.eventType,
        occurred_at: input.occurredAt,
        confidence: input.confidence ?? 1,
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
  } | null> {
    const { data, error } = await this.db
      .from("snapshots")
      .select("id,price_amount,content_hash")
      .eq("publication_id", publicationId)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return data as { id: string; price_amount: number | null; content_hash: string } | null;
  }

  private async recordAssetFingerprints(
    listing: NormalizedListingV2,
    propertyId: string,
    publicationId: string,
    snapshotId: string,
  ): Promise<void> {
    const images = listing.assets.filter((asset) => asset.kind === "IMAGE");
    const floorplans = listing.assets.filter((asset) => asset.kind === "FLOORPLAN");
    if (images.length > 0) {
      const { error } = await this.db.from("image_fingerprints").insert(
        images.map((asset) => ({
          property_id: propertyId,
          publication_id: publicationId,
          snapshot_id: snapshotId,
          canonical_url: asset.canonicalUrl,
          algorithm: "SOURCE_URL_SHA256",
          fingerprint: hashValue(asset.canonicalUrl),
          source_recorded_at: asset.sourceRecordedAt,
          metadata: asset.metadata,
        })),
      );
      throwIfError(error);
    }
    if (floorplans.length > 0) {
      const { error } = await this.db.from("floorplan_fingerprints").insert(
        floorplans.map((asset) => ({
          property_id: propertyId,
          publication_id: publicationId,
          snapshot_id: snapshotId,
          canonical_url: asset.canonicalUrl,
          algorithm: "SOURCE_URL_SHA256",
          fingerprint: hashValue(asset.canonicalUrl),
          metadata: asset.metadata,
        })),
      );
      throwIfError(error);
    }
  }

  async persistObservation(
    agencyId: string,
    syncRunId: string,
    listing: NormalizedListingV2,
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
      identityDecision = decidePropertyIdentity(observationFromListing(listing), candidates);
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
    if (!existingPublication) {
      const { data: priorPublications, error: priorPublicationsError } = await this.db
        .from("publications")
        .select("id")
        .eq("agency_listing_id", agencyListing.id);
      throwIfError(priorPublicationsError);
      priorPublicationIds = ((priorPublications ?? []) as Array<{ id: string }>).map(
        (row) => row.id,
      );
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

    const nextAgencyState = agencyStateForPublication(publication.state, agencyListing.state);
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
    );

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
    if (previousSnapshot && previousSnapshot.price_amount !== listing.commercial.priceAmount) {
      await this.recordEvent({
        propertyId,
        agencyListingId: agencyListing.id,
        publicationId: publication.id,
        syncRunId,
        eventType: "PRICE_CHANGED",
        occurredAt: listing.observedAt,
        dedupeKey: `${publication.id}:PRICE_CHANGED:${previousSnapshot.id}:${listing.commercial.priceAmount}`,
        payload: {
          from: previousSnapshot.price_amount,
          to: listing.commercial.priceAmount,
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
        await this.recordEvent({
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

    for (const publication of publications) {
      if (input.observedSourceKeys.has(publication.source_key)) {
        continue;
      }
      const agencyListing = await this.agencyListing(publication.agency_listing_id);
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

      const nextAgencyState = agencyStateForPublication(
        transition.next.state,
        agencyListing.state,
      );
      if (nextAgencyState !== agencyListing.state) {
        const { error: agencyError } = await this.db
          .from("agency_listings")
          .update({ state: nextAgencyState, state_reason: { publicationState: transition.next.state } })
          .eq("id", agencyListing.id);
        throwIfError(agencyError);
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

    return { missingCount, transitionedCount };
  }
}
