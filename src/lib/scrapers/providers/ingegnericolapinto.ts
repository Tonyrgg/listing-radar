import { SCRAPER_CONFIG, getScraperRuntimeConfig } from "@/lib/scrapers/config";
import { extractListingCoordinates } from "@/lib/listings/coordinates";
import { fetchHtml } from "@/lib/scrapers/html";
import { extractMetaTags } from "@/lib/scrapers/metadata";
import {
  cleanText,
  hashDescription,
  normalizeUrl,
  parseRooms,
  parseSqm,
} from "@/lib/scrapers/parsers";
import type {
  ListingsProvider,
  ProviderRunIssueType,
  ProviderRunLog,
} from "@/lib/scrapers/providers/types";
import type { NormalizedListing } from "@/types";

interface SitemapUrl {
  url: string;
  lastmod: string | null;
}

let lastRunLog: ProviderRunLog | null = null;

function createRunLog(): ProviderRunLog {
  return {
    provider: "ingegnericolapinto",
    searchUrls: [SCRAPER_CONFIG.ingegnericolapinto.searchUrl],
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

  console.warn(`[ingegnericolapinto] ${message}`, { url, details });
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractSitemapUrls(xml: string) {
  const urls = new Set<string>();

  for (const match of xml.matchAll(/<sitemap\b[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?<\/sitemap>/gi)) {
    const value = cleanText(match[1] ?? "");

    if (value) {
      urls.add(value);
    }
  }

  return [...urls];
}

function extractUrlEntries(xml: string): SitemapUrl[] {
  const entries: SitemapUrl[] = [];

  for (const match of xml.matchAll(/<url\b[\s\S]*?<\/url>/gi)) {
    const block = match[0];
    const url = cleanText(block.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1] ?? "");

    if (!url) {
      continue;
    }

    entries.push({
      url,
      lastmod: cleanText(block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1] ?? "") || null,
    });
  }

  return entries;
}

function isPotentialBitontoListing(entry: SitemapUrl) {
  const path = decodeURIComponent(entry.url).toLowerCase();

  if (!path.includes("/blog-detail/post/") || !path.includes("bitonto")) {
    return false;
  }

  return /\b(appartamento|appartamenti|apartment|apartments|vani|vendita)\b/i.test(path);
}

function extractSourceListingId(url: string) {
  return new URL(url).pathname.match(/\/post\/(\d+)\//)?.[1] ?? new URL(url).pathname;
}

function dedupeEntriesByPostId(entries: SitemapUrl[]) {
  const deduped = new Map<string, SitemapUrl>();

  for (const entry of entries) {
    const id = extractSourceListingId(entry.url);
    const existing = deduped.get(id);

    if (!existing || (entry.lastmod ?? "") > (existing.lastmod ?? "")) {
      deduped.set(id, entry);
    }
  }

  return [...deduped.values()];
}

function normalizeImageUrl(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value, SCRAPER_CONFIG.ingegnericolapinto.baseUrl);
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeTitle(value: string | undefined) {
  return cleanText(value ?? "")
    .replace(/\s+-\s+Ingegneri Colapinto\s*$/i, "")
    .trim();
}

function normalizeListingFromDetail(
  url: string,
  html: string,
  sitemapLastmod: string | null,
): NormalizedListing {
  const meta = extractMetaTags(html);
  const canonicalUrl = normalizeUrl(meta["og:url"] ?? url);
  const title = normalizeTitle(meta["og:title"] ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const description = cleanText(meta["og:description"] ?? "") || null;

  if (!title) {
    throw new Error("Missing listing title.");
  }

  const imageUrl = normalizeImageUrl(meta["og:image"] ?? meta["twitter:image"]);
  const now = new Date().toISOString();
  const contentForParsers = [title, description].filter(Boolean).join(" ");
  const addressRaw = description && /(?:via|piazza|strada|corso|viale)\b/i.test(description)
    ? description
    : title;
  const coordinates = extractListingCoordinates({
    html,
    meta,
    source: "ingegnericolapinto",
  });

  return {
    source: "ingegnericolapinto",
    sourceListingId: extractSourceListingId(canonicalUrl),
    url: canonicalUrl,
    canonicalUrl,
    title,
    description,
    price: null,
    sqm: parseSqm(contentForParsers),
    rooms: parseRooms(contentForParsers),
    floor:
      contentForParsers.match(/\bpiano\s+(terra|rialzato|seminterrato|interrato|primo|secondo|terzo|quarto|[0-9]{1,2})\b/i)?.[1] ??
      null,
    zone: SCRAPER_CONFIG.monitoredCity,
    addressRaw,
    latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null,
    coordinatesSource: coordinates?.source ?? null,
    sellerType: "agency",
    sellerName: "Ingegneri Colapinto",
    phone: "0803745086",
    imageUrls: imageUrl ? [imageUrl] : [],
    portalDeclaredDate: sitemapLastmod,
    metadataDatePublished: sitemapLastmod,
    metadataDateModified: sitemapLastmod,
    firstSeenAt: now,
    lastSeenAt: now,
    checkedAt: now,
    status: "new",
    rawPayload: {
      provider: "ingegnericolapinto",
      extractedAt: now,
      meta,
      sitemapLastmod,
      coordinates,
      descriptionHash: hashDescription(description),
      note: "Flazio page: static HTML exposes only metadata, not the full rendered body.",
    },
  };
}

export const ingegneriColapintoProvider: ListingsProvider = {
  name: "ingegnericolapinto",
  async fetchListings(): Promise<NormalizedListing[]> {
    const runtimeConfig = getScraperRuntimeConfig();
    const runLog = createRunLog();
    const listings: NormalizedListing[] = [];

    lastRunLog = runLog;

    let sitemapIndexXml: string;

    try {
      sitemapIndexXml = await fetchHtml(SCRAPER_CONFIG.ingegnericolapinto.searchUrl);
    } catch (error) {
      logIssue(runLog, "fetch", "Unable to fetch Ingegneri Colapinto blog sitemap.", SCRAPER_CONFIG.ingegnericolapinto.searchUrl, {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const sitemapUrls = extractSitemapUrls(sitemapIndexXml);
    const entries: SitemapUrl[] = [];

    for (const sitemapUrl of sitemapUrls) {
      try {
        const sitemapXml = await fetchHtml(sitemapUrl);
        entries.push(...extractUrlEntries(sitemapXml));
      } catch (error) {
        logIssue(runLog, "fetch", "Unable to fetch Ingegneri Colapinto child sitemap.", sitemapUrl, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const detailEntries = dedupeEntriesByPostId(entries)
      .filter(isPotentialBitontoListing)
      .sort((a, b) => (b.lastmod ?? "").localeCompare(a.lastmod ?? ""));

    runLog.foundUrls = detailEntries.length;

    if (detailEntries.length === 0) {
      logIssue(
        runLog,
        "search",
        "No Bitonto sale-like listing URLs extracted from Ingegneri Colapinto sitemap.",
        SCRAPER_CONFIG.ingegnericolapinto.searchUrl,
        { sitemapUrls: sitemapUrls.length, entries: entries.length },
      );
      return [];
    }

    for (const [index, entry] of detailEntries.slice(0, runtimeConfig.maxDetailPages).entries()) {
      if (index > 0) {
        await delay(runtimeConfig.detailDelayMs);
      }

      try {
        const detailHtml = await fetchHtml(entry.url);
        runLog.detailPagesRead += 1;
        listings.push(normalizeListingFromDetail(entry.url, detailHtml, entry.lastmod));
      } catch (error) {
        logIssue(runLog, "parse", "Unable to read or parse Ingegneri Colapinto detail page.", entry.url, {
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
