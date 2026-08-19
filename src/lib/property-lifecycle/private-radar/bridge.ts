import type { SupabaseClient } from "@supabase/supabase-js";

import { canonicalBuildingAddress } from "@/lib/property-lifecycle/buildings/address";
import {
  hashValue,
  type GeographyScope,
} from "@/lib/property-lifecycle/contracts/normalized-listing";
import { resolveMonitoredGeography } from "@/lib/property-lifecycle/geography/scope";
import {
  decidePropertyIdentity,
  type IdentityCandidate,
  type IdentityDecision,
  type IdentityObservation,
} from "@/lib/property-lifecycle/identity/scoring";
import { mergeTrueMarketStart } from "@/lib/property-lifecycle/lifecycle/market-age";
import { PropertyLifecycleRepository } from "@/lib/property-lifecycle/persistence/repository";

interface DatabaseError {
  code?: string;
  message: string;
}

interface LegacyPrivateListing {
  id: string;
  source: string;
  source_listing_id: string | null;
  url: string;
  canonical_url: string | null;
  title: string;
  description: string | null;
  price: number | null;
  sqm: number | null;
  rooms: number | null;
  floor: string | null;
  zone: string | null;
  address_raw: string | null;
  latitude: number | null;
  longitude: number | null;
  portal_declared_date: string | null;
  metadata_date_published: string | null;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  seller_name: string | null;
  seller_classification_confidence: number | null;
}

interface PrivateCandidate {
  propertyId: string;
  agencySlugs: string[];
  address: string | null;
  locality: string | null;
  propertyType: string | null;
  surfaceSqm: number | null;
  rooms: number | null;
  imageFingerprints: string[];
  floorplanFingerprints: string[];
}

export interface PrivateRadarSyncResult {
  scannedListings: number;
  inScopeListings: number;
  excludedListings: number;
  activePublications: number;
  removedPublications: number;
  createdPublications: number;
  updatedPublications: number;
  unchangedPublications: number;
  newProperties: number;
  autoMatches: number;
  reviewRequired: number;
  agencyToPrivateEvents: number;
  simultaneousPrivateEvents: number;
  removedEvents: number;
  soldOrManualConflicts: number;
  warnings: string[];
}

function throwIfError(error: DatabaseError | null): void {
  if (error) {
    throw new Error(error.message);
  }
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeText(value: string | null, sellerName: string | null): string | null {
  let sanitized = value;
  if (sanitized && sellerName?.trim()) {
    sanitized = sanitized.replace(
      new RegExp(escapeRegExp(sellerName.trim()), "gi"),
      "[contact removed]",
    );
  }
  return (
    sanitized
      ?.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[contact removed]")
      .replace(/https?:\/\/\S+/gi, "[link removed]")
      .replace(
        /\b(?:\+39\s*)?(?:0\d{1,3}|3\d{2})(?:[\s.-]*\d){6,9}\b/g,
        "[contact removed]",
      )
      .trim() || null
  );
}

function propertyType(title: string): string | null {
  const rules: Array<[RegExp, string]> = [
    [/\bappartament|\btrilocal|\bbilocal|\bquadrilocal/i, "Appartamento"],
    [/\bvilla|\bvilletta/i, "Villa"],
    [/\blocale|\bnegozio|\bdeposito/i, "Locale"],
    [/\bbox|\bgarage|\bposto auto/i, "Box"],
    [/\bterreno/i, "Terreno"],
    [/\bpalazz|\bstabile/i, "Stabile"],
  ];
  return rules.find(([pattern]) => pattern.test(title))?.[1] ?? null;
}

function marketStart(listing: LegacyPrivateListing): {
  lowerBound: string | null;
  upperBound: string;
  method: string;
  confidence: number;
} {
  if (listing.portal_declared_date) {
    return {
      lowerBound: null,
      upperBound: listing.portal_declared_date,
      method: "PRIVATE_PORTAL_DECLARED_DATE",
      confidence: 0.7,
    };
  }
  if (listing.metadata_date_published) {
    return {
      lowerBound: null,
      upperBound: listing.metadata_date_published,
      method: "PRIVATE_METADATA_DATE_PUBLISHED",
      confidence: 0.65,
    };
  }
  return {
    lowerBound: null,
    upperBound: listing.first_seen_at,
    method: "PRIVATE_CRAWLER_FIRST_SEEN",
    confidence: 0.25,
  };
}

function identityAddress(input: {
  streetName: string | null;
  streetNumber: string | null;
  rawText: string | null;
}): string | null {
  return input.streetName
    ? [input.streetName, input.streetNumber].filter(Boolean).join(" ")
    : input.rawText;
}

function observation(
  listing: LegacyPrivateListing,
  location: ReturnType<typeof resolveMonitoredGeography>,
): IdentityObservation {
  return {
    agencyReference: null,
    address: identityAddress(location),
    locality: location.locality,
    propertyType: propertyType(listing.title),
    surfaceSqm: listing.sqm,
    rooms: listing.rooms,
    imageFingerprints: [],
    floorplanFingerprints: [],
  };
}

function asIdentityCandidate(candidate: PrivateCandidate): IdentityCandidate {
  return {
    propertyId: candidate.propertyId,
    agencyReference: null,
    knownAgencyReferences: [],
    address: candidate.address,
    locality: candidate.locality,
    propertyType: candidate.propertyType,
    surfaceSqm: candidate.surfaceSqm,
    rooms: candidate.rooms,
    imageFingerprints: candidate.imageFingerprints,
    floorplanFingerprints: candidate.floorplanFingerprints,
  };
}

function locationForListing(listing: LegacyPrivateListing) {
  const sanitizedTitle = sanitizeText(listing.title, listing.seller_name);
  const addressText = [listing.address_raw, listing.zone]
    .filter(Boolean)
    .join(", ");
  const resolved = resolveMonitoredGeography({
    rawText: [addressText, sanitizedTitle]
      .filter(Boolean)
      .join(", "),
    latitude: numberValue(listing.latitude),
    longitude: numberValue(listing.longitude),
    coordinatesExact: false,
  });
  return {
    ...resolved,
    rawText: addressText || sanitizedTitle,
  };
}

function privateState(
  listing: LegacyPrivateListing,
  lastAvailability: boolean | null,
): "ACTIVE" | "REMOVED" {
  return listing.status.toLocaleLowerCase("it") === "archived" ||
    lastAvailability === false
    ? "REMOVED"
    : "ACTIVE";
}

function sameInstant(left: string, right: string): boolean {
  return new Date(left).getTime() === new Date(right).getTime();
}

export class PrivateRadarBridge {
  private readonly repository: PropertyLifecycleRepository;

  constructor(private readonly db: SupabaseClient) {
    this.repository = new PropertyLifecycleRepository(db);
  }

  private async legacyListings(): Promise<LegacyPrivateListing[]> {
    const rows: LegacyPrivateListing[] = [];
    const pageSize = 1_000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.db
        .from("listings")
        .select(
          "id,source,source_listing_id,url,canonical_url,title,description,price,sqm,rooms,floor,zone,address_raw,latitude,longitude,portal_declared_date,metadata_date_published,first_seen_at,last_seen_at,status,seller_name,seller_classification_confidence",
        )
        .eq("seller_type", "private")
        .order("id")
        .range(from, from + pageSize - 1);
      throwIfError(error);
      const page = (data ?? []) as LegacyPrivateListing[];
      rows.push(...page);
      if (page.length < pageSize) {
        return rows;
      }
    }
  }

  private async latestAvailability(
    listingIds: string[],
  ): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    for (let index = 0; index < listingIds.length; index += 100) {
      const ids = listingIds.slice(index, index + 100);
      const { data, error } = await this.db
        .from("listing_snapshots")
        .select("listing_id,is_available,checked_at")
        .in("listing_id", ids)
        .order("checked_at", { ascending: false });
      throwIfError(error);
      for (const row of (data ?? []) as Array<{
        listing_id: string;
        is_available: boolean;
      }>) {
        if (!result.has(row.listing_id)) {
          result.set(row.listing_id, row.is_available);
        }
      }
    }
    return result;
  }

  private async upsertLocation(
    listing: LegacyPrivateListing,
    location: ReturnType<typeof resolveMonitoredGeography>,
  ): Promise<{ locationId: string; buildingId: string | null }> {
    const normalizedKey = hashValue({
      municipality: location.municipality,
      locality: location.locality,
      postalCode: location.postalCode,
      streetName: location.streetName,
      streetNumber: location.streetNumber,
      rawText: location.rawText,
    });
    const { data, error } = await this.db
      .from("locations")
      .upsert(
        {
          raw_text: location.rawText,
          municipality: location.municipality,
          locality: location.locality,
          postal_code: location.postalCode,
          street_name: location.streetName,
          street_number: location.streetNumber,
          latitude: location.latitude,
          longitude: location.longitude,
          scope_state: location.scope,
          resolution_method: location.resolutionMethod,
          resolution_confidence: location.resolutionConfidence,
          precision_level: location.precision,
          evidence_source: "private-radar:" + listing.source,
          normalized_key: normalizedKey,
          metadata: {
            reasons: location.reasons,
            legacyListingId: listing.id,
          },
        },
        { onConflict: "normalized_key" },
      )
      .select("id")
      .single();
    throwIfError(error);
    const locationId = (data as { id: string } | null)?.id;
    if (!locationId) {
      throw new Error("Private Radar location upsert returned no id.");
    }

    const address = canonicalBuildingAddress(location);
    if (!address) {
      return { locationId, buildingId: null };
    }
    const existing = await this.db
      .from("buildings")
      .select("id,attributes")
      .eq("normalized_key", address.normalizedKey)
      .maybeSingle();
    throwIfError(existing.error);
    if (existing.data) {
      const existingBuilding = existing.data as {
        id: string;
        attributes: Record<string, unknown>;
      };
      const { error: updateError } = await this.db
        .from("buildings")
        .update({
          location_id: locationId,
          display_name: address.displayName,
          attributes: {
            ...existingBuilding.attributes,
            municipality: address.municipality,
            locality: address.locality,
            streetName: address.streetName,
            streetNumber: address.streetNumber,
          },
          last_seen_at: listing.last_seen_at,
        })
        .eq("id", existingBuilding.id);
      throwIfError(updateError);
      return { locationId, buildingId: existingBuilding.id };
    }
    const building = await this.db
      .from("buildings")
      .insert({
        location_id: locationId,
        normalized_key: address.normalizedKey,
        display_name: address.displayName,
        attributes: {
          municipality: address.municipality,
          locality: address.locality,
          streetName: address.streetName,
          streetNumber: address.streetNumber,
        },
        first_seen_at: listing.first_seen_at,
        last_seen_at: listing.last_seen_at,
      })
      .select("id")
      .single();
    throwIfError(building.error);
    const buildingId = (building.data as { id: string } | null)?.id;
    if (!buildingId) {
      throw new Error("Private Radar building insert returned no id.");
    }
    return { locationId, buildingId };
  }

  private async createProperty(input: {
    listing: LegacyPrivateListing;
    location: ReturnType<typeof resolveMonitoredGeography>;
    locationId: string;
    buildingId: string | null;
    identityStatus: "PROVISIONAL" | "REVIEW";
  }): Promise<string> {
    const start = marketStart(input.listing);
    const { data, error } = await this.db
      .from("properties")
      .insert({
        building_id: input.buildingId,
        primary_location_id: input.locationId,
        property_type: propertyType(input.listing.title),
        identity_status: input.identityStatus,
        true_market_start_lower_bound: start.lowerBound,
        true_market_start_upper_bound: start.upperBound,
        true_market_start_method: start.method,
        true_market_start_confidence: start.confidence,
        first_public_evidence_at: start.upperBound,
        first_seen_at: input.listing.first_seen_at,
        last_seen_at: input.listing.last_seen_at,
        canonical_attributes: {
          address: identityAddress(input.location),
          locality: input.location.locality,
          surfaceSqm: input.listing.sqm,
          rooms: input.listing.rooms,
          propertyType: propertyType(input.listing.title),
        },
      })
      .select("id")
      .single();
    throwIfError(error);
    const propertyId = (data as { id: string } | null)?.id;
    if (!propertyId) {
      throw new Error("Private Radar property insert returned no id.");
    }
    return propertyId;
  }

  private async updateProperty(input: {
    propertyId: string;
    listing: LegacyPrivateListing;
    location: ReturnType<typeof resolveMonitoredGeography>;
    locationId: string;
    buildingId: string | null;
  }): Promise<void> {
    const { data, error } = await this.db
      .from("properties")
      .select(
        "building_id,primary_location_id,property_type,true_market_start_lower_bound,true_market_start_upper_bound,true_market_start_method,true_market_start_confidence,first_public_evidence_at,canonical_attributes",
      )
      .eq("id", input.propertyId)
      .single();
    throwIfError(error);
    const property = data as {
      building_id: string | null;
      primary_location_id: string | null;
      property_type: string | null;
      true_market_start_lower_bound: string | null;
      true_market_start_upper_bound: string | null;
      true_market_start_method: string | null;
      true_market_start_confidence: number | null;
      first_public_evidence_at: string | null;
      canonical_attributes: Record<string, unknown>;
    };
    const start = marketStart(input.listing);
    const merged = mergeTrueMarketStart(
      property.true_market_start_method
        ? {
            lowerBound: property.true_market_start_lower_bound,
            upperBound: property.true_market_start_upper_bound,
            method: property.true_market_start_method,
            confidence: property.true_market_start_confidence ?? 0,
          }
        : null,
      start,
    );
    let primaryLocationId = property.primary_location_id;
    let buildingId = property.building_id;
    if (!primaryLocationId) {
      primaryLocationId = input.locationId;
      buildingId = input.buildingId;
    } else {
      const { data: locations, error: locationError } = await this.db
        .from("locations")
        .select("id,precision_level,manually_verified")
        .in("id", [primaryLocationId, input.locationId]);
      throwIfError(locationError);
      const rows = (locations ?? []) as Array<{
        id: string;
        precision_level: string;
        manually_verified: boolean;
      }>;
      const current = rows.find((row) => row.id === primaryLocationId);
      const candidate = rows.find((row) => row.id === input.locationId);
      const rank: Record<string, number> = {
        UNKNOWN: 0,
        APPROXIMATE_AREA: 1,
        STREET_ONLY: 2,
        EXACT_COORDINATES: 3,
        EXACT_ADDRESS: 4,
      };
      if (
        !current?.manually_verified &&
        candidate &&
        (rank[candidate.precision_level] ?? 0) >
          (rank[current?.precision_level ?? "UNKNOWN"] ?? 0)
      ) {
        primaryLocationId = input.locationId;
        buildingId = input.buildingId;
      }
    }
    const firstEvidence = [
      property.first_public_evidence_at,
      start.lowerBound,
      start.upperBound,
    ]
      .filter((value): value is string => Boolean(value))
      .sort()[0];
    const { error: updateError } = await this.db
      .from("properties")
      .update({
        building_id: buildingId,
        primary_location_id: primaryLocationId,
        property_type: property.property_type ?? propertyType(input.listing.title),
        true_market_start_lower_bound: merged.lowerBound,
        true_market_start_upper_bound: merged.upperBound,
        true_market_start_method: merged.method,
        true_market_start_confidence: merged.confidence,
        first_public_evidence_at: firstEvidence,
        last_seen_at: input.listing.last_seen_at,
        canonical_attributes: {
          ...property.canonical_attributes,
          address:
            property.canonical_attributes.address ?? identityAddress(input.location),
          locality:
            property.canonical_attributes.locality ?? input.location.locality,
          surfaceSqm:
            property.canonical_attributes.surfaceSqm ?? input.listing.sqm,
          rooms: property.canonical_attributes.rooms ?? input.listing.rooms,
          propertyType:
            property.canonical_attributes.propertyType ??
            propertyType(input.listing.title),
        },
      })
      .eq("id", input.propertyId);
    throwIfError(updateError);
  }

  private async recordEvent(input: {
    propertyId: string;
      agencyListingId?: string | null;
    eventType: string;
    occurredAt: string;
    dedupeKey: string;
    confidence: number;
    payload: Record<string, unknown>;
  }): Promise<boolean> {
    const { error } = await this.db.from("events").insert({
      property_id: input.propertyId,
      agency_listing_id: input.agencyListingId ?? null,
      event_type: input.eventType,
      occurred_at: input.occurredAt,
      confidence: input.confidence,
      actor_type: "SYSTEM",
      dedupe_key: input.dedupeKey,
      payload: input.payload,
    });
    if (error?.code === "23505") {
      return false;
    }
    throwIfError(error);
    return true;
  }

  private async hasManualAgencyState(agencyListingId: string): Promise<boolean> {
    const { count, error } = await this.db
      .from("manual_overrides")
      .select("id", { count: "exact", head: true })
      .eq("target_type", "AGENCY_LISTING")
      .eq("target_id", agencyListingId)
      .eq("override_key", "state");
    throwIfError(error);
    return (count ?? 0) > 0;
  }

  private async recordMatchCandidates(
    privatePublicationId: string,
    decision: IdentityDecision,
    provisionalPropertyId: string,
    listing: LegacyPrivateListing,
  ): Promise<void> {
    if (decision.candidates.length > 0) {
      const { error } = await this.db
        .from("private_property_match_candidates")
        .upsert(
          decision.candidates.map((candidate) => ({
            private_publication_id: privatePublicationId,
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
          {
            onConflict:
              "private_publication_id,candidate_property_id,evaluation_version",
          },
        );
      throwIfError(error);
    }
    if (decision.outcome === "REVIEW_REQUIRED") {
      const { error } = await this.db.from("review_queue").upsert(
        {
          review_type: "IDENTITY",
          property_id: provisionalPropertyId,
          title: "Ambiguous Private Radar property identity",
          details: {
            privatePublicationId,
            legacyListingId: listing.id,
            source: listing.source,
            price: listing.price,
            surfaceSqm: listing.sqm,
            rooms: listing.rooms,
            candidates: decision.candidates.map((candidate) => ({
              propertyId: candidate.propertyId,
              score: candidate.score,
              features: candidate.features,
              contradictions: candidate.contradictions,
            })),
          },
          dedupe_key: "private-identity:" + privatePublicationId + ":v1",
        },
        { onConflict: "dedupe_key" },
      );
      throwIfError(error);
    }
  }

  private async recordGeographyReview(
    listing: LegacyPrivateListing,
    scope: GeographyScope,
    reasons: string[],
  ): Promise<void> {
    if (scope !== "REVIEW") {
      return;
    }
    const { error } = await this.db.from("review_queue").upsert(
      {
        review_type: "GEOGRAPHY",
        title: "Private Radar geography requires review",
        details: {
          legacyListingId: listing.id,
          source: listing.source,
          title: sanitizeText(listing.title, listing.seller_name),
          zone: listing.zone,
          reasons,
        },
        dedupe_key: "private-geography:" + listing.id,
      },
      { onConflict: "dedupe_key" },
    );
    throwIfError(error);
  }

  private async classifyActivePrivate(input: {
    privatePublicationId: string;
    propertyId: string;
    listing: LegacyPrivateListing;
    identityScore: number;
  }): Promise<"AGENCY_TO_PRIVATE" | "PRIVATE_RELIST" | "CONFLICT" | null> {
    const [{ data: propertyData, error: propertyError }, agencyResult] =
      await Promise.all([
        this.db
          .from("properties")
          .select("sale_status")
          .eq("id", input.propertyId)
          .single(),
        this.db
          .from("agency_listings")
          .select("id,state,last_seen_at")
          .eq("property_id", input.propertyId)
          .order("last_seen_at", { ascending: false }),
      ]);
    throwIfError(propertyError);
    throwIfError(agencyResult.error);
    const saleStatus = (propertyData as { sale_status: string }).sale_status;
    const agencyListings = (agencyResult.data ?? []) as Array<{
      id: string;
      state: string;
      last_seen_at: string;
    }>;
    const active = agencyListings.find((listing) => listing.state === "ACTIVE");
    const sold = agencyListings.find((listing) => listing.state === "CLOSED_SOLD");
    if (saleStatus === "SOLD_CONFIRMED" || sold) {
      const { error } = await this.db.from("review_queue").upsert(
        {
          review_type: "LIFECYCLE",
          property_id: input.propertyId,
          title: "Private relist conflicts with sold evidence",
          details: {
            privatePublicationId: input.privatePublicationId,
            legacyListingId: input.listing.id,
            saleStatus,
            soldAgencyListingId: sold?.id ?? null,
          },
          dedupe_key:
            "private-sold-conflict:" + input.privatePublicationId + ":v1",
        },
        { onConflict: "dedupe_key" },
      );
      throwIfError(error);
      const created = await this.recordEvent({
        propertyId: input.propertyId,
        eventType: "PRIVATE_RELIST_CONFLICT",
        occurredAt: input.listing.last_seen_at,
        dedupeKey:
          "private:" + input.privatePublicationId + ":PRIVATE_RELIST_CONFLICT",
        confidence: input.identityScore,
        payload: {
          privatePublicationId: input.privatePublicationId,
          legacyListingId: input.listing.id,
          saleStatus,
        },
      });
      return created ? "CONFLICT" : null;
    }
    if (active) {
      const created = await this.recordEvent({
        propertyId: input.propertyId,
        agencyListingId: active.id,
        eventType: "PRIVATE_RELIST",
        occurredAt: input.listing.last_seen_at,
        dedupeKey: "private:" + input.privatePublicationId + ":PRIVATE_RELIST",
        confidence: input.identityScore,
        payload: {
          privatePublicationId: input.privatePublicationId,
          legacyListingId: input.listing.id,
          simultaneousAgencyActivity: true,
        },
      });
      return created ? "PRIVATE_RELIST" : null;
    }
    const prior = agencyListings.find((listing) =>
      [
        "EXIT_PENDING",
        "OFF_MARKET_NO_SALE_EVIDENCE",
        "CLOSED_WITHDRAWN",
        "CLOSED_SWITCHED",
        "CLOSED_TO_PRIVATE",
      ].includes(listing.state),
    );
    if (!prior) {
      return null;
    }
    if (
      ["EXIT_PENDING", "OFF_MARKET_NO_SALE_EVIDENCE", "CLOSED_WITHDRAWN"].includes(
        prior.state,
      )
    ) {
      if (await this.hasManualAgencyState(prior.id)) {
        const { error } = await this.db.from("review_queue").upsert(
          {
            review_type: "LIFECYCLE",
            property_id: input.propertyId,
            title: "Private relist conflicts with manually confirmed agency state",
            details: {
              privatePublicationId: input.privatePublicationId,
              legacyListingId: input.listing.id,
              agencyListingId: prior.id,
              agencyState: prior.state,
            },
            dedupe_key:
              "private-manual-state-conflict:" +
              input.privatePublicationId +
              ":" +
              prior.id,
          },
          { onConflict: "dedupe_key" },
        );
        throwIfError(error);
        const created = await this.recordEvent({
          propertyId: input.propertyId,
          agencyListingId: prior.id,
          eventType: "PRIVATE_RELIST_CONFLICT",
          occurredAt: input.listing.last_seen_at,
          dedupeKey:
            "private:" +
            input.privatePublicationId +
            ":MANUAL_AGENCY_STATE_CONFLICT:" +
            prior.id,
          confidence: input.identityScore,
          payload: {
            privatePublicationId: input.privatePublicationId,
            legacyListingId: input.listing.id,
            agencyState: prior.state,
            manualStatePreserved: true,
          },
        });
        return created ? "CONFLICT" : null;
      }
      const { error } = await this.db
        .from("agency_listings")
        .update({
          state: "CLOSED_TO_PRIVATE",
          closed_at:
            input.listing.first_seen_at > prior.last_seen_at
              ? input.listing.first_seen_at
              : prior.last_seen_at,
          exit_confirmed_at: input.listing.last_seen_at,
          outcome_source: "PRIVATE_RADAR_IDENTITY_V1",
          outcome_confidence: input.identityScore,
          state_reason: {
            privatePublicationId: input.privatePublicationId,
            legacyListingId: input.listing.id,
          },
        })
        .eq("id", prior.id);
      throwIfError(error);
    }
    const created = await this.recordEvent({
      propertyId: input.propertyId,
      agencyListingId: prior.id,
      eventType: "AGENCY_TO_PRIVATE",
      occurredAt: input.listing.first_seen_at,
      dedupeKey: "private:" + input.privatePublicationId + ":AGENCY_TO_PRIVATE",
      confidence: input.identityScore,
      payload: {
        privatePublicationId: input.privatePublicationId,
        legacyListingId: input.listing.id,
        priorAgencyState: prior.state,
      },
    });
    return created ? "AGENCY_TO_PRIVATE" : null;
  }

  async sync(): Promise<PrivateRadarSyncResult> {
    const listings = await this.legacyListings();
    const availability = await this.latestAvailability(
      listings.map((listing) => listing.id),
    );
    const bootstrapState = await this.repository.loadBootstrapState();
    const candidates: PrivateCandidate[] = bootstrapState.properties.map(
      (candidate) => ({
        propertyId: candidate.propertyId,
        agencySlugs: [...candidate.agencySlugs],
        address: candidate.address,
        locality: candidate.locality,
        propertyType: candidate.propertyType,
        surfaceSqm: candidate.surfaceSqm,
        rooms: candidate.rooms,
        imageFingerprints: [...candidate.imageFingerprints],
        floorplanFingerprints: [...candidate.floorplanFingerprints],
      }),
    );
    const result: PrivateRadarSyncResult = {
      scannedListings: listings.length,
      inScopeListings: 0,
      excludedListings: 0,
      activePublications: 0,
      removedPublications: 0,
      createdPublications: 0,
      updatedPublications: 0,
      unchangedPublications: 0,
      newProperties: 0,
      autoMatches: 0,
      reviewRequired: 0,
      agencyToPrivateEvents: 0,
      simultaneousPrivateEvents: 0,
      removedEvents: 0,
      soldOrManualConflicts: 0,
      warnings: [],
    };

    for (const listing of listings) {
      const location = locationForListing(listing);
      if (location.scope !== "IN_SCOPE") {
        result.excludedListings += 1;
        await this.recordGeographyReview(listing, location.scope, location.reasons);
        continue;
      }
      result.inScopeListings += 1;
      const observedState = privateState(
        listing,
        availability.get(listing.id) ?? null,
      );
      const { locationId, buildingId } = await this.upsertLocation(
        listing,
        location,
      );
      const existingResult = await this.db
        .from("private_publications")
        .select("id,property_id,state,identity_score,content_hash,last_seen_at")
        .eq("legacy_listing_id", listing.id)
        .maybeSingle();
      throwIfError(existingResult.error);
      const existing = existingResult.data as {
        id: string;
        property_id: string;
        state: "ACTIVE" | "REMOVED";
        identity_score: number;
        content_hash: string;
        last_seen_at: string;
      } | null;
      const state = existing
        ? await this.repository.authoritativePrivatePublicationState(
            existing.id,
            observedState,
          )
        : observedState;
      if (state === "ACTIVE") {
        result.activePublications += 1;
      } else {
        result.removedPublications += 1;
      }
      const sanitizedTitle =
        sanitizeText(listing.title, listing.seller_name) ?? "Private listing";
      const sanitizedDescription = sanitizeText(
        listing.description,
        listing.seller_name,
      );
      const contentHash = hashValue({
        source: listing.source,
        sourceListingId: listing.source_listing_id,
        canonicalUrl: listing.canonical_url ?? listing.url,
        state,
        title: sanitizedTitle,
        description: sanitizedDescription,
        price: listing.price,
        sqm: listing.sqm,
        rooms: listing.rooms,
        floor: listing.floor,
        location,
        sellerClassificationConfidence:
          listing.seller_classification_confidence,
      });

      if (existing) {
        const changed =
          existing.content_hash !== contentHash ||
          existing.state !== state ||
          !sameInstant(existing.last_seen_at, listing.last_seen_at);
        if (changed) {
          const { error } = await this.db
            .from("private_publications")
            .update({
              location_id: locationId,
              source: listing.source,
              source_listing_id: listing.source_listing_id,
              canonical_url: listing.canonical_url ?? listing.url,
              state,
              title: sanitizedTitle,
              description: sanitizedDescription,
              price_amount: listing.price,
              surface_sqm: listing.sqm,
              rooms: listing.rooms,
              floor: listing.floor,
              last_seen_at: listing.last_seen_at,
              removed_at: state === "REMOVED" ? listing.last_seen_at : null,
              content_hash: contentHash,
              metadata: {
                sellerClassificationConfidence:
                  listing.seller_classification_confidence,
                contactDataExcluded: true,
                observedState,
                manualStateApplied: state !== observedState,
              },
            })
            .eq("id", existing.id);
          throwIfError(error);
          result.updatedPublications += 1;
          await this.updateProperty({
            propertyId: existing.property_id,
            listing,
            location,
            locationId,
            buildingId,
          });
        } else {
          result.unchangedPublications += 1;
        }
        if (existing.state === "ACTIVE" && state === "REMOVED") {
          if (
            await this.recordEvent({
              propertyId: existing.property_id,
              eventType: "PRIVATE_PUBLICATION_REMOVED",
              occurredAt: listing.last_seen_at,
              dedupeKey:
                "private:" +
                existing.id +
                ":REMOVED:" +
                listing.last_seen_at,
              confidence: 1,
              payload: {
                privatePublicationId: existing.id,
                legacyListingId: listing.id,
              },
            })
          ) {
            result.removedEvents += 1;
          }
        } else if (state === "ACTIVE") {
          if (existing.state === "REMOVED") {
            await this.recordEvent({
              propertyId: existing.property_id,
              eventType: "PRIVATE_PUBLICATION_REAPPEARED",
              occurredAt: listing.last_seen_at,
              dedupeKey:
                "private:" +
                existing.id +
                ":REAPPEARED:" +
                listing.last_seen_at,
              confidence: 1,
              payload: {
                privatePublicationId: existing.id,
                legacyListingId: listing.id,
              },
            });
          }
          const classification = await this.classifyActivePrivate({
            privatePublicationId: existing.id,
            propertyId: existing.property_id,
            listing,
            identityScore: existing.identity_score,
          });
          if (classification === "AGENCY_TO_PRIVATE") {
            result.agencyToPrivateEvents += 1;
          } else if (classification === "PRIVATE_RELIST") {
            result.simultaneousPrivateEvents += 1;
          } else if (classification === "CONFLICT") {
            result.soldOrManualConflicts += 1;
          }
        }
        await this.repository.refreshPropertyIntelligence(existing.property_id);
        continue;
      }

      const privateObservation = observation(listing, location);
      const decision = decidePropertyIdentity(
        privateObservation,
        candidates.map(asIdentityCandidate),
      );
      let propertyId = decision.propertyId;
      if (decision.outcome === "AUTO_MATCH" && propertyId) {
        result.autoMatches += 1;
      } else {
        propertyId = await this.createProperty({
          listing,
          location,
          locationId,
          buildingId,
          identityStatus:
            decision.outcome === "REVIEW_REQUIRED" ? "REVIEW" : "PROVISIONAL",
        });
        result.newProperties += 1;
        if (decision.outcome === "REVIEW_REQUIRED") {
          result.reviewRequired += 1;
        }
        candidates.push({
          propertyId,
          agencySlugs: [],
          address: privateObservation.address,
          locality: privateObservation.locality,
          propertyType: privateObservation.propertyType,
          surfaceSqm: privateObservation.surfaceSqm,
          rooms: privateObservation.rooms,
          imageFingerprints: [],
          floorplanFingerprints: [],
        });
      }
      await this.updateProperty({
        propertyId,
        listing,
        location,
        locationId,
        buildingId,
      });
      const start = marketStart(listing);
      const publication = await this.db
        .from("private_publications")
        .insert({
          legacy_listing_id: listing.id,
          property_id: propertyId,
          location_id: locationId,
          source: listing.source,
          source_listing_id: listing.source_listing_id,
          canonical_url: listing.canonical_url ?? listing.url,
          state,
          identity_outcome: decision.outcome,
          identity_score: decision.score,
          identity_margin: decision.margin,
          title: sanitizedTitle,
          description: sanitizedDescription,
          price_amount: listing.price,
          surface_sqm: listing.sqm,
          rooms: listing.rooms,
          floor: listing.floor,
          first_public_evidence_at: start.upperBound,
          first_seen_at: listing.first_seen_at,
          last_seen_at: listing.last_seen_at,
          removed_at: state === "REMOVED" ? listing.last_seen_at : null,
          content_hash: contentHash,
          metadata: {
            sellerClassificationConfidence:
              listing.seller_classification_confidence,
            contactDataExcluded: true,
            observedState,
            manualStateApplied: false,
          },
        })
        .select("id")
        .single();
      throwIfError(publication.error);
      const privatePublicationId = (
        publication.data as { id: string } | null
      )?.id;
      if (!privatePublicationId) {
        throw new Error("Private Radar publication insert returned no id.");
      }
      result.createdPublications += 1;
      await this.recordMatchCandidates(
        privatePublicationId,
        decision,
        propertyId,
        listing,
      );
      if (state === "ACTIVE") {
        const classification = await this.classifyActivePrivate({
          privatePublicationId,
          propertyId,
          listing,
          identityScore: decision.score,
        });
        if (classification === "AGENCY_TO_PRIVATE") {
          result.agencyToPrivateEvents += 1;
        } else if (classification === "PRIVATE_RELIST") {
          result.simultaneousPrivateEvents += 1;
        } else if (classification === "CONFLICT") {
          result.soldOrManualConflicts += 1;
        }
      }
      await this.repository.refreshPropertyIntelligence(propertyId);
    }

    return result;
  }
}
