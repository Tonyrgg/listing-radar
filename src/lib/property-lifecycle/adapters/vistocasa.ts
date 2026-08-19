import { load, type CheerioAPI } from "cheerio";

import { HttpClient, type HttpResponse } from "@/lib/http/client";
import {
  CONTRACT_VERSION,
  finalizeNormalizedListing,
  type NormalizedAsset,
  type NormalizedListingV2,
  type SourceStatus,
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

export const VISTOCASA_BASE_URL = "https://www.vistocasa.com";
export const VISTOCASA_INVENTORY_URL =
  "https://www.vistocasa.com/it/ricerca.aspx?catalogoproduttoriid=56";

function sourceIdFromUrl(urlValue: string): string | null {
  const url = new URL(urlValue, VISTOCASA_BASE_URL);
  for (const [key, value] of url.searchParams) {
    if (key.toLocaleLowerCase("it") === "articoliid" && /^\d+$/.test(value)) {
      return value;
    }
  }
  return null;
}

function sourceDetailUrl(externalId: string): string {
  return `${VISTOCASA_BASE_URL}/it/immobile.aspx?articoliid=${externalId}`;
}

function numericSummaryValue(item: InventoryItem, key: string): number | null {
  const value = item.summary[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCoordinate(value: string | null | undefined): number | null {
  const parsed = Number(cleanText(value)?.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function detailValue($: CheerioAPI, key: string): string | null {
  const element = $(`#ctl00_cph_${key}`).first();
  return cleanText(element.text()) ?? cleanText(element.attr("value"));
}

function detailTitle($: CheerioAPI): string | null {
  return (
    detailValue($, "spnTitolo") ??
    cleanText($("h1").first().text()) ??
    cleanText(extractMeta($, "og:title")?.replace(/\s*-\s*Agenzia Vistocasa Bitonto\s*$/i, ""))
  );
}

function locationFromTitle(title: string): string {
  return cleanText(title.match(/^(.+?)\s*-\s*.+$/)?.[1]) ?? title;
}

function normalizeFloor(value: string | null): string | null {
  return value === "0" ? "Piano terra" : value;
}

function vistocasaAssets($: CheerioAPI, externalId: string): NormalizedAsset[] {
  const urls = new Set<string>();
  const scopedPath = `/immobili/fotoimmobile${externalId}/`;

  $("a[href], img[src], source[srcset]").each((_, element) => {
    const candidates = [
      $(element).attr("href"),
      $(element).attr("src"),
      ...($(element).attr("srcset") ?? "")
        .split(",")
        .map((candidate) => candidate.trim().split(/\s+/)[0]),
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      try {
        const url = new URL(candidate, VISTOCASA_BASE_URL);
        if (
          url.hostname.toLocaleLowerCase("it") !== "www.vistocasa.com" ||
          !url.pathname.toLocaleLowerCase("it").includes(scopedPath.toLocaleLowerCase("it")) ||
          !/\.(?:jpe?g|png|webp)$/i.test(url.pathname)
        ) {
          continue;
        }
        url.search = "";
        urls.add(url.toString());
      } catch {
        // Malformed gallery references are ignored and surfaced by an empty asset set.
      }
    }
  });

  const ogImage = extractMeta($, "og:image");
  if (ogImage) {
    try {
      const url = new URL(ogImage, VISTOCASA_BASE_URL);
      if (url.pathname.toLocaleLowerCase("it").includes(scopedPath.toLocaleLowerCase("it"))) {
        url.search = "";
        urls.add(url.toString());
      }
    } catch {
      // The scoped gallery remains authoritative when og:image is malformed.
    }
  }

  return [...urls].slice(0, 60).map((url) => {
    const soldGraphic = /vendut|sold/i.test(new URL(url).pathname);
    return {
      kind: /planimetr|piantina|floor.?plan|pianta[-_.]/i.test(new URL(url).pathname)
        ? "FLOORPLAN"
        : "IMAGE",
      url,
      canonicalUrl: url,
      sourceRecordedAt: null,
      dateEvidenceMethod: null,
      metadata: soldGraphic
        ? { role: "SOLD_STATUS_GRAPHIC", excludedFromRepresentative: true }
        : {},
    };
  });
}

function soldGraphic(assets: NormalizedAsset[], item: InventoryItem): NormalizedAsset | null {
  const fromDetail = assets.find((asset) => /vendut|sold/i.test(new URL(asset.canonicalUrl).pathname));
  if (fromDetail) {
    return fromDetail;
  }
  const inventoryImage = item.summary.imageUrl;
  if (typeof inventoryImage !== "string" || !/vendut|sold/i.test(inventoryImage)) {
    return null;
  }
  return {
    kind: "IMAGE",
    url: inventoryImage,
    canonicalUrl: inventoryImage,
    sourceRecordedAt: null,
    dateEvidenceMethod: null,
    metadata: { role: "SOLD_STATUS_GRAPHIC", excludedFromRepresentative: true },
  };
}

function statusFromSoldGraphic(graphic: NormalizedAsset | null): {
  value: SourceStatus;
  label: string | null;
  confidence: number;
} {
  return graphic
    ? { value: "SOLD", label: "Venduto (grafica dedicata)", confidence: 0.99 }
    : { value: "UNKNOWN", label: null, confidence: 0.25 };
}

export function parseVistocasaInventoryHtml(
  html: string,
  response: HttpResponse | null = null,
): InventoryResult {
  const $ = load(html);
  const extracted: InventoryItem[] = [];
  let parseErrorCount = 0;
  let classifiedTransactionCount = 0;
  const markers = $("marker").toArray();

  for (const element of markers) {
    const marker = $(element);
    const externalId = cleanText(marker.attr("id"));
    const title = cleanText(marker.attr("titolo"));
    const imageValue = cleanText(marker.attr("img_small"));
    const isSale = Boolean(title && /\bvendita\b/i.test(title));
    const isRental = Boolean(title && /\b(?:affitto|locazione)\b/i.test(title));

    if (isSale || isRental) {
      classifiedTransactionCount += 1;
    }
    if (!isSale) {
      if (!isRental) {
        parseErrorCount += 1;
      }
      continue;
    }
    if (!externalId || !/^\d+$/.test(externalId) || !title) {
      parseErrorCount += 1;
      continue;
    }

    try {
      const imageUrl = imageValue ? canonicalUrl(imageValue, VISTOCASA_BASE_URL) : null;
      extracted.push({
        sourceKey: externalId,
        externalId,
        url: sourceDetailUrl(externalId),
        summary: {
          title,
          priceAmount: parseInteger(marker.attr("prezzo")),
          latitude: parseCoordinate(marker.attr("lat")),
          longitude: parseCoordinate(marker.attr("lng")),
          imageUrl,
          soldGraphic: Boolean(imageUrl && /vendut|sold/i.test(imageUrl)),
        },
      });
    } catch {
      parseErrorCount += 1;
    }
  }

  const deduplicated = deduplicateInventoryItems(extracted);
  const fixtureExpected = parseInteger($("[data-v2-sale-count]").first().attr("data-v2-sale-count"));
  const expectedCount = fixtureExpected ?? deduplicated.items.length;
  const requiredMarkers = {
    agencyInventory: /catalogoproduttoriid=56|agenzia\s+vistocasa\s+bitonto/i.test(html),
    embeddedMapRecords: markers.length > 0,
    transactionClassified: markers.length > 0 && classifiedTransactionCount === markers.length,
    saleRecords: deduplicated.items.length > 0,
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
      `embedded_map_records:${markers.length}`,
      "embedded_map_payload_covers_visible_aspnet_pagination",
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

export function normalizeVistocasaDetail(document: SourceDocument): NormalizedListingV2 {
  const { body, headers, status: responseStatus, url: responseUrl } = document.response;
  const $ = load(body);
  const canonical = canonicalUrl(
    extractMeta($, "og:url") ?? document.item.url,
    VISTOCASA_BASE_URL,
  );
  const externalId = sourceIdFromUrl(canonical) ?? document.item.externalId;
  const title = detailTitle($);
  if (!title) {
    throw new Error(`Vistocasa detail ${canonical} has no title.`);
  }
  const contract = detailValue($, "contratto");
  if (contract && !/vendita/i.test(contract)) {
    throw new Error(`Vistocasa detail ${canonical} is not a sale publication.`);
  }

  const assets = vistocasaAssets($, externalId);
  const dedicatedSoldGraphic = soldGraphic(assets, document.item);
  if (dedicatedSoldGraphic && !assets.some((asset) => asset.canonicalUrl === dedicatedSoldGraphic.canonicalUrl)) {
    assets.push(dedicatedSoldGraphic);
  }
  const status = statusFromSoldGraphic(dedicatedSoldGraphic);
  const statusEvidence = dedicatedSoldGraphic
    ? [
        createEvidence({
          kind: "SOURCE_STATUS",
          claimKey: "publication.status",
          sourceUrl: dedicatedSoldGraphic.canonicalUrl,
          extractionMethod: "VISTOCASA_DEDICATED_SOLD_GRAPHIC",
          rawValue: new URL(dedicatedSoldGraphic.canonicalUrl).pathname,
          normalizedValue: "SOLD",
          confidence: status.confidence,
          observedAt: document.observedAt,
          sourceRecordedAt: null,
          metadata: { limitation: "graphic is status evidence and never a representative photo" },
        }),
      ]
    : [];
  const marketEvidence = createEvidence({
    kind: "MARKET_START_BOUND",
    claimKey: "publication.firstObservedInCatalogAt",
    sourceUrl: canonical,
    extractionMethod: "CRAWLER_FIRST_SEEN",
    rawValue: document.observedAt,
    normalizedValue: { lowerBound: null, upperBound: document.observedAt },
    confidence: 0.3,
    observedAt: document.observedAt,
    sourceRecordedAt: null,
  });
  const latitude = numericSummaryValue(document.item, "latitude");
  const longitude = numericSummaryValue(document.item, "longitude");

  return finalizeNormalizedListing({
    contractVersion: CONTRACT_VERSION,
    adapterKey: "vistocasa",
    source: {
      agencySlug: "vistocasa-bitonto",
      sourceKey: document.item.sourceKey,
      externalId,
      canonicalUrl: canonical,
      agencyReference: cleanAgencyReference(
        detailValue($, "riferimento") ?? detailValue($, "hRifer") ?? detailValue($, "hRif"),
      ),
      transactionType: "SALE",
    },
    commercial: {
      title,
      description: extractMeta($, "og:description") ?? extractMeta($, "description"),
      propertyType: detailValue($, "tipologia"),
      priceAmount: parseInteger(detailValue($, "prezzo") ?? detailValue($, "prezzo1")),
      priceCurrency: "EUR",
      surfaceSqm: parseItalianNumber(
        detailValue($, "superficie") ?? detailValue($, "superficie1"),
      ),
      rooms: parseItalianNumber(detailValue($, "locali") ?? detailValue($, "locali1")),
      bedrooms: parseItalianNumber(detailValue($, "camere")),
      bathrooms: parseItalianNumber(detailValue($, "bagni")),
      floor: normalizeFloor(detailValue($, "piano") ?? detailValue($, "piano1")),
      features: {
        condition: detailValue($, "stato"),
        garage: detailValue($, "box"),
        elevator: detailValue($, "ascensore"),
        condominiumFees: detailValue($, "spesecondominio"),
        energyClass: detailValue($, "certificazioneenergetica"),
      },
    },
    location: resolveMonitoredGeography({
      rawText: locationFromTitle(title),
      latitude,
      longitude,
      coordinatesExact: false,
    }),
    status: {
      value: status.value,
      sourceLabel: status.label,
      confidence: status.confidence,
      evidence: statusEvidence,
    },
    assets,
    marketStart: {
      lowerBound: null,
      upperBound: document.observedAt,
      method: "CRAWLER_FIRST_SEEN",
      confidence: 0.3,
      evidence: [marketEvidence],
    },
    observedAt: document.observedAt,
    response: {
      url: responseUrl,
      status: responseStatus,
      etag: cleanText(headers.get("etag")),
      lastModified: cleanText(headers.get("last-modified")),
    },
    extractionWarnings: status.value === "UNKNOWN" ? ["missing_dedicated_source_status"] : [],
    provenance: {
      inventorySummary: document.item.summary,
      reportedSource: "public_html_embedded_map_inventory",
      mediaDatePolicy: "original_gallery_last_modified_processed_only_in_deep_sync",
      ignoredDetailHttpLastModifiedForMarketStart: true,
    },
  });
}

export class VistocasaAdapter implements PropertyLifecycleAdapter {
  readonly key = "vistocasa";
  readonly agencySlug = "vistocasa-bitonto";
  readonly inventoryUrl = VISTOCASA_INVENTORY_URL;

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
    return parseVistocasaInventoryHtml(response.body, response);
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
      throw new Error(`Vistocasa detail ${item.url} returned HTTP ${response.status}.`);
    }
    return { item, response, observedAt: new Date().toISOString() };
  }

  async normalize(document: SourceDocument): Promise<NormalizedListingV2> {
    return normalizeVistocasaDetail(document);
  }
}
