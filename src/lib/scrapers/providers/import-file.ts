import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { SCRAPER_CONFIG } from "@/lib/scrapers/config";
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

function getImportPath() {
  const configuredPath =
    process.env.SCRAPER_IMPORT_PATH?.trim() ||
    SCRAPER_CONFIG.sources.import.defaultPath;

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(/*turbopackIgnore: true*/ process.cwd(), configuredPath);
}

function getFormatHint(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".csv") {
    return "csv";
  }

  if (extension === ".tsv") {
    return "tsv";
  }

  return "json";
}

function createRunLog(filePath: string): ProviderRunLog {
  return {
    provider: "import",
    searchUrls: [filePath],
    foundUrls: 0,
    detailPagesRead: 0,
    errors: [],
  };
}

export const importFileProvider: ListingsProvider = {
  name: "import",
  async fetchListings(): Promise<NormalizedListing[]> {
    const importPath = getImportPath();
    const runLog = createRunLog(importPath);

    lastRunLog = runLog;

    if (!existsSync(importPath)) {
      runLog.errors.push({
        type: "config",
        message: "Import file not found.",
        details: {
          path: importPath,
          env: "SCRAPER_IMPORT_PATH",
        },
      });
      return [];
    }

    try {
      const content = await readFile(importPath, "utf8");
      const rows = parseImportPayload(content, getFormatHint(importPath));
      const normalized = normalizeImportedRows(rows, {
        provider: "import",
        defaultSource: "import",
      });

      runLog.foundUrls = rows.length;
      runLog.errors.push(...normalized.errors);

      return normalized.listings;
    } catch (error) {
      const issue: ProviderRunIssue = {
        type: "parse",
        message: "Unable to read or parse import file.",
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
