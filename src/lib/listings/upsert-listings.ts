import { createHash } from "node:crypto";

import {
  calculatePricePerSqm,
  calculatePriorityScore,
  calculateSellerFatigueScore,
  getMinimumDaysOnline,
  isToday,
} from "@/lib/listings/scoring";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
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
  seller_type: "private" | "agency" | "unknown";
  seller_name: string | null;
  phone: string | null;
  portal_declared_date: string | null;
  metadata_date_published: string | null;
  metadata_date_modified: string | null;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  priority_score: number;
  seller_fatigue_score: number;
  duplicate_group_id: string | null;
  is_price_dropped: boolean;
  is_new_today: boolean;
  created_at: string | null;
  updated_at: string | null;
};

function hashDescription(value: string | null | undefined) {
  return createHash("sha1").update(value ?? "").digest("hex");
}

async function findExistingListing(normalized: NormalizedListing) {
  const supabase = getSupabaseServiceClient();

  if (normalized.sourceListingId) {
    const { data } = await supabase
      .from("listings")
      .select("*")
      .eq("source", normalized.source)
      .eq("source_listing_id", normalized.sourceListingId)
      .maybeSingle();

    if (data) {
      return data as ExistingListingRow;
    }
  }

  const { data } = await supabase
    .from("listings")
    .select("*")
    .eq("source", normalized.source)
    .eq("url", normalized.url)
    .maybeSingle();

  return (data as ExistingListingRow | null) ?? null;
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
    sellerType: normalized.sellerType,
    sellerName: normalized.sellerName ?? null,
    phone: normalized.phone ?? null,
    portalDeclaredDate: normalized.portalDeclaredDate ?? null,
    metadataDatePublished: normalized.metadataDatePublished ?? null,
    metadataDateModified: normalized.metadataDateModified ?? null,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: normalized.lastSeenAt ?? normalized.checkedAt ?? new Date().toISOString(),
    status: normalized.status ?? row.status,
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

  let inserted = 0;
  let updated = 0;
  let snapshots = 0;
  const persistedListings: Listing[] = [];

  for (const normalized of listings) {
    const existing = await findExistingListing(normalized);
    const firstSeenAt = existing?.first_seen_at ?? normalized.firstSeenAt ?? now;
    const lastSeenAt = normalized.lastSeenAt ?? normalized.checkedAt ?? now;
    const pricePerSqm = calculatePricePerSqm(normalized.price ?? null, normalized.sqm ?? null);
    const minimumDaysOnline = getMinimumDaysOnline({
      firstSeenAt,
      portalDeclaredDate:
        normalized.portalDeclaredDate ?? existing?.portal_declared_date ?? null,
      metadataDatePublished:
        normalized.metadataDatePublished ?? existing?.metadata_date_published ?? null,
    });
    const isPriceDropped =
      (existing?.price != null &&
        normalized.price != null &&
        normalized.price < existing.price) ||
      (normalized.previousPrice != null &&
        normalized.price != null &&
        normalized.price < normalized.previousPrice);
    const isNewToday = isToday(firstSeenAt);
    const priorityScore = calculatePriorityScore({
      sellerType: normalized.sellerType,
      isNewToday,
      hasPhone: Boolean(normalized.phone),
      minimumDaysOnline,
      isPriceDropped,
      description: normalized.description,
    });
    const sellerFatigueScore = calculateSellerFatigueScore({
      minimumDaysOnline,
      isPriceDropped,
      description: normalized.description,
      isRepublishedSuspected: normalized.isRepublishedSuspected,
    });

    const payload = {
      id: normalized.id ?? existing?.id,
      source: normalized.source,
      source_listing_id: normalized.sourceListingId ?? null,
      url: normalized.url,
      canonical_url: normalized.canonicalUrl ?? normalized.url,
      title: normalized.title,
      description: normalized.description ?? null,
      price: normalized.price ?? null,
      sqm: normalized.sqm ?? null,
      price_per_sqm: pricePerSqm,
      rooms: normalized.rooms ?? null,
      floor: normalized.floor ?? null,
      zone: normalized.zone ?? null,
      address_raw: normalized.addressRaw ?? null,
      seller_type: normalized.sellerType,
      seller_name: normalized.sellerName ?? null,
      phone: normalized.phone ?? null,
      portal_declared_date: normalized.portalDeclaredDate ?? null,
      metadata_date_published: normalized.metadataDatePublished ?? null,
      metadata_date_modified: normalized.metadataDateModified ?? null,
      first_seen_at: firstSeenAt,
      last_seen_at: lastSeenAt,
      status: normalized.status ?? existing?.status ?? "new",
      priority_score: priorityScore,
      seller_fatigue_score: sellerFatigueScore,
      duplicate_group_id: existing?.duplicate_group_id ?? null,
      is_price_dropped: isPriceDropped,
      is_new_today: isNewToday,
      updated_at: now,
    };

    const { data: savedRow, error: listingError } = existing
      ? await supabase
          .from("listings")
          .update(payload)
          .eq("id", existing.id)
          .select("*")
          .single()
      : await supabase.from("listings").insert(payload).select("*").single();

    if (listingError || !savedRow) {
      throw new Error(`Unable to persist listing ${normalized.title}.`);
    }

    if (existing) {
      updated += 1;
    } else {
      inserted += 1;
    }

    const listingId = (savedRow as ExistingListingRow).id;

    const snapshotPayload = {
      listing_id: listingId,
      checked_at: normalized.checkedAt ?? lastSeenAt,
      source: normalized.source,
      url: normalized.url,
      price: normalized.price ?? null,
      title: normalized.title,
      description_hash: hashDescription(normalized.description),
      is_available: normalized.isAvailable ?? true,
      raw_payload: normalized.rawPayload ?? null,
    };

    const { error: snapshotError } = await supabase
      .from("listing_snapshots")
      .insert(snapshotPayload);

    if (snapshotError) {
      throw new Error(`Unable to persist snapshot for ${normalized.title}.`);
    }

    snapshots += 1;

    const { data: existingSource } = await supabase
      .from("listing_sources")
      .select("id")
      .eq("listing_id", listingId)
      .eq("source", normalized.source)
      .eq("url", normalized.url)
      .maybeSingle();

    if (existingSource?.id) {
      await supabase
        .from("listing_sources")
        .update({
          source_listing_id: normalized.sourceListingId ?? null,
          seller_name: normalized.sellerName ?? null,
          last_seen_at: lastSeenAt,
        })
        .eq("id", existingSource.id);
    } else {
      await supabase.from("listing_sources").insert({
        listing_id: listingId,
        source: normalized.source,
        url: normalized.url,
        source_listing_id: normalized.sourceListingId ?? null,
        seller_name: normalized.sellerName ?? null,
        first_seen_at: firstSeenAt,
        last_seen_at: lastSeenAt,
      });
    }

    persistedListings.push(
      toListingPreview(savedRow as ExistingListingRow, normalized, {
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
