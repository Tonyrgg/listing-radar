import type { NormalizedListing } from "@/types";

export interface ListingsProvider {
  name: string;
  fetchListings: () => Promise<NormalizedListing[]>;
}
