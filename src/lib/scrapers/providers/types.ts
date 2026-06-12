import type { NormalizedListing } from "@/types";

export type ProviderRunIssueType = "fetch" | "parse" | "search" | "upsert";

export interface ProviderRunIssue {
  type: ProviderRunIssueType;
  message: string;
  url?: string;
  details?: Record<string, unknown> | null;
}

export interface ProviderRunLog {
  provider: string;
  searchUrls: string[];
  foundUrls: number;
  detailPagesRead: number;
  errors: ProviderRunIssue[];
}

export interface ListingsProvider {
  name: string;
  fetchListings: () => Promise<NormalizedListing[]>;
  getLastRunLog?: () => ProviderRunLog | null;
}
