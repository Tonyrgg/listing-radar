import type { SellerType } from "@/types";

export const MONITORED_ZONE = "Bitonto";
export const REPORT_SCHEDULE = "09:00";

export const LISTING_SOURCE_OPTIONS = [
  "Subito",
  "Casa.it",
  "Idealista",
  "Immobiliare.it",
  "Bakeca",
] as const;

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
