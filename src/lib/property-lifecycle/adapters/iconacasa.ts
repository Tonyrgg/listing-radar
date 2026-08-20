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

export const ICONACASA_BASE_URL = "https://www.iconacasa.com";
export const ICONACASA_INVENTORY_URL =
  "https://www.iconacasa.com/index.php/agenzie/companyproperties/13-iconacasa-bitonto-piazza-aldo-moro";
const ICONACASA_TOKEN_URL =
  `${ICONACASA_BASE_URL}/index.php?option=com_iproperty&task=ajax.getToken&format=raw`;
const ICONACASA_BACKEND_URL =
  `${ICONACASA_BASE_URL}/index.php?option=com_iproperty&task=ajax.ajaxSearchCustomByAgenzia&format=raw&filter_listing_office=13`;

interface IconacasaBackendRecord {
  id: string;
  title: string | null;
  street_num: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  stype: string | null;
  beds: string | null;
  baths: string | null;
  sqft: string | null;
  modified: string | null;
  available: string | null;
  name: string | null;
  alias: string | null;
  publish_up: string | null;
  cat_title: string | null;
  cat_id: string | null;
  img: string | null;
}

function backendString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? cleanText(value) : null;
}

export function parseIconacasaBackendJson(body: string): IconacasaBackendRecord[] {
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Iconacasa public backend returned a non-object payload.");
  }
  const root = parsed as Record<string, unknown>;
  if (root.success !== true || !Array.isArray(root.data)) {
    throw new Error("Iconacasa public backend did not return a successful data array.");
  }

  return root.data.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const id = backendString(record, "id");
    if (!id || !/^\d+$/.test(id)) return [];
    return [{
      id,
      title: backendString(record, "title"),
      street_num: backendString(record, "street_num"),
      street: backendString(record, "street"),
      city: backendString(record, "city"),
      region: backendString(record, "region"),
      stype: backendString(record, "stype"),
      beds: backendString(record, "beds"),
      baths: backendString(record, "baths"),
      sqft: backendString(record, "sqft"),
      modified: backendString(record, "modified"),
      available: backendString(record, "available"),
      name: backendString(record, "name"),
      alias: backendString(record, "alias"),
      publish_up: backendString(record, "publish_up"),
      cat_title: backendString(record, "cat_title"),
      cat_id: backendString(record, "cat_id"),
      img: backendString(record, "img"),
    }];
  });
}

function backendSummary(item: InventoryItem): IconacasaBackendRecord | null {
  const value = item.summary.publicBackend;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = backendString(record, "id");
  if (!id) return null;
  return {
    id,
    title: backendString(record, "title"),
    street_num: backendString(record, "street_num"),
    street: backendString(record, "street"),
    city: backendString(record, "city"),
    region: backendString(record, "region"),
    stype: backendString(record, "stype"),
    beds: backendString(record, "beds"),
    baths: backendString(record, "baths"),
    sqft: backendString(record, "sqft"),
    modified: backendString(record, "modified"),
    available: backendString(record, "available"),
    name: backendString(record, "name"),
    alias: backendString(record, "alias"),
    publish_up: backendString(record, "publish_up"),
    cat_title: backendString(record, "cat_title"),
    cat_id: backendString(record, "cat_id"),
    img: backendString(record, "img"),
  };
}

function sourceDayBounds(value: string | null): { lowerBound: string; upperBound: string } | null {
  const day = value?.match(/^(\d{4})-(\d{2})-(\d{2})/)?.[0];
  if (!day) return null;
  const lower = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(lower.getTime())) return null;
  return {
    lowerBound: lower.toISOString(),
    upperBound: new Date(lower.getTime() + 86_399_999).toISOString(),
  };
}

function cookieHeader(headers: Headers): string | null {
  const raw = headers.get("set-cookie");
  return raw?.split(",").map((cookie) => cookie.split(";", 1)[0]?.trim()).filter(Boolean).join("; ") || null;
}

function extractExternalId(url: string): string | null {
  return new URL(url).pathname.match(/\/property\/(\d+)(?:-|\/|$)/)?.[1] ?? null;
}

function labeledValue($: CheerioAPI, label: string): string | null {
  const normalizedLabel = label.toLocaleLowerCase("it");
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const element of $("p.customlabel, li, .property-info-row").toArray()) {
    const container = $(element);
    const fullText = cleanText(container.text());

    if (!fullText?.toLocaleLowerCase("it").startsWith(normalizedLabel)) {
      continue;
    }

    const value = cleanText(fullText.replace(new RegExp(`^${escapedLabel}\\s*:?`, "i"), ""));
    if (value) {
      return value;
    }
  }

  return null;
}

function iconacasaStatus(label: string | null): {
  value: SourceStatus;
  confidence: number;
} {
  const normalized = label?.toLocaleLowerCase("it") ?? "";

  if (/vendut|non disponibile|ritirat/.test(normalized)) {
    return { value: /vendut/.test(normalized) ? "SOLD" : "REMOVED", confidence: 0.95 };
  }

  if (/trattativa|opzionat/.test(normalized)) {
    return { value: "NEGOTIATION", confidence: 0.9 };
  }

  if (/disponibile|vendita/.test(normalized)) {
    return { value: "ACTIVE", confidence: 0.9 };
  }

  return { value: "UNKNOWN", confidence: 0.25 };
}

function iconacasaAssets($: CheerioAPI, propertyId: string): NormalizedAsset[] {
  const urls = new Set<string>();

  $("a[href], img[src], source[srcset]").each((_, element) => {
    const sourceValue =
      $(element).attr("href") ??
      $(element).attr("src") ??
      $(element).attr("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];

    if (!sourceValue || !/\/media\/com_iproperty\/pictures\//i.test(sourceValue)) {
      return;
    }

    try {
      const url = new URL(sourceValue, ICONACASA_BASE_URL);
      url.search = "";
      urls.add(url.toString());
    } catch {
      // A malformed media URL is an extraction warning, not a parser crash.
    }
  });

  const allUrls = [...urls];
  const propertyScoped = allUrls.filter((url) => new URL(url).pathname.includes(propertyId));
  const selected = propertyScoped.length > 0 ? propertyScoped : allUrls;

  return selected.slice(0, 60).map((url) => ({
    kind: /planimetr|piantina|floor.?plan/i.test(url) ? "FLOORPLAN" : "IMAGE",
    url,
    canonicalUrl: url,
    sourceRecordedAt: null,
    dateEvidenceMethod: null,
    metadata: {},
  }));
}

export function parseIconacasaInventoryHtml(
  html: string,
  response: HttpResponse | null = null,
): InventoryResult {
  const $ = load(html);
  const extracted: InventoryItem[] = [];
  let parseErrorCount = 0;

  $("a[href*='/index.php/opportunita/property/']").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || !/vendita/i.test(href) || /affitto|locazione/i.test(href)) {
      return;
    }

    try {
      const url = canonicalUrl(href, ICONACASA_BASE_URL);
      const externalId = extractExternalId(url);
      if (!externalId) {
        parseErrorCount += 1;
        return;
      }

      extracted.push({
        sourceKey: externalId,
        externalId,
        url,
        summary: { anchorText: cleanText($(element).text()) },
      });
    } catch {
      parseErrorCount += 1;
    }
  });

  const deduplicated = deduplicateInventoryItems(extracted);
  const fixtureExpected = parseInteger($("[data-v2-sale-count]").first().attr("data-v2-sale-count"));
  const reportedTotal = parseInteger(html.match(/Ris\.?\s*:\s*(\d+)/i)?.[1]);
  const markers = {
    agencyInventory: /companyproperties|company-properties|agenzie/i.test(html),
    propertyLinks: deduplicated.items.length > 0,
    saleMarker: /vendita/i.test(html),
  };
  const paginationUrls = extractIconacasaPaginationUrls(html);
  const reasons = reportedTotal == null ? [] : [`source_reported_total_including_all_contracts:${reportedTotal}`];
  const diagnostics = {
    expectedCount: fixtureExpected,
    observedCount: deduplicated.items.length,
    duplicateCount: deduplicated.duplicateCount,
    parseErrorCount,
    pagesVisited: 1,
    expectedPages: paginationUrls.length + 1,
    requiredMarkers: markers,
    reasons,
  };
  const health = classifyInventoryHealth(diagnostics);

  return {
    items: deduplicated.items,
    healthState: health.state,
    complete: health.complete,
    structureFingerprint: structureFingerprint(markers),
    diagnostics,
    response,
  };
}

export function extractIconacasaPaginationUrls(html: string): string[] {
  const $ = load(html);
  const urls = new Set<string>();
  const inventoryPath = new URL(ICONACASA_INVENTORY_URL).pathname;

  $("a[href*='start=']").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    try {
      const url = new URL(href, ICONACASA_BASE_URL);
      if (
        url.origin === new URL(ICONACASA_BASE_URL).origin &&
        url.pathname === inventoryPath &&
        url.searchParams.has("start")
      ) {
        urls.add(url.toString());
      }
    } catch {
      // Invalid pagination links are reflected by incomplete inventory health.
    }
  });

  return [...urls].sort(
    (left, right) =>
      Number(new URL(left).searchParams.get("start")) -
      Number(new URL(right).searchParams.get("start")),
  );
}

export function normalizeIconacasaDetail(document: SourceDocument): NormalizedListingV2 {
  const { body, headers, status: responseStatus, url: responseUrl } = document.response;
  const $ = load(body);
  const canonical = canonicalUrl(
    extractMeta($, "og:url") ?? document.item.url,
    ICONACASA_BASE_URL,
  );
  const externalId = extractExternalId(canonical) ?? document.item.externalId;
  const backend = backendSummary(document.item);
  const title =
    cleanText($("h3.page_title").first().text()) ??
    cleanText($("h4.property-title").first().text()) ??
    extractMeta($, "og:title");

  if (!title) {
    throw new Error(`Iconacasa detail ${canonical} has no title.`);
  }

  const locationText =
    cleanText($(".page_location").first().text()) ??
    labeledValue($, "Località") ??
    labeledValue($, "Zona") ??
    backend?.city;
  const statusLabel = labeledValue($, "Disponibilità") ?? labeledValue($, "Stato");
  const status = iconacasaStatus(statusLabel);
  const description =
    cleanText($(".property-text").first().text()) ?? extractMeta($, "og:description");
  const areaText = labeledValue($, "Area") ?? labeledValue($, "Superficie");
  const statusEvidence = statusLabel
    ? [
        createEvidence({
          kind: "SOURCE_STATUS",
          claimKey: "publication.status",
          sourceUrl: canonical,
          extractionMethod: "ICONACASA_DEDICATED_LABEL",
          rawValue: statusLabel,
          normalizedValue: status.value,
          confidence: status.confidence,
          observedAt: document.observedAt,
          sourceRecordedAt: null,
        }),
      ]
    : [];
  const publishBounds = sourceDayBounds(backend?.publish_up ?? null);
  const marketEvidence = createEvidence({
    kind: "MARKET_START_BOUND",
    claimKey: publishBounds ? "publication.publishUp" : "publication.firstObservedActiveAt",
    sourceUrl: publishBounds ? ICONACASA_BACKEND_URL : canonical,
    extractionMethod: publishBounds ? "ICONACASA_PUBLISH_UP" : "CRAWLER_FIRST_SEEN",
    rawValue: publishBounds ? backend?.publish_up ?? null : document.observedAt,
    normalizedValue: publishBounds ?? { lowerBound: null, upperBound: document.observedAt },
    confidence: publishBounds ? 0.85 : 0.3,
    observedAt: document.observedAt,
    sourceRecordedAt: null,
    metadata: publishBounds
      ? { timezoneUnavailable: true, modifiedNotUsedAsMarketStart: backend?.modified ?? null }
      : {},
  });

  return finalizeNormalizedListing({
    contractVersion: CONTRACT_VERSION,
    adapterKey: "iconacasa",
    source: {
      agencySlug: "iconacasa-bitonto",
      sourceKey: document.item.sourceKey,
      externalId,
      canonicalUrl: canonical,
      agencyReference: cleanAgencyReference(
        labeledValue($, "Riferimento") ??
        labeledValue($, "Rif.") ??
        labeledValue($, "Codice"),
      ),
      transactionType: "SALE",
    },
    commercial: {
      title,
      description,
      propertyType: labeledValue($, "Tipo") ?? backend?.cat_title ?? null,
      priceAmount: parseInteger(labeledValue($, "Prezzo") ?? title),
      priceCurrency: "EUR",
      surfaceSqm: parseItalianNumber(backend?.sqft ?? areaText),
      rooms: parseItalianNumber(labeledValue($, "Locali")),
      bedrooms: parseItalianNumber(labeledValue($, "Camere")),
      bathrooms: parseItalianNumber(labeledValue($, "Bagni")),
      floor: labeledValue($, "Piano"),
      features: {
        garden: labeledValue($, "Giardino/Atrio"),
        parking: labeledValue($, "Posto auto"),
        garage: labeledValue($, "Garage/Box"),
      },
    },
    location: resolveMonitoredGeography({ rawText: locationText }),
    status: {
      value: status.value,
      sourceLabel: statusLabel,
      confidence: status.confidence,
      evidence: statusEvidence,
    },
    assets: iconacasaAssets($, externalId),
    marketStart: {
      lowerBound: publishBounds?.lowerBound ?? null,
      upperBound: publishBounds?.upperBound ?? document.observedAt,
      method: publishBounds ? "ICONACASA_PUBLISH_UP" : "CRAWLER_FIRST_SEEN",
      confidence: publishBounds ? 0.85 : 0.3,
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
      reportedSource: backend ? "public_html_and_public_json_backend" : "public_html",
      backendPublishUp: backend?.publish_up ?? null,
      backendModified: backend?.modified ?? null,
      backendModifiedIgnoredForMarketStart: true,
      backendAvailable: backend?.available ?? null,
      backendSaleLabel: backend?.name ?? null,
      backendInventoryPresenceIsNotLifecycleStatus: true,
    },
  });
}

export class IconacasaAdapter implements PropertyLifecycleAdapter {
  readonly key = "iconacasa";
  readonly agencySlug = "iconacasa-bitonto";
  readonly inventoryUrl = ICONACASA_INVENTORY_URL;

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
      const diagnostics = {
        expectedCount: null,
        observedCount: 0,
        duplicateCount: 0,
        parseErrorCount: 1,
        pagesVisited: 1,
        expectedPages: 1,
        requiredMarkers: { successfulResponse: false },
        reasons: [`http_status:${response.status}`],
      };
      return {
        items: [],
        healthState: "FAILED",
        complete: false,
        structureFingerprint: structureFingerprint(diagnostics.requiredMarkers),
        diagnostics,
        response,
      };
    }

    const firstPage = parseIconacasaInventoryHtml(response.body, response);
    const paginationUrls = extractIconacasaPaginationUrls(response.body);
    const allItems = [...firstPage.items];
    let parseErrorCount = firstPage.diagnostics.parseErrorCount;
    let perPageDuplicateCount = firstPage.diagnostics.duplicateCount;
    let pagesVisited = 1;
    const reasons = [...firstPage.diagnostics.reasons];
    let backendRecords: IconacasaBackendRecord[] = [];
    let backendAvailable = false;

    try {
      const tokenResponse = await this.http.get(ICONACASA_TOKEN_URL);
      const token = cleanText(tokenResponse.body)?.replace(/^"|"$/g, "");
      const cookie = cookieHeader(tokenResponse.headers);
      if (!tokenResponse.ok || !token || !/^[a-f0-9]{32}$/i.test(token) || !cookie) {
        throw new Error(`token_contract_invalid:http=${tokenResponse.status}`);
      }
      const backendResponse = await this.http.get(`${ICONACASA_BACKEND_URL}&${token}=1`, {
        headers: {
          "user-agent": "ListingRadarLifecycle/2.0 (+local validation)",
          accept: "application/json,text/plain,*/*",
          cookie,
        },
      });
      if (!backendResponse.ok) {
        throw new Error(`backend_http_status:${backendResponse.status}`);
      }
      backendRecords = parseIconacasaBackendJson(backendResponse.body);
      backendAvailable = true;
    } catch (error) {
      reasons.push(
        `public_backend_unavailable:${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const pageUrl of paginationUrls) {
      const pageResponse = await this.http.get(pageUrl);
      if (!pageResponse.ok) {
        parseErrorCount += 1;
        reasons.push(`pagination_http_status:${pageResponse.status}:${pageUrl}`);
        continue;
      }

      const page = parseIconacasaInventoryHtml(pageResponse.body, pageResponse);
      allItems.push(...page.items);
      parseErrorCount += page.diagnostics.parseErrorCount;
      perPageDuplicateCount += page.diagnostics.duplicateCount;
      pagesVisited += 1;
    }

    const deduplicated = deduplicateInventoryItems(allItems);
    const saleBackendRecords = backendRecords.filter(
      (record) => record.stype === "1" || /vendita/i.test(record.name ?? ""),
    );
    const backendById = new Map(saleBackendRecords.map((record) => [record.id, record]));
    const enrichedItems = deduplicated.items.map((item) => ({
      ...item,
      summary: {
        ...item.summary,
        ...(backendById.has(item.externalId)
          ? { publicBackend: backendById.get(item.externalId) }
          : {}),
      },
    }));
    const backendSaleCountReconciled =
      backendAvailable &&
      saleBackendRecords.length === deduplicated.items.length &&
      deduplicated.items.every((item) => backendById.has(item.externalId));
    reasons.push(`public_backend_records:${backendRecords.length}`);
    reasons.push(`public_backend_sale_records:${saleBackendRecords.length}`);
    if (!backendSaleCountReconciled) reasons.push("public_backend_sale_inventory_mismatch");
    const requiredMarkers = {
      ...firstPage.diagnostics.requiredMarkers,
      publicBackendJson: backendAvailable,
      backendSaleCountReconciled,
    };
    const diagnostics = {
      ...firstPage.diagnostics,
      expectedCount: backendAvailable ? saleBackendRecords.length : null,
      observedCount: deduplicated.items.length,
      duplicateCount: perPageDuplicateCount + deduplicated.duplicateCount,
      parseErrorCount,
      pagesVisited,
      expectedPages: paginationUrls.length + 1,
      requiredMarkers,
      reasons,
    };
    const health = classifyInventoryHealth(diagnostics);

    return {
      ...firstPage,
      items: enrichedItems,
      healthState: health.state,
      complete: health.complete,
      structureFingerprint: structureFingerprint(requiredMarkers),
      diagnostics,
    };
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
      throw new Error(`Iconacasa detail ${item.url} returned HTTP ${response.status}.`);
    }

    return { item, response, observedAt: new Date().toISOString() };
  }

  async normalize(document: SourceDocument): Promise<NormalizedListingV2> {
    return normalizeIconacasaDetail(document);
  }
}
