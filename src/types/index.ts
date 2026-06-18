export type SellerType = "private" | "agency" | "unknown";

export type ListingCrmStatus = "untreated" | "treated";

export type ListingStatus =
  | "new"
  | "watch"
  | "review"
  | "contacted"
  | "negotiating"
  | "archived";

export interface ListingSnapshot {
  id: string;
  listingId: string;
  checkedAt: string;
  source: string;
  url: string;
  price: number | null;
  title: string | null;
  descriptionHash: string | null;
  isAvailable: boolean;
  rawPayload: Record<string, unknown> | null;
  createdAt: string | null;
}

export interface ListingSource {
  id: string;
  listingId: string;
  source: string;
  url: string;
  sourceListingId: string | null;
  sellerName: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
}

export interface ListingNote {
  id: string;
  listingId: string;
  note: string;
  createdAt: string | null;
}

export interface ListingAction {
  id: string;
  listingId: string;
  actionType: string;
  status: string;
  scheduledAt: string | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string | null;
}

export interface Listing {
  id: string;
  source: string;
  sourceListingId: string | null;
  url: string;
  canonicalUrl: string | null;
  title: string;
  description: string | null;
  price: number | null;
  sqm: number | null;
  pricePerSqm: number | null;
  rooms: number | null;
  floor: string | null;
  zone: string | null;
  addressRaw: string | null;
  sellerType: SellerType;
  sellerName: string | null;
  phone: string | null;
  imageUrls: string[];
  portalDeclaredDate: string | null;
  metadataDatePublished: string | null;
  metadataDateModified: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  status: string;
  crmStatus: ListingCrmStatus;
  priorityScore: number;
  sellerFatigueScore: number;
  duplicateGroupId: string | null;
  isPriceDropped: boolean;
  isNewToday: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  minimumDaysOnline: number;
  note?: string | null;
  snapshots?: ListingSnapshot[];
  sources?: ListingSource[];
  suspectedRepublished?: boolean;
}

export interface Report {
  id: string;
  reportDate: string;
  totalFound: number;
  newCount: number;
  privateCount: number;
  agencyCount: number;
  unknownCount: number;
  priceDropsCount: number;
  hotOldCount: number;
  content: string | null;
  createdAt: string | null;
}

export interface ScrapeRun {
  id: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: string;
  totalFound: number;
  totalInserted: number;
  totalUpdated: number;
  errorCount: number;
  createdAt: string | null;
  errors?: ScrapeError[];
}

export interface ScrapeError {
  id: string;
  scrapeRunId: string;
  source: string | null;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: string | null;
}

export type IncomingListingStatus =
  | "pending"
  | "enriched"
  | "dismissed"
  | "error";

export interface IncomingListing {
  id: string;
  source: string;
  sourceListingId: string | null;
  url: string;
  canonicalUrl: string | null;
  title: string;
  description: string | null;
  price: number | null;
  sqm: number | null;
  rooms: number | null;
  zone: string | null;
  imageUrl: string | null;
  emailMessageId: string | null;
  emailSubject: string | null;
  emailSender: string | null;
  emailReceivedAt: string | null;
  status: IncomingListingStatus;
  listingId: string | null;
  rawPayload: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface NormalizedListing {
  id?: string;
  source: string;
  sourceListingId?: string | null;
  url: string;
  canonicalUrl?: string | null;
  title: string;
  description?: string | null;
  price?: number | null;
  sqm?: number | null;
  rooms?: number | null;
  floor?: string | null;
  zone?: string | null;
  addressRaw?: string | null;
  sellerType: SellerType;
  sellerName?: string | null;
  phone?: string | null;
  imageUrls?: string[];
  portalDeclaredDate?: string | null;
  metadataDatePublished?: string | null;
  metadataDateModified?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  checkedAt?: string | null;
  status?: string;
  note?: string | null;
  rawPayload?: Record<string, unknown> | null;
  isAvailable?: boolean;
  previousPrice?: number | null;
  isRepublishedSuspected?: boolean;
  previousUrls?: string[];
}

export interface ListingFilters {
  sellerType: "all" | SellerType;
  status: string;
  crmStatus: "all" | ListingCrmStatus;
  source: string;
  minDaysOnline: number | null;
  onlyHighPriority: boolean;
  minScore: number | null;
  maxScore: number | null;
  sortBy:
    | "score_desc"
    | "score_asc"
    | "newest"
    | "oldest"
    | "price_asc"
    | "price_desc";
}

export interface DashboardSummary {
  newToday: number;
  probablePrivate: number;
  agencies: number;
  toVerify: number;
  priceDrops: number;
  hotOld: number;
  highPriority: number;
  watchlist: Listing[];
}

export interface UpsertListingsResult {
  inserted: number;
  updated: number;
  snapshots: number;
  listings: Listing[];
}
