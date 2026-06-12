import {
  HIGH_PRIORITY_THRESHOLD,
  getMinimumDaysOnline,
  isHotOldListing,
} from "@/lib/listings/scoring";
import {
  getMockDashboardSummary,
  getMockListingById,
  getMockListings,
  getMockReports,
} from "@/lib/data/mock-store";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type {
  DashboardSummary,
  Listing,
  ListingFilters,
  ListingSnapshot,
  ListingSource,
  Report,
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
  seller_type: SellerType;
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
  raw_payload: Record<string, unknown> | null;
  created_at: string | null;
};

type ListingSourceRow = {
  id: string;
  listing_id: string;
  source: string;
  url: string;
  source_listing_id: string | null;
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
    sellerName: row.seller_name,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

function mapListingRow(row: ListingRow): Listing {
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
    sellerType: row.seller_type,
    sellerName: row.seller_name,
    phone: row.phone,
    portalDeclaredDate: row.portal_declared_date,
    metadataDatePublished: row.metadata_date_published,
    metadataDateModified: row.metadata_date_modified,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    status: row.status,
    priorityScore: row.priority_score,
    sellerFatigueScore: row.seller_fatigue_score,
    duplicateGroupId: row.duplicate_group_id,
    isPriceDropped: row.is_price_dropped,
    isNewToday: row.is_new_today,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    minimumDaysOnline: getMinimumDaysOnline({
      firstSeenAt: row.first_seen_at,
      portalDeclaredDate: row.portal_declared_date,
      metadataDatePublished: row.metadata_date_published,
    }),
    note:
      [...(row.listing_notes ?? [])]
        .sort((left, right) =>
          (right.created_at ?? "").localeCompare(left.created_at ?? ""),
        )[0]?.note ?? null,
    snapshots: (row.listing_snapshots ?? []).map(mapSnapshotRow).sort((left, right) =>
      right.checkedAt.localeCompare(left.checkedAt),
    ),
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

function applyListingFilters(listings: Listing[], filters: ListingFilters) {
  return listings.filter((listing) => {
    if (filters.sellerType !== "all" && listing.sellerType !== filters.sellerType) {
      return false;
    }

    if (filters.status !== "all" && listing.status !== filters.status) {
      return false;
    }

    if (filters.source !== "all" && listing.source !== filters.source) {
      return false;
    }

    if (
      typeof filters.minDaysOnline === "number" &&
      listing.minimumDaysOnline < filters.minDaysOnline
    ) {
      return false;
    }

    if (filters.onlyHighPriority && listing.priorityScore < HIGH_PRIORITY_THRESHOLD) {
      return false;
    }

    return true;
  });
}

async function loadListingsFromSupabase() {
  if (!hasSupabaseReadConfig()) {
    return null;
  }

  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("listings")
      .select("*, listing_snapshots(*), listing_notes(note, created_at), listing_sources(*)")
      .order("priority_score", { ascending: false })
      .order("last_seen_at", { ascending: false });

    if (error || !data?.length) {
      return null;
    }

    return (data as ListingRow[]).map(mapListingRow);
  } catch {
    return null;
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

    if (error || !data?.length) {
      return null;
    }

    return (data as ReportRow[]).map(mapReportRow);
  } catch {
    return null;
  }
}

export async function getListings(filters: ListingFilters) {
  const storedListings = (await loadListingsFromSupabase()) ?? (await getMockListings());
  return applyListingFilters(storedListings, filters);
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
        return mapListingRow(data as ListingRow);
      }
    } catch {
      // Fall through to mock data below.
    }
  }

  return getMockListingById(id);
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const storedListings = await loadListingsFromSupabase();

  if (!storedListings) {
    return getMockDashboardSummary();
  }

  return {
    newToday: storedListings.filter((listing) => listing.isNewToday).length,
    probablePrivate: storedListings.filter((listing) => listing.sellerType === "private").length,
    agencies: storedListings.filter((listing) => listing.sellerType === "agency").length,
    toVerify: storedListings.filter((listing) =>
      ["new", "review"].includes(listing.status),
    ).length,
    priceDrops: storedListings.filter((listing) => listing.isPriceDropped).length,
    hotOld: storedListings.filter(isHotOldListing).length,
    highPriority: storedListings.filter(
      (listing) => listing.priorityScore >= HIGH_PRIORITY_THRESHOLD,
    ).length,
    watchlist: [...storedListings]
      .sort((left, right) => right.priorityScore - left.priorityScore)
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
