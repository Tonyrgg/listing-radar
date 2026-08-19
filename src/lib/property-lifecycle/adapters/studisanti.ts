import { load, type CheerioAPI } from "cheerio";

import { HttpClient, type HttpResponse } from "@/lib/http/client";
import {
  CONTRACT_VERSION,
  finalizeNormalizedListing,
  type NormalizedAsset,
  type NormalizedListingV2,
} from "@/lib/property-lifecycle/contracts/normalized-listing";
import { resolveMonitoredGeography } from "@/lib/property-lifecycle/geography/scope";
import type {
  AdapterHealthResult,
  InventoryItem,
  InventoryResult,
  PropertyLifecycleAdapter,
  SourceDocument,
} from "@/lib/property-lifecycle/adapters/types";
import {
  canonicalUrl,
  classifyInventoryHealth,
  cleanAgencyReference,
  cleanText,
  createEvidence,
  deduplicateInventoryItems,
  extractMeta,
  parseInteger,
  parseItalianNumber,
  structureFingerprint,
} from "@/lib/property-lifecycle/adapters/shared";

export const STUDI_SANTI_BASE_URL = "https://studisantiimmobiliare.it";
export const STUDI_SANTI_INVENTORY_URL = "https://studisantiimmobiliare.it/sitemap.xml";

interface StudiSantiUrlIdentity {
  reference: string | null;
  externalId: string;
}

interface TimestampRange {
  raw: string;
  lowerBound: string;
  upperBound: string;
}

function urlIdentity(urlValue: string): StudiSantiUrlIdentity | null {
  const pathname = new URL(urlValue, STUDI_SANTI_BASE_URL).pathname;
  const match = pathname.match(
    /\/([avm]\d+)\/(\d+)\/?$/i,
  );
  if (match?.[1] && match[2]) {
    return { reference: match[1].toUpperCase(), externalId: match[2] };
  }
  const numericId = pathname.match(/\/(\d+)\/?$/)?.[1];
  return numericId ? { reference: null, externalId: numericId } : null;
}

function imageTimestamp(urlValue: string): TimestampRange | null {
  const raw = new URL(urlValue, STUDI_SANTI_BASE_URL).pathname.match(/-(20\d{12})-/)?.[1];
  if (!raw) {
    return null;
  }
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    return null;
  }
  return {
    raw,
    lowerBound: new Date(Date.UTC(year, month - 1, day)).toISOString(),
    upperBound: new Date(Date.UTC(year, month - 1, day + 1) - 1).toISOString(),
  };
}

function detailValue($: CheerioAPI, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const element of $(".widget-details-reservation .property-details li").toArray()) {
    const text = cleanText($(element).text());
    if (text && new RegExp(`^${escaped}\\s*:`, "i").test(text)) {
      return cleanText(text.replace(new RegExp(`^${escaped}\\s*:`, "i"), ""));
    }
  }
  return null;
}

function locationLabel($: CheerioAPI): string | null {
  for (const element of $(".widget-details-reservation .property-details li").toArray()) {
    const text = cleanText($(element).text());
    if (text && !text.includes(":")) {
      return text;
    }
  }
  return null;
}

function parseAddress(address: string | null): {
  streetName: string | null;
  streetNumber: string | null;
} {
  const match = address?.match(
    /^((?:via|viale|piazza|corso|largo|strada|contrada)\s+.+?)\s+(\d+[a-z]?(?:[/-]\d+[a-z]?)?)\s*(?:,|$)/i,
  );
  return {
    streetName: cleanText(match?.[1]),
    streetNumber: cleanText(match?.[2]),
  };
}

function imageVariantScore(pathname: string): number {
  if (/-1200-/i.test(pathname)) {
    return 3;
  }
  if (/--800-/i.test(pathname)) {
    return 2;
  }
  return /-(?:50-50|150-150|800-600)-/i.test(pathname) ? 0 : 1;
}

function studiSantiAssets($: CheerioAPI): NormalizedAsset[] {
  const bySourceImage = new Map<
    string,
    { url: string; score: number; label: string; timestamp: TimestampRange | null }
  >();

  $(".img-lighbox-container, .img-lighbox-thumbnails")
    .find("a[href], img[src]")
    .each((_, element) => {
      const candidate = $(element).attr("href") ?? $(element).attr("src");
      if (!candidate) {
        return;
      }
      try {
        const url = new URL(candidate, STUDI_SANTI_BASE_URL);
        if (
          url.hostname.toLocaleLowerCase("it") !== "studisantiimmobiliare.it" ||
          !/\/preview\/imm_[^/]+\.(?:jpe?g|png|webp)$/i.test(url.pathname)
        ) {
          return;
        }
        const imageId = url.pathname.match(/\/preview\/imm_(\d+)/i)?.[1];
        const timestamp = imageTimestamp(url.toString());
        if (!imageId || !timestamp) {
          return;
        }
        url.search = "";
        const score = imageVariantScore(url.pathname);
        const current = bySourceImage.get(imageId);
        if (!current || score > current.score) {
          bySourceImage.set(imageId, {
            url: url.toString(),
            score,
            label: cleanText(
              $(element).attr("title") ??
                $(element).attr("alt") ??
                $(element).find("img").first().attr("alt"),
            ) ?? "",
            timestamp,
          });
        }
      } catch {
        // Malformed preview URLs do not leave the listing-scoped gallery.
      }
    });

  return [...bySourceImage.values()].slice(0, 60).map(({ url, label, timestamp }) => ({
    kind: /planimetr|piantina|floor.?plan|pianta/i.test(`${url} ${label}`)
      ? "FLOORPLAN"
      : "IMAGE",
    url,
    canonicalUrl: url,
    sourceRecordedAt: null,
    dateEvidenceMethod: "MIOGEST_IMAGE_FILENAME_YYYYMMDDHHMMSS",
    metadata: timestamp
      ? {
          filenameTimestamp: timestamp.raw,
          lowerBound: timestamp.lowerBound,
          upperBound: timestamp.upperBound,
          timezoneLimitation: "source filename does not expose timezone",
        }
      : {},
  }));
}

function earliestAssetTimestamp(assets: NormalizedAsset[]): {
  asset: NormalizedAsset;
  range: TimestampRange;
} | null {
  return (
    assets
      .map((asset) => {
        const range = imageTimestamp(asset.canonicalUrl);
        return range ? { asset, range } : null;
      })
      .filter(
        (value): value is { asset: NormalizedAsset; range: TimestampRange } => value !== null,
      )
      .sort((left, right) => left.range.lowerBound.localeCompare(right.range.lowerBound))[0] ??
    null
  );
}

export function parseStudiSantiSitemap(
  xml: string,
  response: HttpResponse | null = null,
): InventoryResult {
  const $ = load(xml, { xmlMode: true });
  const extracted: InventoryItem[] = [];
  let parseErrorCount = 0;
  let saleEntryCount = 0;

  $("url").each((_, element) => {
    const location = cleanText($(element).find("loc").first().text());
    if (!location || !/\/it\/Vendite\/.+\/\d+\/?$/i.test(location)) {
      return;
    }
    saleEntryCount += 1;
    try {
      const url = new URL(location);
      url.protocol = "https:";
      const canonical = canonicalUrl(url.toString(), STUDI_SANTI_BASE_URL);
      const identity = urlIdentity(canonical);
      if (!identity) {
        parseErrorCount += 1;
        return;
      }
      extracted.push({
        sourceKey: identity.externalId,
        externalId: identity.externalId,
        url: canonical,
        summary: {
          agencyReference: identity.reference,
          sitemapLastModified: cleanText($(element).find("lastmod").first().text()),
          pathLocation: new URL(canonical).pathname.split("/")[3] ?? null,
        },
      });
    } catch {
      parseErrorCount += 1;
    }
  });

  const deduplicated = deduplicateInventoryItems(extracted);
  const fixtureExpected = parseInteger($("urlset").first().attr("data-v2-sale-count"));
  const expectedCount = fixtureExpected ?? saleEntryCount;
  const requiredMarkers = {
    sitemapUrlset: $("urlset").length === 1,
    agencyHost: $("loc")
      .toArray()
      .some((element) => /studisantiimmobiliare\.it/i.test($(element).text())),
    saleEntries: saleEntryCount > 0,
    saleEntriesParsed: saleEntryCount === deduplicated.items.length,
  };
  const diagnostics = {
    expectedCount,
    observedCount: deduplicated.items.length,
    duplicateCount: deduplicated.duplicateCount,
    parseErrorCount,
    pagesVisited: 1,
    expectedPages: 1,
    requiredMarkers,
    reasons: [
      "public_sitemap_is_complete_inventory_mechanism",
      "sitemap_lastmod_is_not_used_as_market_start",
    ],
  };
  const health = classifyInventoryHealth(diagnostics);

  return {
    items: deduplicated.items,
    healthState: health.state,
    complete: health.complete,
    structureFingerprint: structureFingerprint(requiredMarkers),
    diagnostics,
    response,
  };
}

export function normalizeStudiSantiDetail(document: SourceDocument): NormalizedListingV2 {
  const { body, headers, status: responseStatus, url: responseUrl } = document.response;
  const $ = load(body);
  const canonical = canonicalUrl(
    $("link[rel='canonical']").first().attr("href") ??
      extractMeta($, "og:url") ??
      document.item.url,
    STUDI_SANTI_BASE_URL,
  );
  const identity = urlIdentity(canonical) ?? urlIdentity(document.item.url);
  if (!identity) {
    throw new Error(`Studi Santi detail ${canonical} has no Miogest identity.`);
  }
  const title =
    cleanText($(".page-header h1").first().text()) ??
    cleanText(extractMeta($, "og:title")?.replace(/^Studi Santi Immobiliare\s*\|\s*/i, ""));
  if (!title) {
    throw new Error(`Studi Santi detail ${canonical} has no title.`);
  }

  const reference =
    cleanAgencyReference(
      cleanText($(".breadcrumb, .breadcrumbs").first().text())?.match(/Codice\s*:\s*([A-Z]\d+)/i)?.[1],
    ) ?? identity.reference;
  const address = cleanText($(".indirizzo").first().text());
  const sourceLocation = locationLabel($);
  const addressParts = parseAddress(address);
  const assets = studiSantiAssets($);
  const assetDate = earliestAssetTimestamp(assets);
  const marketEvidence = assetDate
    ? createEvidence({
        kind: "MARKET_START_ESTIMATE",
        claimKey: "publication.photoBatchDate",
        sourceUrl: assetDate.asset.canonicalUrl,
        extractionMethod: "MIOGEST_IMAGE_FILENAME_YYYYMMDDHHMMSS",
        rawValue: assetDate.range.raw,
        normalizedValue: {
          lowerBound: assetDate.range.lowerBound,
          upperBound: assetDate.range.upperBound,
        },
        confidence: 0.7,
        observedAt: document.observedAt,
        sourceRecordedAt: null,
        metadata: {
          limitation: "photo batch may predate publication or contain reused media",
          timezoneLimitation: "source filename does not expose timezone",
        },
      })
    : createEvidence({
        kind: "MARKET_START_BOUND",
        claimKey: "publication.firstObservedInSitemapAt",
        sourceUrl: canonical,
        extractionMethod: "CRAWLER_FIRST_SEEN",
        rawValue: document.observedAt,
        normalizedValue: { lowerBound: null, upperBound: document.observedAt },
        confidence: 0.3,
        observedAt: document.observedAt,
        sourceRecordedAt: null,
      });

  return finalizeNormalizedListing({
    contractVersion: CONTRACT_VERSION,
    adapterKey: "studisanti",
    source: {
      agencySlug: "studi-santi-bitonto",
      sourceKey: document.item.sourceKey,
      externalId: identity.externalId,
      canonicalUrl: canonical,
      agencyReference: reference,
      transactionType: "SALE",
    },
    commercial: {
      title,
      description:
        cleanText($(".descrizione-immobile").first().text()) ?? extractMeta($, "og:description"),
      propertyType: cleanText($(".widget-details-reservation .widget-title").first().text()),
      priceAmount: parseInteger($(".widget-details-reservation .prezzo strong").first().text()),
      priceCurrency: "EUR",
      surfaceSqm: parseItalianNumber(detailValue($, "Mq")),
      rooms: parseItalianNumber(detailValue($, "Locali")),
      bedrooms: parseItalianNumber(detailValue($, "Camere")),
      bathrooms: parseItalianNumber(detailValue($, "Bagni")),
      floor: detailValue($, "Piano"),
      features: {
        energyClass: detailValue($, "Classe"),
        balconySqm: parseItalianNumber(detailValue($, "Mq Balcone")),
      },
    },
    location: resolveMonitoredGeography({
      rawText: [address, sourceLocation].filter(Boolean).join(" | "),
      streetName: addressParts.streetName,
      streetNumber: addressParts.streetNumber,
    }),
    status: {
      value: "UNKNOWN",
      sourceLabel: null,
      confidence: 0.25,
      evidence: [],
    },
    assets,
    marketStart: {
      lowerBound: assetDate?.range.lowerBound ?? null,
      upperBound: assetDate?.range.upperBound ?? document.observedAt,
      method: assetDate ? "MIOGEST_IMAGE_FILENAME_YYYYMMDDHHMMSS" : "CRAWLER_FIRST_SEEN",
      confidence: assetDate ? 0.7 : 0.3,
      evidence: [marketEvidence],
    },
    observedAt: document.observedAt,
    response: {
      url: responseUrl,
      status: responseStatus,
      etag: cleanText(headers.get("etag")),
      lastModified: cleanText(headers.get("last-modified")),
    },
    extractionWarnings: [
      "missing_dedicated_source_status",
      ...(assetDate ? [] : ["missing_miogest_image_timestamp"]),
    ],
    provenance: {
      inventorySummary: document.item.summary,
      reportedSource: "public_sitemap_and_html",
      sitemapLastModifiedIgnoredForMarketStart: true,
    },
  });
}

export class StudiSantiAdapter implements PropertyLifecycleAdapter {
  readonly key = "studisanti";
  readonly agencySlug = "studi-santi-bitonto";
  readonly inventoryUrl = STUDI_SANTI_INVENTORY_URL;

  constructor(
    private readonly http = new HttpClient({
      timeoutMs: 15_000,
      retries: 2,
      retryDelayMs: 400,
      minIntervalMs: 1_000,
      headers: { "user-agent": "ListingRadarLifecycle/2.0 (+local validation)" },
    }),
  ) {}

  async fetchInventory(): Promise<InventoryResult> {
    const response = await this.http.get(this.inventoryUrl);
    if (!response.ok) {
      const requiredMarkers = { successfulResponse: false };
      const diagnostics = {
        expectedCount: null,
        observedCount: 0,
        duplicateCount: 0,
        parseErrorCount: 1,
        pagesVisited: 1,
        expectedPages: 1,
        requiredMarkers,
        reasons: [`http_status:${response.status}`],
      };
      return {
        items: [],
        healthState: "FAILED",
        complete: false,
        structureFingerprint: structureFingerprint(requiredMarkers),
        diagnostics,
        response,
      };
    }
    return parseStudiSantiSitemap(response.body, response);
  }

  async healthCheck(): Promise<AdapterHealthResult> {
    const result = await this.fetchInventory();
    return {
      state: result.healthState,
      complete: result.complete,
      structureFingerprint: result.structureFingerprint,
      diagnostics: result.diagnostics,
    };
  }

  async fetchDetail(item: InventoryItem): Promise<SourceDocument> {
    const response = await this.http.get(item.url);
    if (!response.ok) {
      throw new Error(`Studi Santi detail ${item.url} returned HTTP ${response.status}.`);
    }
    return { item, response, observedAt: new Date().toISOString() };
  }

  async normalize(document: SourceDocument): Promise<NormalizedListingV2> {
    return normalizeStudiSantiDetail(document);
  }
}
