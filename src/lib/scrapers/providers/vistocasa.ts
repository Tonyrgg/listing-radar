import { SCRAPER_CONFIG, getScraperRuntimeConfig } from "@/lib/scrapers/config";
import { extractListingCoordinates } from "@/lib/listings/coordinates";
import { fetchHtml, stripHtml } from "@/lib/scrapers/html";
import { extractMetaTags } from "@/lib/scrapers/metadata";
import {
  cleanText,
  hashDescription,
  normalizeUrl,
  parsePrice,
  parseRooms,
  parseSqm,
} from "@/lib/scrapers/parsers";
import type {
  ListingsProvider,
  ProviderRunIssueType,
  ProviderRunLog,
} from "@/lib/scrapers/providers/types";
import type { NormalizedListing } from "@/types";

let lastRunLog: ProviderRunLog | null = null;

function createRunLog(): ProviderRunLog {
  return {
    provider: "vistocasa",
    searchUrls: [SCRAPER_CONFIG.vistocasa.searchUrl],
    foundUrls: 0,
    detailPagesRead: 0,
    errors: [],
  };
}

function logIssue(
  runLog: ProviderRunLog,
  type: ProviderRunIssueType,
  message: string,
  url?: string,
  details?: Record<string, unknown> | null,
) {
  runLog.errors.push({
    type,
    message,
    url,
    details: details ?? null,
  });

  console.warn(`[vistocasa] ${message}`, { url, details });
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractListingUrls(html: string) {
  const urls = new Set<string>();
  const hrefPattern = /\bhref=["']([^"']*immobile\.aspx\?articoliid=\d+[^"']*)["']/gi;

  for (const match of html.matchAll(hrefPattern)) {
    const value = match[1];

    if (!value) {
      continue;
    }

    try {
      urls.add(normalizeUrl(new URL(value, SCRAPER_CONFIG.vistocasa.baseUrl).toString()));
    } catch {
      // Ignore malformed links from legacy markup.
    }
  }

  return [...urls];
}

function extractSpanText(html: string, id: string) {
  const pattern = new RegExp(
    `<span\\b[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/span>`,
    "i",
  );
  const match = html.match(pattern);

  return match?.[1] ? stripHtml(match[1]) : null;
}

function extractTitle(html: string, metaTitle: string | undefined) {
  const title =
    extractSpanText(html, "ctl00_cph_spnTitolo") ??
    cleanText(metaTitle).replace(/\s*-\s*Agenzia Vistocasa Bitonto\s*$/i, "");

  return title.trim();
}

function extractDescription(html: string, fallback: string | undefined) {
  const bodyMatch = html.match(
    /<p\b[^>]*id=["']ctl00_cph_p_corpo["'][^>]*>([\s\S]*?)<\/p>\s*<\/p>/i,
  );
  const description = bodyMatch?.[1] ? stripHtml(bodyMatch[1]) : null;

  return description || cleanText(fallback) || null;
}

function extractImageUrls(html: string, listingId: string) {
  const urls = new Set<string>();
  const imagePattern = new RegExp(
    `\\b(?:href|src)=["']([^"']*\\/immobili\\/fotoimmobile${listingId}\\/[^"']+\\.(?:jpe?g|png|webp)(?:\\?[^"']*)?)["']`,
    "gi",
  );

  for (const match of html.matchAll(imagePattern)) {
    const value = match[1];

    if (!value || /venduto/i.test(value)) {
      continue;
    }

    try {
      const url = new URL(value, SCRAPER_CONFIG.vistocasa.baseUrl);
      url.search = "";
      urls.add(url.toString());
    } catch {
      // Ignore malformed image URLs.
    }
  }

  const ogImage = extractMetaTags(html)["og:image"];

  if (ogImage && ogImage.includes(`fotoimmobile${listingId}`)) {
    try {
      const url = new URL(ogImage, SCRAPER_CONFIG.vistocasa.baseUrl);
      url.search = "";
      urls.add(url.toString());
    } catch {
      // Ignore malformed image URLs.
    }
  }

  return [...urls].slice(0, 40);
}

function extractSourceListingId(url: string) {
  return new URL(url).searchParams.get("articoliid") ?? new URL(url).searchParams.get("ArticoliId");
}

function extractZone(title: string) {
  const zone = title.match(/^(.+?)\s*-\s*.+$/)?.[1];

  return zone?.trim() || SCRAPER_CONFIG.monitoredCity;
}

function normalizeFloor(value: string | null) {
  if (!value) {
    return null;
  }

  return value.toLowerCase() === "0" ? "piano terra" : value;
}

function normalizeListingFromDetail(url: string, html: string): NormalizedListing | null {
  const meta = extractMetaTags(html);
  const canonicalUrl = normalizeUrl(meta["og:url"] ?? url);
  const sourceListingId = extractSourceListingId(canonicalUrl);

  if (!sourceListingId) {
    throw new Error("Missing listing id.");
  }

  const contract = extractSpanText(html, "ctl00_cph_contratto");

  if (contract && !/vendita/i.test(contract)) {
    return null;
  }

  const title = extractTitle(html, meta["og:title"]);

  if (!title) {
    throw new Error("Missing listing title.");
  }

  const description = extractDescription(html, meta["og:description"]);
  const now = new Date().toISOString();
  const reference = extractSpanText(html, "ctl00_cph_riferimento");
  const priceText =
    extractSpanText(html, "ctl00_cph_prezzo") ??
    extractSpanText(html, "ctl00_cph_prezzo1");
  const sqmText =
    extractSpanText(html, "ctl00_cph_superficie") ??
    extractSpanText(html, "ctl00_cph_superficie1");
  const roomsText =
    extractSpanText(html, "ctl00_cph_locali") ??
    extractSpanText(html, "ctl00_cph_locali1");
  const coordinates = extractListingCoordinates({
    html,
    meta,
    source: "vistocasa",
  });

  return {
    source: "vistocasa",
    sourceListingId,
    url: canonicalUrl,
    canonicalUrl,
    title,
    description,
    price: parsePrice(priceText),
    sqm: parseSqm(sqmText ? `${sqmText} mq` : null),
    rooms: parseRooms(roomsText ? `${roomsText} locali` : title),
    floor: normalizeFloor(
      extractSpanText(html, "ctl00_cph_piano") ??
        extractSpanText(html, "ctl00_cph_piano1"),
    ),
    zone: extractZone(title),
    addressRaw: extractZone(title),
    latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null,
    coordinatesSource: coordinates?.source ?? null,
    sellerType: "agency",
    sellerName: "Vistocasa Bitonto",
    phone:
      extractSpanText(html, "ctl00_cph_agTel") ??
      extractSpanText(html, "ctl00_cph_agWhatsApp"),
    imageUrls: extractImageUrls(html, sourceListingId),
    portalDeclaredDate: null,
    metadataDatePublished: null,
    metadataDateModified: null,
    firstSeenAt: now,
    lastSeenAt: now,
    checkedAt: now,
    status: "new",
    rawPayload: {
      provider: "vistocasa",
      extractedAt: now,
      meta,
      reference,
      coordinates,
      descriptionHash: hashDescription(description),
      extra: {
        contract,
        disponibilita: extractSpanText(html, "ctl00_cph_disponibilita"),
        tipologia: extractSpanText(html, "ctl00_cph_tipologia"),
        bagni: extractSpanText(html, "ctl00_cph_bagni"),
        box: extractSpanText(html, "ctl00_cph_box"),
        ascensore: extractSpanText(html, "ctl00_cph_ascensore"),
        speseCondominio: extractSpanText(html, "ctl00_cph_spesecondominio"),
        stato: extractSpanText(html, "ctl00_cph_stato"),
        classeEnergetica: extractSpanText(html, "ctl00_cph_certificazioneenergetica"),
      },
    },
  };
}

export const vistocasaProvider: ListingsProvider = {
  name: "vistocasa",
  async fetchListings(): Promise<NormalizedListing[]> {
    const runtimeConfig = getScraperRuntimeConfig();
    const runLog = createRunLog();
    const listings: NormalizedListing[] = [];

    lastRunLog = runLog;

    let searchHtml: string;

    try {
      searchHtml = await fetchHtml(SCRAPER_CONFIG.vistocasa.searchUrl);
    } catch (error) {
      logIssue(runLog, "fetch", "Unable to fetch Vistocasa search page.", SCRAPER_CONFIG.vistocasa.searchUrl, {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const extractedDetailUrls = extractListingUrls(searchHtml);
    const detailUrls = extractedDetailUrls.slice(
      0,
      runtimeConfig.maxDetailPages,
    );

    runLog.foundUrls = extractedDetailUrls.length;

    if (detailUrls.length === 0) {
      logIssue(
        runLog,
        "search",
        "No listing URLs extracted from Vistocasa search page.",
        SCRAPER_CONFIG.vistocasa.searchUrl,
      );
      return [];
    }

    for (const [index, detailUrl] of detailUrls.entries()) {
      if (index > 0) {
        await delay(runtimeConfig.detailDelayMs);
      }

      try {
        const detailHtml = await fetchHtml(detailUrl);
        runLog.detailPagesRead += 1;
        const listing = normalizeListingFromDetail(detailUrl, detailHtml);

        if (listing) {
          listings.push(listing);
        }
      } catch (error) {
        logIssue(runLog, "parse", "Unable to read or parse Vistocasa detail page.", detailUrl, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return listings;
  },
  getLastRunLog() {
    return lastRunLog;
  },
};
