import { getScraperUserAgent } from "@/lib/scrapers/html";
import {
  normalizeImportedRows,
  parseImportPayload,
} from "@/lib/scrapers/import-normalizer";
import type {
  ListingsProvider,
  ProviderRunIssue,
  ProviderRunLog,
} from "@/lib/scrapers/providers/types";
import type { NormalizedListing } from "@/types";

let lastRunLog: ProviderRunLog | null = null;

function createRunLog(url: string): ProviderRunLog {
  return {
    provider: "feed",
    searchUrls: url ? [url] : [],
    foundUrls: 0,
    detailPagesRead: 0,
    errors: [],
  };
}

function getFormatHint(url: string, contentType: string | null) {
  if (contentType?.includes("csv") || url.toLowerCase().endsWith(".csv")) {
    return "csv";
  }

  if (contentType?.includes("tab-separated") || url.toLowerCase().endsWith(".tsv")) {
    return "tsv";
  }

  return "json";
}

function getFeedHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/json,text/csv,text/tab-separated-values;q=0.9,*/*;q=0.8",
    "User-Agent": getScraperUserAgent(),
  };
  const token = process.env.SCRAPER_FEED_TOKEN?.trim();

  if (token) {
    const headerName = process.env.SCRAPER_FEED_AUTH_HEADER?.trim() || "Authorization";
    const prefix = process.env.SCRAPER_FEED_AUTH_PREFIX ?? "Bearer ";
    headers[headerName] = `${prefix}${token}`;
  }

  return headers;
}

export const feedProvider: ListingsProvider = {
  name: "feed",
  async fetchListings(): Promise<NormalizedListing[]> {
    const feedUrl = process.env.SCRAPER_FEED_URL?.trim() ?? "";
    const runLog = createRunLog(feedUrl);

    lastRunLog = runLog;

    if (!feedUrl) {
      runLog.errors.push({
        type: "config",
        message: "Missing SCRAPER_FEED_URL.",
        details: {
          env: "SCRAPER_FEED_URL",
        },
      });
      return [];
    }

    try {
      const response = await fetch(feedUrl, {
        cache: "no-store",
        headers: getFeedHeaders(),
      });
      const content = await response.text();

      if (!response.ok) {
        throw new Error(`Feed request failed with status ${response.status}.`);
      }

      const rows = parseImportPayload(
        content,
        getFormatHint(feedUrl, response.headers.get("content-type")),
      );
      const normalized = normalizeImportedRows(rows, {
        provider: "feed",
        defaultSource: "feed",
      });

      runLog.foundUrls = rows.length;
      runLog.errors.push(...normalized.errors);

      return normalized.listings;
    } catch (error) {
      const issue: ProviderRunIssue = {
        type: "fetch",
        message: "Unable to fetch or parse configured feed.",
        url: feedUrl,
        details:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: String(error) },
      };

      runLog.errors.push(issue);
      return [];
    }
  },
  getLastRunLog() {
    return lastRunLog;
  },
};
