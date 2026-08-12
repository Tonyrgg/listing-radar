import {
  calculatePriorityScore,
  getHighPriorityThreshold,
  getMinimumDaysOnline,
  getHighPriorityThresholdFromConfig,
  isHotOldListingWithConfig,
  isPublishedToday,
} from "@/lib/listings/scoring";
import { getListingCompletenessScore } from "@/lib/listings/completeness";
import {
  getMockDashboardSummary,
  getMockListingById,
  getMockListings,
  getMockReports,
} from "@/lib/data/mock-store";
import { normalizeListingSource } from "@/lib/listing-sources";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getPersistedScoringConfig } from "@/lib/settings/scoring-config-repository";
import type { ScoringConfig } from "@/lib/listings/scoring-config";
import type {
  DashboardSummary,
  Listing,
  ListingFilters,
  ListingSnapshot,
  ListingSource,
  Report,
  ScrapeError,
  ScrapeRun,
  SellerType,
} from "@/types";

type ListingRow = {
  id: string;
  source: string;
  source_listing_id: string | null;
  url: string;
  canonical_url: string | null;
  title: string;
  description: string | null;
  price: number | null;
  sqm: number | null;
  price_per_sqm: number | null;
  rooms: number | null;
  floor: string | null;
  zone: string | null;
  address_raw: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  coordinates_source: string | null;
  seller_type: SellerType;
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
  listing_snapshots?: ListingSnapshotRow[];
  listing_notes?: { note: string; created_at: string | null }[];
  listing_sources?: ListingSourceRow[];
};

type ListingSnapshotRow = {
  id: string;
  listing_id: string;
  checked_at: string;
  source: string;
  url: string;
  price: number | null;
  title: string | null;
  description_hash: string | null;
  is_available: boolean;
  latitude: number | string | null;
  longitude: number | string | null;
  coordinates_source: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string | null;
};

type ListingSourceRow = {
  id: string;
  listing_id: string;
  source: string;
  url: string;
  source_listing_id: string | null;
  canonical_url?: string | null;
  title?: string | null;
  price?: number | null;
  sqm?: number | null;
  rooms?: number | null;
  seller_type?: SellerType | null;
  seller_name: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  created_at: string | null;
};

type ReportRow = {
  id: string;
  report_date: string;
  total_found: number;
  new_count: number;
  private_count: number;
  agency_count: number;
  unknown_count: number;
  price_drops_count: number;
  hot_old_count: number;
  content: string | null;
  created_at: string | null;
};

type ScrapeRunRow = {
  id: string;
  started_at: string | null;
  finished_at: string | null;
  status: string;
  total_found: number;
  total_inserted: number;
  total_updated: number;
  error_count: number;
  created_at: string | null;
};

type ScrapeErrorRow = {
  id: string;
  scrape_run_id: string;
  source: string | null;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string | null;
};

function hasSupabaseReadConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function mapSnapshotRow(row: ListingSnapshotRow): ListingSnapshot {
  return {
    id: row.id,
    listingId: row.listing_id,
    checkedAt: row.checked_at,
    source: row.source,
    url: row.url,
    price: row.price,
    title: row.title,
    descriptionHash: row.description_hash,
    isAvailable: row.is_available,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    coordinatesSource: row.coordinates_source,
    rawPayload: row.raw_payload,
    createdAt: row.created_at,
  };
}

function mapSourceRow(row: ListingSourceRow): ListingSource {
  return {
    id: row.id,
    listingId: row.listing_id,
    source: row.source,
    url: row.url,
    sourceListingId: row.source_listing_id,
    canonicalUrl: row.canonical_url ?? null,
    title: row.title ?? null,
    price: row.price ?? null,
    sqm: row.sqm ?? null,
    rooms: row.rooms ?? null,
    sellerType: row.seller_type ?? null,
    sellerName: row.seller_name,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

function normalizeImageUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function extractImageUrlsFromPayload(
  value: unknown,
  depth = 0,
): string[] {
  if (depth > 5 || !value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const urls: string[] = [];
  const add = (candidate: unknown) => {
    const values = Array.isArray(candidate) ? candidate : [candidate];

    for (const item of values) {
      const url = normalizeImageUrl(item);

      if (url && !urls.includes(url)) {
        urls.push(url);
      }
    }
  };

  [
    "imageUrls",
    "image_urls",
    "images",
    "photos",
    "foto",
    "imageUrl",
    "image_url",
    "image",
  ].forEach((key) => add(record[key]));

  ["row", "rawPayload", "raw_payload", "pageMetadata", "meta"].forEach(
    (key) => {
      for (const url of extractImageUrlsFromPayload(record[key], depth + 1)) {
        if (!urls.includes(url)) {
          urls.push(url);
        }
      }
    },
  );

  return urls;
}

function mapListingRow(row: ListingRow, scoringConfig?: ScoringConfig): Listing {
  const snapshots = (row.listing_snapshots ?? [])
    .map(mapSnapshotRow)
    .sort((left, right) => right.checkedAt.localeCompare(left.checkedAt));
  const imageUrls = snapshots
    .flatMap((snapshot) => extractImageUrlsFromPayload(snapshot.rawPayload))
    .filter((url, index, values) => values.indexOf(url) === index)
    .slice(0, 30);
  const minimumDaysOnline = getMinimumDaysOnline({
    firstSeenAt: row.first_seen_at,
    portalDeclaredDate: row.portal_declared_date,
    metadataDatePublished: row.metadata_date_published,
  });
  const isNewToday = isPublishedToday({
    firstSeenAt: row.first_seen_at,
    portalDeclaredDate: row.portal_declared_date,
    metadataDatePublished: row.metadata_date_published,
  });
  const priorityScore = calculatePriorityScore(
    {
      sellerType: row.seller_type,
      isNewToday,
      hasPhone: Boolean(row.phone),
      minimumDaysOnline,
      isPriceDropped: row.is_price_dropped,
      description: row.description,
      price: row.price,
      sqm: row.sqm,
    },
    scoringConfig,
  );

  return {
    id: row.id,
    source: row.source,
    sourceListingId: row.source_listing_id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    description: row.description,
    price: row.price,
    sqm: row.sqm,
    pricePerSqm: row.price_per_sqm,
    rooms: row.rooms,
    floor: row.floor,
    zone: row.zone,
    addressRaw: row.address_raw,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    coordinatesSource: row.coordinates_source,
    sellerType: row.seller_type,
    sellerName: row.seller_name,
    phone: row.phone,
    imageUrls,
    portalDeclaredDate: row.portal_declared_date,
    metadataDatePublished: row.metadata_date_published,
    metadataDateModified: row.metadata_date_modified,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    status: row.status,
    crmStatus: row.crm_status ?? "untreated",
    priorityScore,
    sellerFatigueScore: row.seller_fatigue_score,
    duplicateGroupId: row.duplicate_group_id,
    isPriceDropped: row.is_price_dropped,
    isNewToday,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    minimumDaysOnline,
    note:
      [...(row.listing_notes ?? [])]
        .sort((left, right) =>
          (right.created_at ?? "").localeCompare(left.created_at ?? ""),
        )[0]?.note ?? null,
    snapshots,
    sources: (row.listing_sources ?? []).map(mapSourceRow),
  };
}

function mapReportRow(row: ReportRow): Report {
  return {
    id: row.id,
    reportDate: row.report_date,
    totalFound: row.total_found,
    newCount: row.new_count,
    privateCount: row.private_count,
    agencyCount: row.agency_count,
    unknownCount: row.unknown_count,
    priceDropsCount: row.price_drops_count,
    hotOldCount: row.hot_old_count,
    content: row.content,
    createdAt: row.created_at,
  };
}

function mapScrapeRunRow(row: ScrapeRunRow): ScrapeRun {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    totalFound: row.total_found,
    totalInserted: row.total_inserted,
    totalUpdated: row.total_updated,
    errorCount: row.error_count,
    createdAt: row.created_at,
  };
}

function mapScrapeErrorRow(row: ScrapeErrorRow): ScrapeError {
  return {
    id: row.id,
    scrapeRunId: row.scrape_run_id,
    source: row.source,
    message: row.message,
    details: row.details,
    createdAt: row.created_at,
  };
}

function applyListingFilters(
  listings: Listing[],
  filters: ListingFilters,
  scoringConfig?: ScoringConfig,
) {
  const highPriorityThreshold = scoringConfig
    ? getHighPriorityThresholdFromConfig(scoringConfig)
    : getHighPriorityThreshold();
  const filterSource =
    filters.source === "all" ? "all" : normalizeListingSource(filters.source);
  const filtered = listings.filter((listing) => {
    if (filters.sellerType !== "all" && listing.sellerType !== filters.sellerType) {
      return false;
    }

    if (filters.status === "all" && listing.status === "archived") {
      return false;
    }

    if (filters.status !== "all" && listing.status !== filters.status) {
      return false;
    }

    if (filters.crmStatus !== "all" && listing.crmStatus !== filters.crmStatus) {
      return false;
    }

    if (
      filterSource !== "all" &&
      normalizeListingSource(listing.source) !== filterSource
    ) {
      return false;
    }

    if (
      typeof filters.minDaysOnline === "number" &&
      listing.minimumDaysOnline < filters.minDaysOnline
    ) {
      return false;
    }

    if (filters.onlyHighPriority && listing.priorityScore < highPriorityThreshold) {
      return false;
    }

    if (filters.minScore != null && listing.priorityScore < filters.minScore) {
      return false;
    }

    if (filters.maxScore != null && listing.priorityScore > filters.maxScore) {
      return false;
    }

    return true;
  });

  function byLastSeenDesc(left: Listing, right: Listing) {
    return (
      right.lastSeenAt.localeCompare(left.lastSeenAt) ||
      right.firstSeenAt.localeCompare(left.firstSeenAt)
    );
  }

  function byPriorityDesc(left: Listing, right: Listing) {
    return right.priorityScore - left.priorityScore || byLastSeenDesc(left, right);
  }

  function byPriceAsc(left: Listing, right: Listing) {
    return (
      (left.price ?? Number.MAX_SAFE_INTEGER) -
        (right.price ?? Number.MAX_SAFE_INTEGER) ||
      byPriorityDesc(left, right)
    );
  }

  function byPriceDesc(left: Listing, right: Listing) {
    return (right.price ?? -1) - (left.price ?? -1) || byPriorityDesc(left, right);
  }

  function byPricePerSqmAsc(left: Listing, right: Listing) {
    return (
      (left.pricePerSqm ?? Number.MAX_SAFE_INTEGER) -
        (right.pricePerSqm ?? Number.MAX_SAFE_INTEGER) ||
      byPriceAsc(left, right)
    );
  }

  function byPricePerSqmDesc(left: Listing, right: Listing) {
    return (
      (right.pricePerSqm ?? -1) - (left.pricePerSqm ?? -1) ||
      byPriceDesc(left, right)
    );
  }

  return filtered.sort((left, right) => {
    switch (filters.sortBy) {
      case "score_asc":
        return left.priorityScore - right.priorityScore || byLastSeenDesc(left, right);
      case "newest":
        return byLastSeenDesc(left, right);
      case "checked_oldest":
        return (
          left.lastSeenAt.localeCompare(right.lastSeenAt) ||
          right.priorityScore - left.priorityScore
        );
      case "first_seen_desc":
        return (
          right.firstSeenAt.localeCompare(left.firstSeenAt) ||
          byLastSeenDesc(left, right)
        );
      case "oldest":
        return (
          right.minimumDaysOnline - left.minimumDaysOnline ||
          left.firstSeenAt.localeCompare(right.firstSeenAt)
        );
      case "price_asc":
        return byPriceAsc(left, right);
      case "price_desc":
        return byPriceDesc(left, right);
      case "price_per_sqm_asc":
        return byPricePerSqmAsc(left, right);
      case "price_per_sqm_desc":
        return byPricePerSqmDesc(left, right);
      case "private_first":
        return (
          Number(right.sellerType === "private") -
            Number(left.sellerType === "private") ||
          byPriorityDesc(left, right)
        );
      case "price_drop_first":
        return (
          Number(right.isPriceDropped) - Number(left.isPriceDropped) ||
          byPriorityDesc(left, right)
        );
      case "phone_first":
        return (
          Number(Boolean(right.phone)) - Number(Boolean(left.phone)) ||
          byPriorityDesc(left, right)
        );
      case "incomplete_first":
        return (
          getListingCompletenessScore(left) - getListingCompletenessScore(right) ||
          byPriorityDesc(left, right)
        );
      default:
        return byPriorityDesc(left, right);
    }
  });
}

async function loadListingsFromSupabase() {
  if (!hasSupabaseReadConfig()) {
    return null;
  }

  try {
    const supabase = getSupabaseServiceClient();
    const scoringConfig = await getPersistedScoringConfig();
    const { data, error } = await supabase
      .from("listings")
      .select("*, listing_snapshots(*), listing_notes(note, created_at), listing_sources(*)")
      .order("priority_score", { ascending: false })
      .order("last_seen_at", { ascending: false });

    if (error) {
      return [];
    }

    if (!data?.length) {
      return [];
    }

    return (data as ListingRow[])
      .map((row) => mapListingRow(row, scoringConfig))
      .sort((left, right) => right.priorityScore - left.priorityScore);
  } catch {
    return [];
  }
}

async function loadReportsFromSupabase() {
  if (!hasSupabaseReadConfig()) {
    return null;
  }

  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .order("report_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      return [];
    }

    if (!data?.length) {
      return [];
    }

    return (data as ReportRow[]).map(mapReportRow);
  } catch {
    return [];
  }
}

export async function getListings(filters: ListingFilters) {
  const scoringConfig = await getPersistedScoringConfig();
  const storedListings = (await loadListingsFromSupabase()) ?? (await getMockListings());
  return applyListingFilters(storedListings, filters, scoringConfig);
}

export async function getAllListings() {
  return (await loadListingsFromSupabase()) ?? (await getMockListings());
}

export async function getListingById(id: string) {
  if (hasSupabaseReadConfig()) {
    try {
      const supabase = getSupabaseServiceClient();
      const { data, error } = await supabase
        .from("listings")
        .select("*, listing_snapshots(*), listing_notes(note, created_at), listing_sources(*)")
        .eq("id", id)
        .maybeSingle();

      if (!error && data) {
        const scoringConfig = await getPersistedScoringConfig();
        return mapListingRow(data as ListingRow, scoringConfig);
      }
    } catch {
      return null;
    }

    return null;
  }

  return getMockListingById(id);
}

export async function getDuplicateListings(listing: Listing) {
  if (!listing.duplicateGroupId || !hasSupabaseReadConfig()) return [];

  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("listings")
      .select("*, listing_snapshots(*), listing_notes(note, created_at), listing_sources(*)")
      .eq("duplicate_group_id", listing.duplicateGroupId)
      .neq("id", listing.id);

    if (error || !data) return [];
    const scoringConfig = await getPersistedScoringConfig();
    return (data as ListingRow[]).map((row) => mapListingRow(row, scoringConfig));
  } catch {
    return [];
  }
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const storedListings = await loadListingsFromSupabase();
  const scoringConfig = await getPersistedScoringConfig();

  if (!storedListings) {
    return getMockDashboardSummary();
  }
  const activeListings = storedListings.filter(
    (listing) => listing.status !== "archived",
  );
  const openOpportunityListings = activeListings.filter(
    (listing) => listing.crmStatus !== "treated",
  );

  return {
    newToday: activeListings.filter((listing) => listing.isNewToday).length,
    probablePrivate: activeListings.filter((listing) => listing.sellerType === "private").length,
    agencies: activeListings.filter((listing) => listing.sellerType === "agency").length,
    toVerify: activeListings.filter((listing) =>
      ["new", "review"].includes(listing.status),
    ).length,
    priceDrops: activeListings.filter((listing) => listing.isPriceDropped).length,
    hotOld: activeListings.filter((listing) =>
      isHotOldListingWithConfig(listing, scoringConfig),
    ).length,
    highPriority: openOpportunityListings.filter(
      (listing) =>
        listing.priorityScore >= getHighPriorityThresholdFromConfig(scoringConfig),
    ).length,
    watchlist: [...openOpportunityListings]
      .sort((left, right) => {
        if (right.priorityScore !== left.priorityScore) {
          return right.priorityScore - left.priorityScore;
        }

        return right.lastSeenAt.localeCompare(left.lastSeenAt);
      })
      .slice(0, 5),
  };
}

export async function getReports() {
  return (await loadReportsFromSupabase()) ?? (await getMockReports());
}

export async function getLastScrapeRun() {
  if (!hasSupabaseReadConfig()) {
    return null;
  }

  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("scrape_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return mapScrapeRunRow(data as ScrapeRunRow);
  } catch {
    return null;
  }
}

export async function getRecentScrapeRuns(limit = 5) {
  if (!hasSupabaseReadConfig()) {
    return [];
  }

  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("scrape_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);

    if (error || !data?.length) {
      return [];
    }

    return (data as ScrapeRunRow[]).map(mapScrapeRunRow);
  } catch {
    return [];
  }
}

export async function getRecentScrapeErrors(limit = 8) {
  if (!hasSupabaseReadConfig()) {
    return [];
  }

  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("scrape_errors")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !data?.length) {
      return [];
    }

    return (data as ScrapeErrorRow[]).map(mapScrapeErrorRow);
  } catch {
    return [];
  }
}
