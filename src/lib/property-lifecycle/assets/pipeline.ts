import sharp from "sharp";

import { inspectImage } from "@/lib/image/inspection";
import type {
  NormalizedAsset,
  NormalizedListingV2,
} from "@/lib/property-lifecycle/contracts/normalized-listing";

export type AssetClassification = "IMAGE" | "FLOORPLAN" | "SOLD_GRAPHIC";

export interface SanitizedExifEvidence {
  dateTimeOriginal: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  orientation: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ProcessedAsset {
  canonicalUrl: string;
  position: number;
  classification: AssetClassification;
  sha256: string;
  perceptualHash: string;
  width: number | null;
  height: number | null;
  format: string | null;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  sourceRecordedAt: string | null;
  exif: SanitizedExifEvidence | null;
  representativeThumbnail: Uint8Array | null;
}

export interface AssetProcessingResult {
  assets: ProcessedAsset[];
  warnings: string[];
}

export interface AssetPipelineOptions {
  fetcher?: typeof fetch;
  maxAssets?: number;
  maxBytesPerAsset?: number;
  requestDelayMs?: number;
  timeoutMs?: number;
  representativeImageCount?: number;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stringExifValue(exif: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = exif[key];
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 160);
    }
  }
  return null;
}

function numericExifValue(exif: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = exif[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

export function sanitizeExif(exif: Record<string, unknown> | null): SanitizedExifEvidence | null {
  if (!exif) {
    return null;
  }

  return {
    dateTimeOriginal: stringExifValue(exif, ["DateTimeOriginal", "CreateDate"]),
    cameraMake: stringExifValue(exif, ["Make"]),
    cameraModel: stringExifValue(exif, ["Model"]),
    orientation: numericExifValue(exif, ["Orientation"]),
    latitude: numericExifValue(exif, ["latitude", "GPSLatitude"]),
    longitude: numericExifValue(exif, ["longitude", "GPSLongitude"]),
  };
}

function classifyAsset(asset: NormalizedAsset): AssetClassification {
  if (/vendut|sold/i.test(new URL(asset.canonicalUrl).pathname)) {
    return "SOLD_GRAPHIC";
  }
  if (
    asset.kind === "FLOORPLAN" ||
    /planimetr|piantina|floor.?plan|pianta[-_.]/i.test(new URL(asset.canonicalUrl).pathname)
  ) {
    return "FLOORPLAN";
  }
  return "IMAGE";
}

async function downloadAsset(
  asset: NormalizedAsset,
  fetcher: typeof fetch,
  options: Required<Pick<AssetPipelineOptions, "maxBytesPerAsset" | "timeoutMs">>,
): Promise<{ response: Response; bytes: Uint8Array }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetcher(asset.canonicalUrl, {
      signal: controller.signal,
      headers: { "user-agent": "ListingRadarLifecycle/2.0 (+media inspection)" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytesPerAsset) {
      throw new Error(`declared body exceeds ${options.maxBytesPerAsset} bytes`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > options.maxBytesPerAsset) {
      throw new Error(`body exceeds ${options.maxBytesPerAsset} bytes`);
    }
    return { response, bytes };
  } finally {
    clearTimeout(timeout);
  }
}

export async function processListingAssets(
  listing: NormalizedListingV2,
  options: AssetPipelineOptions = {},
): Promise<AssetProcessingResult> {
  const fetcher = options.fetcher ?? fetch;
  const maxAssets = options.maxAssets ?? 24;
  const maxBytesPerAsset = options.maxBytesPerAsset ?? 15 * 1024 * 1024;
  const requestDelayMs = options.requestDelayMs ?? 200;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const representativeImageCount = Math.min(2, options.representativeImageCount ?? 2);
  const processed: ProcessedAsset[] = [];
  const warnings: string[] = [];
  let representativeImages = 0;

  for (const [position, asset] of listing.assets.slice(0, maxAssets).entries()) {
    if (position > 0 && requestDelayMs > 0) {
      await wait(requestDelayMs);
    }

    try {
      const { response, bytes } = await downloadAsset(asset, fetcher, {
        maxBytesPerAsset,
        timeoutMs,
      });
      const inspection = await inspectImage(bytes);
      const classification = classifyAsset(asset);
      const retainRepresentative =
        classification === "IMAGE" && representativeImages < representativeImageCount;
      const representativeThumbnail = retainRepresentative
        ? await sharp(bytes)
            .rotate()
            .resize(960, 720, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 76 })
            .toBuffer()
        : null;
      if (retainRepresentative) {
        representativeImages += 1;
      }

      processed.push({
        canonicalUrl: asset.canonicalUrl,
        position,
        classification,
        sha256: inspection.sha256,
        perceptualHash: inspection.perceptualHash,
        width: inspection.width,
        height: inspection.height,
        format: inspection.format,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        contentType: response.headers.get("content-type"),
        sourceRecordedAt: asset.sourceRecordedAt,
        exif: sanitizeExif(inspection.exif),
        representativeThumbnail,
      });
    } catch (error) {
      warnings.push(
        `asset_processing_failed:${asset.canonicalUrl}:${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (listing.assets.length > maxAssets) {
    warnings.push(`asset_limit_applied:${maxAssets}/${listing.assets.length}`);
  }

  return { assets: processed, warnings };
}
