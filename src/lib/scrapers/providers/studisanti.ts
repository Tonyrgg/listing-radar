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
    provider: "studisanti",
    searchUrls: [SCRAPER_CONFIG.studisanti.searchUrl],
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

  console.warn(`[studisanti] ${message}`, { url, details });
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractListingUrlsFromSitemap(xml: string) {
  const urls = new Set<string>();

  for (const match of xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)) {
    const value = cleanText(match[1]);

    if (!/\/it\/Vendite\/bitonto\//i.test(value)) {
      continue;
    }

    try {
      const url = new URL(value.replace(/^http:\/\//i, "https://"));
      urls.add(normalizeUrl(url.toString()));
    } catch {
      // Ignore malformed sitemap entries.
    }
  }

  return [...urls].reverse();
}

function extractHtmlTitle(html: string, metaTitle: string | undefined) {
  const headingMatch = html.match(
    /<div\b[^>]*class=["'][^"']*\bpage-header\b[^"']*["'][^>]*>[\s\S]*?<h1\b[^>]*>([\s\S]*?)<\/h1>/i,
  );
  const heading = headingMatch?.[1] ? stripHtml(headingMatch[1]) : null;
  const title = heading ?? cleanText(metaTitle).replace(/^Studi Santi Immobiliare\s*\|\s*/i, "");

  return title.trim();
}

function extractSourceListingId(url: string, html: string) {
  const codeFromBreadcrumb = html.match(/Codice:\s*([A-Z]\d+)/i)?.[1];
  const codeFromUrl = new URL(url).pathname.match(/\/([avm]\d+)\/\d+\/?$/i)?.[1];
  const numericId = new URL(url).pathname.match(/\/(\d+)\/?$/)?.[1];

  return codeFromBreadcrumb ?? codeFromUrl?.toUpperCase() ?? numericId ?? null;
}

function extractDescription(html: string, fallback: string | undefined) {
  const match = html.match(
    /<p\b[^>]*class=["'][^"']*\bdescrizione-immobile\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
  );
  const description = match?.[1] ? stripHtml(match[1]) : null;

  return description || cleanText(fallback) || null;
}

function extractDetailsText(html: string) {
  const match = html.match(
    /<div\b[^>]*class=["'][^"']*\bwidget-details-reservation\b[^"']*["'][^>]*>([\s\S]*?)<\/aside>/i,
  );

  return match?.[1] ? stripHtml(match[1]) : "";
}

function extractDetailValue(detailsText: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = detailsText.match(new RegExp(`${escaped}:\\s*([^:]+?)(?=\\s+(?:Mq|Locali|Camere|Bagni|Piano|Classe):|\\s*$)`, "i"));

  return match?.[1]?.trim() ?? null;
}

function extractZone(detailsText: string) {
  const firstLocation = detailsText.match(/\b(Bitonto)\b/i)?.[1];

  return firstLocation?.trim() || SCRAPER_CONFIG.monitoredCity;
}

function extractPrice(html: string) {
  const match = html.match(
    /<div\b[^>]*class=["'][^"']*\bprezzo\b[^"']*["'][^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>/i,
  );
  const text = match?.[1]
    ? stripHtml(match[1]).replace(/&euro;|€|eur/i, " euro")
    : null;

  return parsePrice(text);
}

function extractImageUrls(html: string) {
  const urls = new Set<string>();
  const imagePattern =
    /\b(?:href|src)=["']([^"']*\/preview\/imm_[^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi;

  for (const match of html.matchAll(imagePattern)) {
    const value = match[1];

    if (!value) {
      continue;
    }

    try {
      const url = new URL(value, SCRAPER_CONFIG.studisanti.baseUrl);
      url.search = "";

      if (!/-50-50-|-150-150-/i.test(url.pathname)) {
        urls.add(url.toString());
      }
    } catch {
      // Ignore malformed image URLs.
    }
  }

  const ogImage = extractMetaTags(html)["og:image"];

  if (ogImage) {
    try {
      const url = new URL(ogImage, SCRAPER_CONFIG.studisanti.baseUrl);
      url.search = "";
      urls.add(url.toString());
    } catch {
      // Ignore malformed image URLs.
    }
  }

  return [...urls].slice(0, 40);
}

function extractPhone(html: string) {
  const text = stripHtml(html);
  const match = text.match(/(?:Telefono|WhatsApp)\s*:\s*(\+?39\s*)?([0-9][0-9\s.]{7,})/i);

  return match?.[0]?.replace(/^(?:Telefono|WhatsApp)\s*:\s*/i, "").replace(/\s+/g, " ").trim() ?? null;
}

function normalizeListingFromDetail(url: string, html: string): NormalizedListing {
  const meta = extractMetaTags(html);
  const canonicalUrl = normalizeUrl(new URL(meta.canonical ?? meta["og:url"] ?? url, SCRAPER_CONFIG.studisanti.baseUrl).toString());
  const title = extractHtmlTitle(html, meta["og:title"]);

  if (!title) {
    throw new Error("Missing listing title.");
  }

  const detailsText = extractDetailsText(html);
  const description = extractDescription(html, meta["og:description"]);
  const now = new Date().toISOString();
  const sqm = parseSqm(extractDetailValue(detailsText, "Mq") ? `${extractDetailValue(detailsText, "Mq")} mq` : null);
  const rooms = parseRooms(
    extractDetailValue(detailsText, "Locali")
      ? `${extractDetailValue(detailsText, "Locali")} locali`
      : title,
  );
  const floor = extractDetailValue(detailsText, "Piano");
  const coordinates = extractListingCoordinates({
    html,
    meta,
    source: "studisanti",
  });

  return {
    source: "studisanti",
    sourceListingId: extractSourceListingId(canonicalUrl, html),
    url: canonicalUrl,
    canonicalUrl,
    title,
    description,
    price: extractPrice(html),
    sqm,
    rooms,
    floor,
    zone: extractZone(detailsText),
    addressRaw: html.match(/<div\b[^>]*class=["'][^"']*\bindirizzo\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
      ? stripHtml(html.match(/<div\b[^>]*class=["'][^"']*\bindirizzo\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "")
      : extractZone(detailsText),
    latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null,
    coordinatesSource: coordinates?.source ?? null,
    sellerType: "agency",
    sellerName: "Studi Santi Immobiliare",
    phone: extractPhone(html),
    imageUrls: extractImageUrls(html),
    portalDeclaredDate: null,
    metadataDatePublished: null,
    metadataDateModified: null,
    firstSeenAt: now,
    lastSeenAt: now,
    checkedAt: now,
    status: "new",
    rawPayload: {
      provider: "studisanti",
      extractedAt: now,
      meta,
      detailsText,
      coordinates,
      descriptionHash: hashDescription(description),
      extra: {
        camere: extractDetailValue(detailsText, "Camere"),
        bagni: extractDetailValue(detailsText, "Bagni"),
        classe: extractDetailValue(detailsText, "Classe"),
      },
    },
  };
}

export const studiSantiProvider: ListingsProvider = {
  name: "studisanti",
  async fetchListings(): Promise<NormalizedListing[]> {
    const runtimeConfig = getScraperRuntimeConfig();
    const runLog = createRunLog();
    const listings: NormalizedListing[] = [];

    lastRunLog = runLog;

    let sitemapXml: string;

    try {
      sitemapXml = await fetchHtml(SCRAPER_CONFIG.studisanti.searchUrl);
    } catch (error) {
      logIssue(runLog, "fetch", "Unable to fetch Studi Santi sitemap.", SCRAPER_CONFIG.studisanti.searchUrl, {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const extractedDetailUrls = extractListingUrlsFromSitemap(sitemapXml);
    const detailUrls = extractedDetailUrls.slice(
      0,
      runtimeConfig.maxDetailPages,
    );

    runLog.foundUrls = extractedDetailUrls.length;

    if (detailUrls.length === 0) {
      logIssue(
        runLog,
        "search",
        "No listing URLs extracted from Studi Santi sitemap.",
        SCRAPER_CONFIG.studisanti.searchUrl,
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
        listings.push(normalizeListingFromDetail(detailUrl, detailHtml));
      } catch (error) {
        logIssue(runLog, "parse", "Unable to read or parse Studi Santi detail page.", detailUrl, {
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
