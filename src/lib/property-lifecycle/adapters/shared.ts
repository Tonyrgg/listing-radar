import { createHash } from "node:crypto";

import type { CheerioAPI } from "cheerio";

import type {
  AdapterHealthState,
  EvidenceClaim,
  NormalizedAsset,
} from "@/lib/property-lifecycle/contracts/normalized-listing";
import type {
  InventoryDiagnostics,
  InventoryItem,
} from "@/lib/property-lifecycle/adapters/types";

export function cleanText(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

export function canonicalUrl(value: string, baseUrl: string): string {
  const url = new URL(value, baseUrl);
  url.hash = "";
  url.searchParams.delete("utm_source");
  url.searchParams.delete("utm_medium");
  url.searchParams.delete("utm_campaign");

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

export function parseItalianNumber(value: string | null | undefined): number | null {
  const match = value?.match(/\d[\d.\s]*(?:,\d+)?/);
  if (!match) {
    return null;
  }

  const normalized = match[0].replace(/[.\s]/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseInteger(value: string | null | undefined): number | null {
  const parsed = parseItalianNumber(value);
  return parsed == null ? null : Math.round(parsed);
}

export function cleanAgencyReference(value: string | null | undefined): string | null {
  return cleanText(
    value?.replace(/^(?:(?:rif(?:erimento)?\.?|codice)\s*:?)?\s*n?[°ºo]?\s*:?[\s-]*/i, ""),
  );
}

export function structureFingerprint(markers: Record<string, boolean>): string {
  return createHash("sha256")
    .update(
      Object.entries(markers)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, present]) => `${name}:${present ? 1 : 0}`)
        .join("|"),
    )
    .digest("hex");
}

export function classifyInventoryHealth(
  diagnostics: InventoryDiagnostics,
): { state: AdapterHealthState; complete: boolean } {
  const requiredMarkersPresent = Object.values(diagnostics.requiredMarkers).every(Boolean);

  if (!requiredMarkersPresent) {
    return { state: "STRUCTURE_CHANGED", complete: false };
  }

  if (diagnostics.observedCount === 0) {
    return { state: "FAILED", complete: false };
  }

  const expectedCountIsPlausible =
    diagnostics.expectedCount == null ||
    diagnostics.observedCount >= Math.max(1, Math.floor(diagnostics.expectedCount * 0.9));
  const parseErrorRatio = diagnostics.parseErrorCount / diagnostics.observedCount;

  if (
    !expectedCountIsPlausible ||
    parseErrorRatio > 0.1 ||
    diagnostics.pagesVisited < 1 ||
    diagnostics.pagesVisited < diagnostics.expectedPages
  ) {
    return { state: "DEGRADED", complete: false };
  }

  return { state: "HEALTHY", complete: true };
}

export function deduplicateInventoryItems(items: InventoryItem[]): {
  items: InventoryItem[];
  duplicateCount: number;
} {
  const byKey = new Map<string, InventoryItem>();

  for (const item of items) {
    byKey.set(item.sourceKey, item);
  }

  return {
    items: [...byKey.values()],
    duplicateCount: items.length - byKey.size,
  };
}

export function extractMeta($: CheerioAPI, key: string): string | null {
  return cleanText(
    $(`meta[property="${key}"], meta[name="${key}"]`).first().attr("content"),
  );
}

export function createEvidence(
  input: Omit<EvidenceClaim, "metadata"> & { metadata?: Record<string, unknown> },
): EvidenceClaim {
  return {
    ...input,
    metadata: input.metadata ?? {},
  };
}

export function wordpressUploadDate(urlValue: string): {
  lowerBound: string;
  upperBound: string;
} | null {
  const match = new URL(urlValue).pathname.match(/\/uploads\/(20\d{2})\/(0[1-9]|1[0-2])\//);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const lowerBound = new Date(Date.UTC(year, monthIndex, 1)).toISOString();
  const upperBound = new Date(Date.UTC(year, monthIndex + 1, 1) - 1).toISOString();

  return { lowerBound, upperBound };
}

export function earliestAssetDate(assets: NormalizedAsset[]): {
  lowerBound: string;
  upperBound: string;
  asset: NormalizedAsset;
} | null {
  const dated = assets
    .map((asset) => ({ asset, range: wordpressUploadDate(asset.canonicalUrl) }))
    .filter(
      (value): value is { asset: NormalizedAsset; range: NonNullable<typeof value.range> } =>
        value.range !== null,
    )
    .sort((left, right) => left.range.lowerBound.localeCompare(right.range.lowerBound));

  return dated[0]
    ? {
        asset: dated[0].asset,
        lowerBound: dated[0].range.lowerBound,
        upperBound: dated[0].range.upperBound,
      }
    : null;
}
