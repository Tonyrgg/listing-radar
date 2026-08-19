import { createPropertyLifecycleAdapter } from "../src/lib/property-lifecycle/adapters/registry";

const ADAPTER_KEYS = [
  "iconacasa",
  "vistocasa",
  "studisanti",
  "admaiora",
  "studiocasa",
  "futura",
  "garofalo",
  "trio",
  "puntocasa",
  "momento",
] as const;

function requestedKeys(): string[] {
  const requested = process.argv
    .filter((value) => value.startsWith("--adapter="))
    .map((value) => value.slice("--adapter=".length).trim())
    .filter(Boolean);
  return requested.length > 0 ? requested : [...ADAPTER_KEYS];
}

function requestedSampleLimit(): number {
  const argument = process.argv.find((value) => value.startsWith("--sample-details="));
  if (!argument) return 0;
  const parsed = Number(argument.slice("--sample-details=".length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

async function main(): Promise<void> {
  const sampleLimit = requestedSampleLimit();
  const allDetails = process.argv.includes("--all-details");
  for (const key of requestedKeys()) {
    const adapter = createPropertyLifecycleAdapter(key);
    const startedAt = Date.now();
    try {
      const inventory = await adapter.fetchInventory();
      console.info(
        JSON.stringify({
          key,
          agencySlug: adapter.agencySlug,
          inventoryUrl: adapter.inventoryUrl,
          elapsedMs: Date.now() - startedAt,
          healthState: inventory.healthState,
          complete: inventory.complete,
          itemCount: inventory.items.length,
          sampleKeys: inventory.items.slice(0, 3).map((item) => item.sourceKey),
          responseUrl: inventory.response?.url ?? null,
          responseStatus: inventory.response?.status ?? null,
          diagnostics: inventory.diagnostics,
        }),
      );
      if (sampleLimit > 0 || allDetails) {
        let inspected = 0;
        let excluded = 0;
        let review = 0;
        let errors = 0;
        let accepted = 0;
        const localityDistribution: Record<string, number> = {};
        const precisionDistribution: Record<string, number> = {};
        const statusDistribution: Record<string, number> = {};
        const startMethodDistribution: Record<string, number> = {};
        const completeness = {
          price: 0,
          surface: 0,
          rooms: 0,
          floor: 0,
          propertyType: 0,
          street: 0,
          civic: 0,
          coordinates: 0,
          images: 0,
          floorplans: 0,
        };
        for (const item of inventory.items) {
          if (!allDetails && accepted >= sampleLimit) break;
          inspected += 1;
          try {
            const listing = await adapter.normalize(await adapter.fetchDetail(item));
            if (listing.location.scope === "OUT_OF_SCOPE") {
              excluded += 1;
              continue;
            }
            if (listing.location.scope === "REVIEW") {
              review += 1;
              continue;
            }
            accepted += 1;
            increment(localityDistribution, listing.location.locality ?? "UNKNOWN");
            increment(precisionDistribution, listing.location.precision);
            increment(statusDistribution, listing.status.value);
            increment(startMethodDistribution, listing.marketStart.method);
            if (listing.commercial.priceAmount != null) completeness.price += 1;
            if (listing.commercial.surfaceSqm != null) completeness.surface += 1;
            if (listing.commercial.rooms != null) completeness.rooms += 1;
            if (listing.commercial.floor) completeness.floor += 1;
            if (listing.commercial.propertyType) completeness.propertyType += 1;
            if (listing.location.streetName) completeness.street += 1;
            if (listing.location.streetNumber) completeness.civic += 1;
            if (listing.location.latitude != null && listing.location.longitude != null) {
              completeness.coordinates += 1;
            }
            if (listing.assets.some((asset) => asset.kind === "IMAGE")) completeness.images += 1;
            if (listing.assets.some((asset) => asset.kind === "FLOORPLAN")) {
              completeness.floorplans += 1;
            }
            const compactRecord = {
              type: "LIVE_RECORD",
              key,
              externalId: listing.source.externalId,
              sourceKey: listing.source.sourceKey,
              reference: listing.source.agencyReference,
              url: listing.source.canonicalUrl,
              title: listing.commercial.title,
              description: listing.commercial.description,
              price: listing.commercial.priceAmount,
              surfaceSqm: listing.commercial.surfaceSqm,
              rooms: listing.commercial.rooms,
              bathrooms: listing.commercial.bathrooms,
              floor: listing.commercial.floor,
              propertyType: listing.commercial.propertyType,
              location: listing.location,
              status: listing.status,
              marketStart: listing.marketStart,
              assetCount: listing.assets.length,
              imageCount: listing.assets.filter((asset) => asset.kind === "IMAGE").length,
              floorplanCount: listing.assets.filter((asset) => asset.kind === "FLOORPLAN").length,
              assetUrls: listing.assets.map((asset) => asset.canonicalUrl),
              warnings: listing.extractionWarnings,
              provenance: listing.provenance,
            };
            if (allDetails) console.info(JSON.stringify(compactRecord));
            if (accepted <= sampleLimit) {
              console.info(JSON.stringify({
                ...compactRecord,
                type: "LIVE_SAMPLE",
                assetSamples: listing.assets.slice(0, 3),
                response: listing.response,
              }));
            }
          } catch (error) {
            errors += 1;
            console.info(
              JSON.stringify({
                type: "LIVE_DETAIL_ERROR",
                key,
                sourceKey: item.sourceKey,
                url: item.url,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        }
        console.info(
          JSON.stringify({
            type: "LIVE_SAMPLE_SUMMARY",
            key,
            requested: sampleLimit,
            accepted,
            inspected,
            excluded,
            review,
            errors,
            localityDistribution,
            precisionDistribution,
            statusDistribution,
            startMethodDistribution,
            completeness,
          }),
        );
      }
    } catch (error) {
      console.info(
        JSON.stringify({
          key,
          agencySlug: adapter.agencySlug,
          inventoryUrl: adapter.inventoryUrl,
          elapsedMs: Date.now() - startedAt,
          fatalError: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

void main();
