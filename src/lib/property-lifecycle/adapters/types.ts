import type {
  AdapterHealthState,
  NormalizedListingV2,
} from "@/lib/property-lifecycle/contracts/normalized-listing";
import type { HttpResponse } from "@/lib/http/client";

export interface InventoryItem {
  sourceKey: string;
  externalId: string;
  url: string;
  summary: Record<string, unknown>;
}

export interface InventoryDiagnostics {
  expectedCount: number | null;
  observedCount: number;
  duplicateCount: number;
  parseErrorCount: number;
  pagesVisited: number;
  expectedPages: number;
  requiredMarkers: Record<string, boolean>;
  reasons: string[];
}

export interface InventoryResult {
  items: InventoryItem[];
  healthState: AdapterHealthState;
  complete: boolean;
  structureFingerprint: string;
  diagnostics: InventoryDiagnostics;
  response: HttpResponse | null;
}

export interface AdapterHealthResult {
  state: AdapterHealthState;
  complete: boolean;
  structureFingerprint: string;
  diagnostics: InventoryDiagnostics;
}

export interface SourceDocument {
  item: InventoryItem;
  response: HttpResponse;
  observedAt: string;
}

export interface PropertyLifecycleAdapter {
  readonly key: string;
  readonly agencySlug: string;
  readonly inventoryUrl: string;
  healthCheck(): Promise<AdapterHealthResult>;
  fetchInventory(): Promise<InventoryResult>;
  fetchDetail(item: InventoryItem): Promise<SourceDocument>;
  normalize(document: SourceDocument): Promise<NormalizedListingV2>;
}
