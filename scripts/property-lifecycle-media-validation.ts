import sharp from "sharp";

import { inspectImage } from "../src/lib/image/inspection";
import { createPropertyLifecycleAdapter } from "../src/lib/property-lifecycle/adapters/registry";
import { processListingAssets } from "../src/lib/property-lifecycle/assets/pipeline";

const URLS = {
  photoA: "https://www.vistocasa.com/immobili/fotoimmobile9931/1.jpg",
  photoB: "https://www.vistocasa.com/immobili/fotoimmobile10002/1.jpg",
  floorplanA: "https://www.vistocasa.com/immobili/fotoimmobile9931/PIANTINA.jpg",
  floorplanB: "https://www.vistocasa.com/immobili/fotoimmobile9068/piantina.jpg",
} as const;

function similarity(left: string, right: string): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let differences = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) differences += 1;
  }
  return Number((1 - differences / left.length).toFixed(4));
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { "user-agent": "ListingRadarLifecycle/2.0 (+media validation)" },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function transformedComparisons(label: string, source: Buffer) {
  const original = await inspectImage(source);
  const variants = {
    identicalCopy: Buffer.from(source),
    resizedJpeg: await sharp(source).rotate().resize(640, 480, { fit: "inside" }).jpeg({ quality: 82 }).toBuffer(),
    recompressedJpeg: await sharp(source).rotate().jpeg({ quality: 45 }).toBuffer(),
    convertedWebp: await sharp(source).rotate().webp({ quality: 72 }).toBuffer(),
  };
  const comparisons: Record<string, unknown> = {};
  for (const [variant, bytes] of Object.entries(variants)) {
    const inspected = await inspectImage(bytes);
    comparisons[variant] = {
      sha256Equal: original.sha256 === inspected.sha256,
      dHashSimilarity: similarity(original.perceptualHash, inspected.perceptualHash),
      format: inspected.format,
      width: inspected.width,
      height: inspected.height,
    };
  }
  return { label, original, comparisons };
}

async function main(): Promise<void> {
  const [photoA, photoB, floorplanA, floorplanB] = await Promise.all(
    Object.values(URLS).map(download),
  );
  const [photoAInspection, photoBInspection, floorplanAInspection, floorplanBInspection] =
    await Promise.all([photoA, photoB, floorplanA, floorplanB].map(inspectImage));
  const adapter = createPropertyLifecycleAdapter("vistocasa");
  const inventory = await adapter.fetchInventory();
  const item = inventory.items.find((candidate) => candidate.externalId === "9931");
  if (!item) throw new Error("Vistocasa live sample 9931 not found.");
  const listing = await adapter.normalize(await adapter.fetchDetail(item));
  const processed = await processListingAssets(listing, {
    maxAssets: 30,
    requestDelayMs: 80,
    timeoutMs: 15_000,
  });

  console.info(JSON.stringify({
    observedAt: new Date().toISOString(),
    algorithm: "DHASH64",
    strongEvidenceThreshold: 0.8,
    sources: URLS,
    photoTransformations: await transformedComparisons("photoA", photoA),
    floorplanTransformations: await transformedComparisons("floorplanA", floorplanA),
    unrelatedComparisons: {
      photoVsPhoto: similarity(photoAInspection.perceptualHash, photoBInspection.perceptualHash),
      floorplanVsFloorplan: similarity(
        floorplanAInspection.perceptualHash,
        floorplanBInspection.perceptualHash,
      ),
      photoVsFloorplan: similarity(photoAInspection.perceptualHash, floorplanAInspection.perceptualHash),
    },
    livePipeline: {
      listingId: listing.source.externalId,
      normalizedAssets: listing.assets.length,
      processedAssets: processed.assets.length,
      warnings: processed.warnings,
      classifications: processed.assets.reduce<Record<string, number>>((counts, asset) => {
        counts[asset.classification] = (counts[asset.classification] ?? 0) + 1;
        return counts;
      }, {}),
      offPropertyAssets: processed.assets
        .filter((asset) => !new URL(asset.canonicalUrl).pathname.toLowerCase().includes("/fotoimmobile9931/"))
        .map((asset) => asset.canonicalUrl),
    },
  }));
}

void main();
