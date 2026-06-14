import { parseItalianDate } from "@/lib/scrapers/date-parser";
import {
  cleanText,
  normalizeUrl,
  parsePrice,
  parseRooms,
  parseSqm,
} from "@/lib/scrapers/parsers";
import type { ProviderRunIssue } from "@/lib/scrapers/providers/types";
import type { NormalizedListing, SellerType } from "@/types";

type RawRow = Record<string, unknown>;

const SELLER_TYPES = new Set<SellerType>(["private", "agency", "unknown"]);

function isObject(value: unknown): value is RawRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getValue(row: RawRow, keys: string[]) {
  for (const key of keys) {
    if (row[key] != null) {
      return row[key];
    }
  }

  return null;
}

function toStringValue(value: unknown) {
  if (typeof value === "string") {
    const cleaned = cleanText(value);
    return cleaned.length ? cleaned : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function toNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const direct = Number(value.replace(/\./g, "").replace(",", ".").trim());

  if (Number.isFinite(direct)) {
    return direct;
  }

  return parsePrice(value);
}

function toIntegerValue(value: unknown) {
  const numberValue = toNumberValue(value);
  return numberValue == null ? null : Math.round(numberValue);
}

function toSqmValue(value: unknown) {
  const numberValue = toIntegerValue(value);

  if (numberValue != null) {
    return numberValue;
  }

  return typeof value === "string" ? parseSqm(value) : null;
}

function toRoomsValue(value: unknown) {
  const numberValue = toNumberValue(value);

  if (numberValue != null) {
    return numberValue;
  }

  return typeof value === "string" ? parseRooms(value) : null;
}

function toDateValue(value: unknown) {
  const stringValue = toStringValue(value);

  if (!stringValue) {
    return null;
  }

  return parseItalianDate(stringValue);
}

function toBooleanValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "si", "s\u00ec"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
  }

  return null;
}

function toStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(toStringValue).filter((item): item is string => Boolean(item));
  }

  const stringValue = toStringValue(value);

  if (!stringValue) {
    return [];
  }

  return stringValue
    .split(/[;\n]/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function toSellerType(value: unknown) {
  const stringValue = toStringValue(value)?.toLowerCase();

  if (stringValue && SELLER_TYPES.has(stringValue as SellerType)) {
    return stringValue as SellerType;
  }

  return "unknown";
}

export function parseDelimitedRows(input: string) {
  const delimiter = input.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let current = "";
  let currentRow: string[] = [];
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      currentRow.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      currentRow.push(current);
      rows.push(currentRow);
      currentRow = [];
      current = "";
      continue;
    }

    current += char;
  }

  currentRow.push(current);
  rows.push(currentRow);

  const [headers, ...dataRows] = rows.filter((row) =>
    row.some((cell) => cell.trim().length > 0),
  );

  if (!headers?.length) {
    return [];
  }

  return dataRows.map((row) =>
    headers.reduce<RawRow>((record, header, index) => {
      record[cleanText(header)] = cleanText(row[index] ?? "");
      return record;
    }, {}),
  );
}

export function parseImportPayload(content: string, formatHint = "json") {
  if (formatHint === "csv" || formatHint === "tsv") {
    return parseDelimitedRows(content);
  }

  const parsed = JSON.parse(content) as unknown;

  if (Array.isArray(parsed)) {
    return parsed.filter(isObject);
  }

  if (isObject(parsed) && Array.isArray(parsed.listings)) {
    return parsed.listings.filter(isObject);
  }

  return [];
}

export function normalizeImportedRows(
  rows: RawRow[],
  options: {
    provider: string;
    defaultSource?: string;
  },
) {
  const listings: NormalizedListing[] = [];
  const errors: ProviderRunIssue[] = [];
  const now = new Date().toISOString();

  rows.forEach((row, index) => {
    const urlValue = toStringValue(getValue(row, ["url", "URL", "link", "Link"]));
    const title = toStringValue(getValue(row, ["title", "titolo", "Title"]));

    if (!urlValue || !title) {
      errors.push({
        type: "parse",
        message: "Imported row skipped: missing url or title.",
        details: { index, row },
      });
      return;
    }

    let url: string;

    try {
      url = normalizeUrl(urlValue);
    } catch {
      errors.push({
        type: "parse",
        message: "Imported row skipped: invalid url.",
        details: { index, url: urlValue },
      });
      return;
    }

    const source =
      toStringValue(getValue(row, ["source", "fonte", "portal"])) ??
      options.defaultSource ??
      options.provider;
    const description = toStringValue(
      getValue(row, ["description", "descrizione", "body"]),
    );
    const checkedAt =
      toDateValue(getValue(row, ["checkedAt", "checked_at"])) ?? now;

    listings.push({
      source,
      sourceListingId: toStringValue(
        getValue(row, ["sourceListingId", "source_listing_id", "externalId", "id"]),
      ),
      url,
      canonicalUrl:
        toStringValue(getValue(row, ["canonicalUrl", "canonical_url"])) ?? url,
      title,
      description,
      price: toIntegerValue(getValue(row, ["price", "prezzo"])),
      sqm: toSqmValue(getValue(row, ["sqm", "mq", "surface", "superficie"])),
      rooms: toRoomsValue(getValue(row, ["rooms", "locali", "vani"])),
      floor: toStringValue(getValue(row, ["floor", "piano"])),
      zone: toStringValue(getValue(row, ["zone", "zona", "city", "comune"])),
      addressRaw: toStringValue(
        getValue(row, ["addressRaw", "address_raw", "address", "indirizzo"]),
      ),
      sellerType: toSellerType(getValue(row, ["sellerType", "seller_type"])),
      sellerName: toStringValue(getValue(row, ["sellerName", "seller_name"])),
      phone: toStringValue(getValue(row, ["phone", "telefono"])),
      imageUrls: toStringArray(
        getValue(row, [
          "imageUrls",
          "image_urls",
          "images",
          "photos",
          "foto",
          "imageUrl",
          "image_url",
          "image",
        ]),
      ),
      portalDeclaredDate: toDateValue(
        getValue(row, ["portalDeclaredDate", "portal_declared_date"]),
      ),
      metadataDatePublished: toDateValue(
        getValue(row, [
          "metadataDatePublished",
          "metadata_date_published",
          "publishedAt",
        ]),
      ),
      metadataDateModified: toDateValue(
        getValue(row, [
          "metadataDateModified",
          "metadata_date_modified",
          "modifiedAt",
        ]),
      ),
      firstSeenAt: toDateValue(getValue(row, ["firstSeenAt", "first_seen_at"])),
      lastSeenAt: toDateValue(getValue(row, ["lastSeenAt", "last_seen_at"])),
      checkedAt,
      status: toStringValue(getValue(row, ["status", "stato"])) ?? "new",
      note: toStringValue(getValue(row, ["note", "notes", "nota"])),
      previousPrice: toIntegerValue(
        getValue(row, ["previousPrice", "previous_price", "prezzo_precedente"]),
      ),
      isRepublishedSuspected:
        toBooleanValue(
          getValue(row, ["isRepublishedSuspected", "is_republished_suspected"]),
        ) ?? false,
      previousUrls: toStringArray(getValue(row, ["previousUrls", "previous_urls"])),
      rawPayload: {
        provider: options.provider,
        importedAt: now,
        row,
      },
    });
  });

  return { listings, errors };
}
