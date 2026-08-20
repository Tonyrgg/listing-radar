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

export const FUTURA_BASE_URL = "https://www.futurabitonto.it";
export const FUTURA_INVENTORY_URL =
  `${FUTURA_BASE_URL}/web/immobili.asp?language=ita&pagref=88306&tipo_contratto=V`;

interface FuturaInventoryPage extends InventoryResult {
  pageNumber: number | null;
  totalPages: number;
  reportedTotal: number | null;
  rawRecordCount: number;
}

function inputValue($: CheerioAPI, name: string): string | null {
  return cleanText($(`input[name='${name}']`).first().attr("value"));
}

function detailValue($: CheerioAPI, id: string): string | null {
  const container = $(`#${id}`).first();
  return cleanText(container.attr("data-valore")) ?? cleanText(container.find(".valore").first().text());
}

function extractFuturaId(urlValue: string): string | null {
  try {
    const url = new URL(urlValue, FUTURA_BASE_URL);
    const id = url.searchParams.get("cod_annuncio");
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function totalPages($: CheerioAPI): number {
  return Math.max(
    1,
    ...$("select[name='pagina'] option")
      .toArray()
      .map((element) => Number($(element).attr("value")))
      .filter((value) => Number.isInteger(value) && value > 0),
  );
}

export function parseFuturaInventoryHtml(
  html: string,
  response: HttpResponse | null = null,
): FuturaInventoryPage {
  const $ = load(html);
  const cards = $(".property-item").toArray();
  const extracted: InventoryItem[] = [];
  let parseErrorCount = 0;

  for (const card of cards) {
    const container = $(card);
    const contract = cleanText(container.find(".contract").first().text());
    if (!contract || !/vendita/i.test(contract)) {
      parseErrorCount += 1;
      continue;
    }
    const href = container.find("a[href*='cod_annuncio=']").first().attr("href");
    if (!href) {
      parseErrorCount += 1;
      continue;
    }

    try {
      const url = canonicalUrl(href.replace(/&amp;/gi, "&"), FUTURA_BASE_URL);
      const externalId = extractFuturaId(url);
      if (!externalId) {
        parseErrorCount += 1;
        continue;
      }
      extracted.push({
        sourceKey: externalId,
        externalId,
        url,
        summary: {
          agencyReference: cleanAgencyReference(container.find(".rif").first().text()),
          transactionLabel: contract,
          title: cleanText(container.find("h4").first().text()),
          location: cleanText(container.find(".place").first().text()),
          municipality: cleanText(container.find(".nomecomune").first().text()),
          priceAmount: parseInteger(container.find(".price").first().text()),
          surfaceSqm: parseItalianNumber(container.find(".features .area").first().text()),
          descriptionExcerpt: cleanText(container.find(".testo").first().text()),
          inventoryImageUrl: cleanText(container.find("a.foto img").first().attr("src")),
        },
      });
    } catch {
      parseErrorCount += 1;
    }
  }

  const deduplicated = deduplicateInventoryItems(extracted);
  const reportedTotal = parseInteger(
    cleanText($("h2.titolo").first().text())?.match(/trovati\s+(\d+)\s+immobili/i)?.[1],
  );
  const pageNumber = parseInteger($("#h_num_page").first().attr("value"));
  const expectedPages = totalPages($);
  const requiredMarkers = {
    agestaPlatform: /agestaweb|agestanet|risorseimmobiliari/i.test(html),
    saleSearch: inputValue($, "tipo_contratto") === "V" || /tipo_contratto=V/i.test(html),
    resultCount: reportedTotal != null && reportedTotal > 0,
    listingCards: cards.length > 0 && deduplicated.items.length > 0,
    paginationContract:
      pageNumber != null && pageNumber >= 1 && pageNumber <= expectedPages,
  };
  const diagnostics = {
    expectedCount: reportedTotal,
    observedCount: deduplicated.items.length,
    duplicateCount: deduplicated.duplicateCount,
    parseErrorCount,
    pagesVisited: pageNumber == null ? 0 : 1,
    expectedPages,
    requiredMarkers,
    reasons: [],
  };
  const health = classifyInventoryHealth(diagnostics);

  return {
    items: deduplicated.items,
    healthState: health.state,
    complete: health.complete,
    structureFingerprint: structureFingerprint(requiredMarkers),
    diagnostics,
    response,
    pageNumber,
    totalPages: expectedPages,
    reportedTotal,
    rawRecordCount: cards.length,
  };
}

function dateOnlyRange(value: string | null, observedAt: string): {
  lowerBound: string;
  upperBound: string;
} | null {
  const match = value?.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const lower = Date.parse(`${value}T00:00:00.000Z`);
  const upper = Date.parse(`${value}T23:59:59.999Z`);
  if (!Number.isFinite(lower) || lower > Date.parse(observedAt)) {
    return null;
  }
  return {
    lowerBound: new Date(lower).toISOString(),
    upperBound: new Date(Math.min(upper, Date.parse(observedAt))).toISOString(),
  };
}

function coordinate(value: string | null | undefined, maximum: number): number | null {
  const parsed = Number(value?.trim().replace(",", "."));
  return Number.isFinite(parsed) && Math.abs(parsed) <= maximum ? parsed : null;
}

function futuraAssets($: CheerioAPI, externalId: string): NormalizedAsset[] {
  const urls = new Set<string>();
  $("#mainfoto a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }
    try {
      const url = new URL(href, FUTURA_BASE_URL);
      if (
        url.hostname.toLocaleLowerCase("it") !== "agestanet.risorseimmobiliari.it" ||
        !url.pathname.startsWith(`/public/annunci/10116/${externalId}/`) ||
        !/\.(?:jpe?g|png|webp)$/i.test(url.pathname)
      ) {
        return;
      }
      url.search = "";
      urls.add(url.toString());
    } catch {
      // Malformed source media is ignored and reflected by an empty/short gallery warning.
    }
  });

  return [...urls].slice(0, 60).map((url) => ({
    kind: /planimetr|piantina|floor.?plan|pianta[-_.]/i.test(url) ? "FLOORPLAN" : "IMAGE",
    url,
    canonicalUrl: url,
    sourceRecordedAt: null,
    dateEvidenceMethod: null,
    metadata: {
      originalAgestaAsset: true,
      lastModifiedEligibleForMarketStart: true,
    },
  }));
}

export function normalizeFuturaDetail(document: SourceDocument): NormalizedListingV2 {
  const { body, headers, status: responseStatus, url: responseUrl } = document.response;
  const $ = load(body);
  const canonical = canonicalUrl(
    extractMeta($, "og:url")?.replace(/&amp;/gi, "&") ?? document.item.url,
    FUTURA_BASE_URL,
  );
  const externalId = extractFuturaId(canonical) ?? inputValue($, "cod_annuncio");
  if (!externalId || externalId !== document.item.externalId) {
    throw new Error(
      `Futura detail ${canonical} identity does not match inventory ${document.item.externalId}.`,
    );
  }
  if (inputValue($, "cod_agenzia") !== "10116") {
    throw new Error(`Futura detail ${canonical} has an unexpected agency identity.`);
  }

  const title =
    cleanText($("h2.no-btm, .imm-det-title h2, h2").first().text()) ??
    cleanText(extractMeta($, "og:title"))?.replace(/\s+-\s+rif\..*$/i, "");
  if (!title) {
    throw new Error(`Futura detail ${canonical} has no title.`);
  }
  const description =
    cleanText($(".imm-det-des").first().text()) ?? extractMeta($, "og:description");
  const municipality = detailValue($, "det_comune") ?? inputValue($, "des_comune");
  const district = detailValue($, "det_zona") ?? inputValue($, "des_zona_comune");
  const street = detailValue($, "det_indirizzo");
  const map = $("[data-lat][data-lng]").first();
  const latitude = coordinate(map.attr("data-lat"), 90);
  const longitude = coordinate(map.attr("data-lng"), 180);
  const assets = futuraAssets($, externalId);
  const publishedLabel = extractMeta($, "article:published_time");
  const modifiedLabel = extractMeta($, "article:modified_time");
  const publishedRange = dateOnlyRange(publishedLabel, document.observedAt);
  const marketEvidence = publishedRange
    ? createEvidence({
        kind: "MARKET_START",
        claimKey: "publication.articlePublishedDate",
        sourceUrl: canonical,
        extractionMethod: "AGESTA_ARTICLE_PUBLISHED_DATE",
        rawValue: publishedLabel,
        normalizedValue: publishedRange,
        confidence: 0.85,
        observedAt: document.observedAt,
        sourceRecordedAt: publishedRange.upperBound,
        metadata: {
          limitation: "represents the current public cycle and may be a relaunch",
          articleModifiedIgnoredForStart: modifiedLabel,
        },
      })
    : createEvidence({
        kind: "MARKET_START_BOUND",
        claimKey: "publication.firstObservedInInventoryAt",
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
    adapterKey: "futura",
    source: {
      agencySlug: "futura-immobiliare-bitonto",
      sourceKey: document.item.sourceKey,
      externalId,
      canonicalUrl: canonical,
      agencyReference: cleanAgencyReference(
        detailValue($, "det_rif") ?? inputValue($, "riferimento_annuncio"),
      ),
      transactionType: inputValue($, "tipo_contratto") === "V" ? "SALE" : "UNKNOWN",
    },
    commercial: {
      title,
      description,
      propertyType: inputValue($, "des_tipologia"),
      priceAmount: parseInteger(detailValue($, "det_prezzo") ?? inputValue($, "prezzo")),
      priceCurrency: "EUR",
      surfaceSqm: parseItalianNumber(
        detailValue($, "det_superficie") ?? inputValue($, "mq"),
      ),
      rooms: parseItalianNumber(detailValue($, "det_vani") ?? inputValue($, "vani")),
      bedrooms: parseItalianNumber(
        detailValue($, "det_camere") ?? inputValue($, "camere"),
      ),
      bathrooms: parseItalianNumber(
        detailValue($, "det_bagni") ?? inputValue($, "bagni"),
      ),
      floor: detailValue($, "det_piano") ?? inputValue($, "piani"),
      features: {
        energyClass: detailValue($, "det_cl_en"),
        levels: parseItalianNumber(detailValue($, "det_livelli")),
        heating: detailValue($, "det_riscaldamento"),
        condition: detailValue($, "det_condizioni"),
        elevator: detailValue($, "det_ascensore"),
        garage: detailValue($, "det_garage"),
        parking: detailValue($, "det_parcheggio"),
        terrace: detailValue($, "det_terrazza"),
        balcony: detailValue($, "det_balcone"),
        garden: detailValue($, "det_giardino"),
      },
    },
    location: resolveMonitoredGeography({
      rawText: [street, district, municipality].filter(Boolean).join(", "),
      municipality,
      locality: district,
      latitude,
      longitude,
      coordinatesExact: false,
    }),
    status: {
      value: "UNKNOWN",
      sourceLabel: null,
      confidence: 0.25,
      evidence: [],
    },
    assets,
    marketStart: {
      lowerBound: publishedRange?.lowerBound ?? null,
      upperBound: publishedRange?.upperBound ?? document.observedAt,
      method: publishedRange ? "AGESTA_ARTICLE_PUBLISHED_DATE" : "CRAWLER_FIRST_SEEN",
      confidence: publishedRange ? 0.85 : 0.3,
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
      ...(publishedRange ? ["article_published_date_may_represent_relaunch"] : []),
      ...(assets.length === 0 ? ["missing_scoped_gallery"] : []),
    ],
    provenance: {
      inventorySummary: document.item.summary,
      reportedSource: "public_agesta_html",
      agestaAgencyId: 10116,
      articlePublishedLabel: publishedLabel,
      articleModifiedLabel: modifiedLabel,
      articleModifiedIgnoredForMarketStart: true,
      originalGalleryLastModifiedEligible: true,
    },
  });
}

export class FuturaAdapter implements PropertyLifecycleAdapter {
  readonly key = "futura";
  readonly agencySlug = "futura-immobiliare-bitonto";
  readonly inventoryUrl = FUTURA_INVENTORY_URL;

  constructor(
    private readonly http = new HttpClient({
      timeoutMs: 15_000,
      retries: 2,
      retryDelayMs: 400,
      minIntervalMs: 1_000,
      headers: {
        "user-agent": "ListingRadarLifecycle/2.0 (+local validation)",
        "accept-language": "it-IT,it;q=0.9,en;q=0.7",
      },
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
        pagesVisited: 0,
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

    const firstPage = parseFuturaInventoryHtml(response.body, response);
    const allItems = [...firstPage.items];
    const reasons = [...firstPage.diagnostics.reasons];
    let parseErrorCount = firstPage.diagnostics.parseErrorCount;
    let perPageDuplicateCount = firstPage.diagnostics.duplicateCount;
    let pagesVisited = firstPage.pageNumber === 1 ? 1 : 0;
    let rawRecordCount = firstPage.rawRecordCount;
    let allPagesStructured = Object.values(firstPage.diagnostics.requiredMarkers).every(Boolean);
    let totalsConsistent = true;

    for (let pageNumber = 2; pageNumber <= firstPage.totalPages; pageNumber += 1) {
      const pageUrl = `${FUTURA_INVENTORY_URL}&num_page=${pageNumber}`;
      const pageResponse = await this.http.get(pageUrl);
      if (!pageResponse.ok) {
        parseErrorCount += 1;
        allPagesStructured = false;
        reasons.push(`pagination_http_status:${pageResponse.status}:page=${pageNumber}`);
        continue;
      }
      const page = parseFuturaInventoryHtml(pageResponse.body, pageResponse);
      const structured = Object.values(page.diagnostics.requiredMarkers).every(Boolean);
      const expectedPage = page.pageNumber === pageNumber;
      allPagesStructured &&= structured && expectedPage;
      totalsConsistent &&=
        page.reportedTotal === firstPage.reportedTotal &&
        page.totalPages === firstPage.totalPages;
      if (!expectedPage) {
        reasons.push(`pagination_page_mismatch:expected=${pageNumber}:actual=${page.pageNumber}`);
      }
      if (structured && expectedPage) {
        pagesVisited += 1;
      }
      allItems.push(...page.items);
      rawRecordCount += page.rawRecordCount;
      parseErrorCount += page.diagnostics.parseErrorCount;
      perPageDuplicateCount += page.diagnostics.duplicateCount;
    }

    const deduplicated = deduplicateInventoryItems(allItems);
    const requiredMarkers = {
      ...firstPage.diagnostics.requiredMarkers,
      allPagesStructured,
      totalsConsistent,
      rawCountReconciled:
        firstPage.reportedTotal != null && rawRecordCount === firstPage.reportedTotal,
    };
    const diagnostics = {
      expectedCount: firstPage.reportedTotal,
      observedCount: deduplicated.items.length,
      duplicateCount: perPageDuplicateCount + deduplicated.duplicateCount,
      parseErrorCount,
      pagesVisited,
      expectedPages: firstPage.totalPages,
      requiredMarkers,
      reasons,
    };
    const health = classifyInventoryHealth(diagnostics);

    return {
      ...firstPage,
      items: deduplicated.items,
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
      throw new Error(`Futura detail ${item.url} returned HTTP ${response.status}.`);
    }
    return { item, response, observedAt: new Date().toISOString() };
  }

  async normalize(document: SourceDocument): Promise<NormalizedListingV2> {
    return normalizeFuturaDetail(document);
  }
}
