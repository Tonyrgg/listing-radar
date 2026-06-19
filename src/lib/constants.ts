import type { SellerType } from "@/types";
import { FILTERABLE_LISTING_SOURCE_OPTIONS } from "@/lib/listing-sources";
import { SCRAPER_CONFIG } from "@/lib/scrapers/config";

export const MONITORED_ZONE = SCRAPER_CONFIG.monitoredCity;
export const REPORT_SCHEDULE = "09:00";

export const LISTING_SOURCE_OPTIONS = FILTERABLE_LISTING_SOURCE_OPTIONS;

export const SELLER_TYPE_OPTIONS: Array<"all" | SellerType> = [
  "all",
  "private",
  "agency",
  "unknown",
];

export const LISTING_STATUS_OPTIONS = [
  "all",
  "new",
  "watch",
  "review",
  "contacted",
  "negotiating",
  "archived",
] as const;
