import { createHash } from "node:crypto";

import {
  calculatePricePerSqm,
  calculatePriorityScore,
  calculateSellerFatigueScore,
  getMinimumDaysOnline,
  isPublishedToday,
} from "@/lib/listings/scoring";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { assignDuplicateGroup } from "@/lib/listings/duplicates";
import { normalizeListingCoordinates } from "@/lib/listings/coordinates";
import {
  buildPropertyIdentityKey,
  comparePropertyIdentity,
  type PropertyIdentityMatch,
} from "@/lib/listings/property-identity";
import {
  classifySeller,
  mergeSellerType,
} from "@/lib/listings/seller-classification";
import { getListingSourceStorageAliases } from "@/lib/listing-sources";
import { getPersistedScoringConfig } from "@/lib/settings/scoring-config-repository";
import type { Listing, NormalizedListing, UpsertListingsResult } from "@/types";

type ExistingListingRow = {
  id: string;
  price: number | null;
  title: string;
  source: string;
  source_listing_id: string | null;
  url: string;
  canonical_url: string | null;
  description: string | null;
  sqm: number | null;
  rooms: number | null;
  floor: string | null;
  zone: string | null;
  address_raw: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  coordinates_source: string | null;
  seller_type: "private" | "agency" | "unknown";
  seller_name: string | null;
  phone: string | null;
  portal_declared_date: string | null;
  metadata_date_published: string | null;
  metadata_date_modified: string | null;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  crm_status?: "untreated" | "treated";
  priority_score: number;
  seller_fatigue_score: number;
  duplicate_group_id: string | null;
  is_price_dropped: boolean;
  is_new_today: boolean;
  created_at: string | null;
  updated_at: string | null;
};

type ExistingListingMatch = {
  listing: ExistingListingRow;
  kind: "source" | "property";
  identity: PropertyIdentityMatch | null;
};

function hashDescription(value: string | null | undefined) {
  return createHash("sha1").update(value ?? "").digest("hex");
}

async function getListingById(id: string) {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("listings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as ExistingListingRow | null) ?? null;
}

async function findSourceListing(normalized: NormalizedListing) {
  const supabase = getSupabaseServiceClient();
  const sourceAliases = getListingSourceStorageAliases(normalized.source);

  if (normalized.sourceListingId) {
    const { data: sourceData } = await supabase
      .from("listing_sources")
      .select("listing_id")
      .in("source", sourceAliases)
      .eq("source_listing_id", normalized.sourceListingId)
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (sourceData?.listing_id) {
      const listing = await getListingById(sourceData.listing_id);
      if (listing) return listing;
    }

    const { data } = await supabase
      .from("listings")
      .select("*")
      .in("source", sourceAliases)
      .eq("source_listing_id", normalized.sourceListingId)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      return data as ExistingListingRow;
    }
  }

  const { data: sourceUrlData } = await supabase
    .from("listing_sources")
    .select("listing_id")
    .in("source", sourceAliases)
    .eq("url", normalized.url)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (sourceUrlData?.listing_id) {
    const listing = await getListingById(sourceUrlData.listing_id);
    if (listing) return listing;
  }

  const { data } = await supabase
    .from("listings")
    .select("*")
    .in("source", sourceAliases)
    .eq("url", normalized.url)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (data) {
    return data as ExistingListingRow;
  }

  if (normalized.canonicalUrl) {
    const { data: canonicalData } = await supabase
      .from("listings")
      .select("*")
      .in("source", sourceAliases)
      .eq("canonical_url", normalized.canonicalUrl)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (canonicalData) {
      return canonicalData as ExistingListingRow;
    }
  }

  return null;
}

function normalizedIdentityInput(normalized: NormalizedListing) {
  return {
    title: normalized.title,
    description: normalized.description,
    address_raw: normalized.addressRaw,
    zone: normalized.zone,
    price: normalized.price,
    sqm: normalized.sqm,
    rooms: normalized.rooms,
    floor: normalized.floor,
    latitude: normalized.latitude,
    longitude: normalized.longitude,
  };
}

async function findExistingListing(
  normalized: NormalizedListing,
): Promise<ExistingListingMatch | null> {
  const sourceListing = await findSourceListing(normalized);
  if (sourceListing) {
    return { listing: sourceListing, kind: "source", identity: null };
  }

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("listings")
    .select(
      "id,price,title,source,source_listing_id,url,canonical_url,description,sqm,rooms,floor,zone,address_raw,latitude,longitude,coordinates_source,seller_type,seller_name,phone,portal_declared_date,metadata_date_published,metadata_date_modified,first_seen_at,last_seen_at,status,crm_status,priority_score,seller_fatigue_score,duplicate_group_id,is_price_dropped,is_new_today,created_at,updated_at",
    )
    .neq("status", "archived")
    .limit(1000);

  const match = (data as ExistingListingRow[] | null)
    ?.map((candidate) => ({
      candidate,
      identity: comparePropertyIdentity(normalizedIdentityInput(normalized), candidate),
    }))
    .filter(({ identity }) => identity.autoMerge)
    .sort((left, right) => right.identity.score - left.identity.score)[0];

  return match
    ? { listing: match.candidate, kind: "property", identity: match.identity }
    : null;
}

function toListingPreview(
  row: ExistingListingRow,
  normalized: NormalizedListing,
  derived: {
    pricePerSqm: number | null;
    minimumDaysOnline: number;
    isNewToday: boolean;
    isPriceDropped: boolean;
    priorityScore: number;
    sellerFatigueScore: number;
  },
): Listing {
  return {
    id: row.id,
    source: normalized.source,
    sourceListingId: normalized.sourceListingId ?? null,
    url: normalized.url,
    canonicalUrl: normalized.canonicalUrl ?? normalized.url,
    title: normalized.title,
    description: normalized.description ?? null,
    price: normalized.price ?? null,
    sqm: normalized.sqm ?? null,
    pricePerSqm: derived.pricePerSqm,
    rooms: normalized.rooms ?? null,
    floor: normalized.floor ?? null,
    zone: normalized.zone ?? null,
    addressRaw: normalized.addressRaw ?? null,
    latitude: normalized.latitude ?? (row.latitude == null ? null : Number(row.latitude)),
    longitude: normalized.longitude ?? (row.longitude == null ? null : Number(row.longitude)),
    coordinatesSource: normalized.coordinatesSource ?? row.coordinates_source ?? null,
    sellerType: normalized.sellerType,
    sellerName: normalized.sellerName ?? null,
    phone: normalized.phone ?? null,
    imageUrls: normalized.imageUrls ?? [],
    portalDeclaredDate: normalized.portalDeclaredDate ?? row.portal_declared_date ?? null,
    metadataDatePublished:
      normalized.metadataDatePublished ?? row.metadata_date_published ?? null,
    metadataDateModified:
      normalized.metadataDateModified ?? row.metadata_date_modified ?? null,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: normalized.lastSeenAt ?? normalized.checkedAt ?? new Date().toISOString(),
    status: normalized.status ?? row.status,
    crmStatus: row.crm_status ?? "untreated",
    priorityScore: derived.priorityScore,
    sellerFatigueScore: derived.sellerFatigueScore,
    duplicateGroupId: row.duplicate_group_id,
    isPriceDropped: derived.isPriceDropped,
    isNewToday: derived.isNewToday,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    minimumDaysOnline: derived.minimumDaysOnline,
    note: normalized.note ?? null,
    suspectedRepublished: normalized.isRepublishedSuspected ?? false,
  };
}

export async function upsertListings(
  listings: NormalizedListing[],
): Promise<UpsertListingsResult> {
  const supabase = getSupabaseServiceClient();
  const now = new Date().toISOString();
  const scoringConfig = await getPersistedScoringConfig();

  let inserted = 0;
  let updated = 0;
  let snapshots = 0;
  const persistedListings: Listing[] = [];

  for (const normalized of listings) {
    const existingMatch = await findExistingListing(normalized);
    const existing = existingMatch?.listing ?? null;
    const sellerClassification = classifySeller({
      source: normalized.source,
      declaredType: normalized.sellerType,
      sellerName: normalized.sellerName,
      title: normalized.title,
      description: normalized.description,
    });
    const sellerType = mergeSellerType(
      existing?.seller_type,
      sellerClassification.sellerType,
    );
    const firstSeenAt = existing?.first_seen_at ?? normalized.firstSeenAt ?? now;
    const lastSeenAt = normalized.lastSeenAt ?? normalized.checkedAt ?? now;
    const portalDeclaredDate =
      normalized.portalDeclaredDate ?? existing?.portal_declared_date ?? null;
    const metadataDatePublished =
      normalized.metadataDatePublished ?? existing?.metadata_date_published ?? null;
    const metadataDateModified =
      normalized.metadataDateModified ?? existing?.metadata_date_modified ?? null;
    const extractedCoordinates = normalizeListingCoordinates({
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      source: normalized.coordinatesSource ?? `${normalized.source}:scrape`,
    });
    const persistedLatitude =
      extractedCoordinates?.latitude ??
      (existing?.latitude == null ? null : Number(existing.latitude));
    const persistedLongitude =
      extractedCoordinates?.longitude ??
      (existing?.longitude == null ? null : Number(existing.longitude));
    const persistedCoordinatesSource =
      extractedCoordinates?.source ?? existing?.coordinates_source ?? null;
    const persistedDescription = normalized.description ?? existing?.description ?? null;
    const persistedPrice = normalized.price ?? existing?.price ?? null;
    const persistedSqm = normalized.sqm ?? existing?.sqm ?? null;
    const persistedRooms = normalized.rooms ?? existing?.rooms ?? null;
    const persistedFloor = normalized.floor ?? existing?.floor ?? null;
    const persistedZone = normalized.zone ?? existing?.zone ?? null;
    const persistedAddress = normalized.addressRaw ?? existing?.address_raw ?? null;
    const persistedSellerName = normalized.sellerName ?? existing?.seller_name ?? null;
    const persistedPhone = normalized.phone ?? existing?.phone ?? null;
    const pricePerSqm = calculatePricePerSqm(persistedPrice, persistedSqm);
    const minimumDaysOnline = getMinimumDaysOnline({
      firstSeenAt,
      portalDeclaredDate,
      metadataDatePublished,
    });
    const isPriceDropped =
      (existing?.price != null &&
        persistedPrice != null &&
        persistedPrice < existing.price) ||
      (normalized.previousPrice != null &&
        persistedPrice != null &&
        persistedPrice < normalized.previousPrice);
    const isNewToday = isPublishedToday({
      firstSeenAt,
      portalDeclaredDate,
      metadataDatePublished,
    });
    const priorityScore = calculatePriorityScore(
      {
        sellerType,
        isNewToday,
        hasPhone: Boolean(persistedPhone),
        minimumDaysOnline,
        isPriceDropped,
        description: persistedDescription,
        price: persistedPrice,
        sqm: persistedSqm,
      },
      scoringConfig,
    );
    const sellerFatigueScore = calculateSellerFatigueScore({
      minimumDaysOnline,
      isPriceDropped,
      description: persistedDescription,
      isRepublishedSuspected: normalized.isRepublishedSuspected,
    });

    const identityKey = buildPropertyIdentityKey({
      title: normalized.title,
      description: persistedDescription,
      address_raw: persistedAddress,
      zone: persistedZone,
      price: persistedPrice,
      sqm: persistedSqm,
      rooms: persistedRooms,
      floor: persistedFloor,
      latitude: persistedLatitude,
      longitude: persistedLongitude,
    });

    const payload = {
      id: normalized.id ?? existing?.id,
      source: normalized.source,
      source_listing_id: normalized.sourceListingId ?? null,
      url: normalized.url,
      canonical_url: normalized.canonicalUrl ?? normalized.url,
      title: normalized.title,
      description: persistedDescription,
      price: persistedPrice,
      sqm: persistedSqm,
      price_per_sqm: pricePerSqm,
      rooms: persistedRooms,
      floor: persistedFloor,
      zone: persistedZone,
      address_raw: persistedAddress,
      latitude: persistedLatitude,
      longitude: persistedLongitude,
      coordinates_source: persistedCoordinatesSource,
      seller_type: sellerType,
      seller_name: persistedSellerName,
      phone: persistedPhone,
      seller_classification_confidence: sellerClassification.confidence,
      seller_classification_reasons: sellerClassification.reasons,
      property_identity_key: identityKey,
      identity_confidence: existingMatch?.identity?.score ?? null,
      identity_reasons:
        existingMatch?.identity?.reasons ??
        (existingMatch?.kind === "source" ? ["same-source-listing"] : []),
      portal_declared_date: portalDeclaredDate,
      metadata_date_published: metadataDatePublished,
      metadata_date_modified: metadataDateModified,
      first_seen_at: firstSeenAt,
      last_seen_at: lastSeenAt,
      status: normalized.status ?? existing?.status ?? "new",
      priority_score: priorityScore,
      seller_fatigue_score: sellerFatigueScore,
      duplicate_group_id: null,
      is_price_dropped: isPriceDropped,
      is_new_today: isNewToday,
      updated_at: now,
    };

    const persistListing = async (value: Record<string, unknown>) =>
      existing
        ? supabase
            .from("listings")
            .update(value)
            .eq("id", existing.id)
            .select("*")
            .single()
        : supabase.from("listings").insert(value).select("*").single();
    let { data: savedRow, error: listingError } = await persistListing(payload);

    // Deployments can receive scraper traffic while a migration is still being
    // applied. The identity match itself remains active and we retry without
    // diagnostic columns instead of losing the scrape run.
    if (listingError?.code === "PGRST204") {
      const legacyPayload = { ...payload } as Record<string, unknown>;
      delete legacyPayload.seller_classification_confidence;
      delete legacyPayload.seller_classification_reasons;
      delete legacyPayload.property_identity_key;
      delete legacyPayload.identity_confidence;
      delete legacyPayload.identity_reasons;
      const retry = await persistListing(legacyPayload);
      savedRow = retry.data;
      listingError = retry.error;
    }

    if (listingError || !savedRow) {
      throw new Error(`Unable to persist listing ${normalized.title}.`);
    }

    if (existing) {
      updated += 1;
    } else {
      inserted += 1;
    }

    const listingId = (savedRow as ExistingListingRow).id;
    if (!existingMatch?.identity?.autoMerge) {
      await assignDuplicateGroup({
        id: listingId,
        title: normalized.title,
        description: persistedDescription,
        address_raw: persistedAddress,
        zone: persistedZone,
        price: persistedPrice,
        sqm: persistedSqm,
        rooms: persistedRooms,
        floor: persistedFloor,
        latitude: persistedLatitude,
        longitude: persistedLongitude,
        duplicate_group_id: null,
      });
    }

    const snapshotPayload = {
      listing_id: listingId,
      checked_at: normalized.checkedAt ?? lastSeenAt,
      source: normalized.source,
      url: normalized.url,
      price: persistedPrice,
      title: normalized.title,
      description_hash: hashDescription(persistedDescription),
      is_available: normalized.isAvailable ?? true,
      latitude: extractedCoordinates?.latitude ?? null,
      longitude: extractedCoordinates?.longitude ?? null,
      coordinates_source: extractedCoordinates?.source ?? null,
      raw_payload: {
        ...(normalized.rawPayload ?? {}),
        imageUrls: normalized.imageUrls ?? [],
      },
    };

    const { error: snapshotError } = await supabase
      .from("listing_snapshots")
      .insert(snapshotPayload);

    if (snapshotError) {
      throw new Error(`Unable to persist snapshot for ${normalized.title}.`);
    }

    snapshots += 1;

    const sourceAliases = getListingSourceStorageAliases(normalized.source);
    let existingSource: { id: string } | null = null;
    if (normalized.sourceListingId) {
      const result = await supabase
        .from("listing_sources")
        .select("id")
        .eq("listing_id", listingId)
        .in("source", sourceAliases)
        .eq("source_listing_id", normalized.sourceListingId)
        .limit(1)
        .maybeSingle();
      existingSource = result.data;
    }
    if (!existingSource) {
      const result = await supabase
        .from("listing_sources")
        .select("id")
        .eq("listing_id", listingId)
        .in("source", sourceAliases)
        .eq("url", normalized.url)
        .limit(1)
        .maybeSingle();
      existingSource = result.data;
    }

    if (existingSource?.id) {
      const sourcePayload = {
        source: normalized.source,
        url: normalized.url,
        source_listing_id: normalized.sourceListingId ?? null,
        canonical_url: normalized.canonicalUrl ?? normalized.url,
        title: normalized.title,
        description: normalized.description ?? null,
        price: normalized.price ?? null,
        sqm: normalized.sqm ?? null,
        rooms: normalized.rooms ?? null,
        floor: normalized.floor ?? null,
        zone: normalized.zone ?? null,
        address_raw: normalized.addressRaw ?? null,
        seller_type: sellerClassification.sellerType,
        seller_name: normalized.sellerName ?? null,
        phone: normalized.phone ?? null,
        image_urls: normalized.imageUrls ?? [],
        last_seen_at: lastSeenAt,
      };
      const sourceUpdate = await supabase
        .from("listing_sources")
        .update(sourcePayload)
        .eq("id", existingSource.id);
      if (sourceUpdate.error?.code === "PGRST204") {
        await supabase
          .from("listing_sources")
          .update({
          source: normalized.source,
          url: normalized.url,
          source_listing_id: normalized.sourceListingId ?? null,
          seller_name: normalized.sellerName ?? null,
          last_seen_at: lastSeenAt,
          })
          .eq("id", existingSource.id);
      }
    } else {
      const sourcePayload = {
        listing_id: listingId,
        source: normalized.source,
        url: normalized.url,
        canonical_url: normalized.canonicalUrl ?? normalized.url,
        source_listing_id: normalized.sourceListingId ?? null,
        title: normalized.title,
        description: normalized.description ?? null,
        price: normalized.price ?? null,
        sqm: normalized.sqm ?? null,
        rooms: normalized.rooms ?? null,
        floor: normalized.floor ?? null,
        zone: normalized.zone ?? null,
        address_raw: normalized.addressRaw ?? null,
        seller_type: sellerClassification.sellerType,
        seller_name: normalized.sellerName ?? null,
        phone: normalized.phone ?? null,
        image_urls: normalized.imageUrls ?? [],
        first_seen_at: normalized.firstSeenAt ?? lastSeenAt,
        last_seen_at: lastSeenAt,
      };
      const sourceInsert = await supabase
        .from("listing_sources")
        .insert(sourcePayload);
      if (sourceInsert.error?.code === "PGRST204") {
        await supabase.from("listing_sources").insert({
          listing_id: listingId,
          source: normalized.source,
          url: normalized.url,
          source_listing_id: normalized.sourceListingId ?? null,
          seller_name: normalized.sellerName ?? null,
          first_seen_at: normalized.firstSeenAt ?? lastSeenAt,
          last_seen_at: lastSeenAt,
        });
      }
    }

    const previewNormalized = {
      ...normalized,
      description: persistedDescription,
      price: persistedPrice,
      sqm: persistedSqm,
      rooms: persistedRooms,
      floor: persistedFloor,
      zone: persistedZone,
      addressRaw: persistedAddress,
      sellerType,
      sellerName: persistedSellerName,
      phone: persistedPhone,
    };
    persistedListings.push(
      toListingPreview(savedRow as ExistingListingRow, previewNormalized, {
        pricePerSqm,
        minimumDaysOnline,
        isNewToday,
        isPriceDropped,
        priorityScore,
        sellerFatigueScore,
      }),
    );
  }

  return {
    inserted,
    updated,
    snapshots,
    listings: persistedListings,
  };
}
