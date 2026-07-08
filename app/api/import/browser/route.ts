import { timingSafeEqual } from "node:crypto";

import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import {
  findIncomingListing,
  markIncomingListingEnriched,
} from "@/lib/incoming/repository";
import {
  getListingCompletenessScore,
  getMissingListingFields,
  hasRequiredListingGaps,
} from "@/lib/listings/completeness";
import {
  inferListingSourceFromUrl,
  isGenericListingSource,
  normalizeListingSource,
} from "@/lib/listing-sources";
import { upsertListings } from "@/lib/listings/upsert-listings";
import {
  normalizeImportedRows,
} from "@/lib/scrapers/import-normalizer";
import { normalizeUrl } from "@/lib/scrapers/parsers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "Unauthorized." },
    { status: 401, headers: CORS_HEADERS },
  );
}

function isAuthorized(request: NextRequest) {
  const configuredToken = process.env.EXTENSION_API_TOKEN?.trim();
  const suppliedToken = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();

  if (!configuredToken || !suppliedToken) {
    return false;
  }

  const expected = Buffer.from(configuredToken);
  const supplied = Buffer.from(suppliedToken);

  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorized();
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentLength > 2_000_000) {
    return NextResponse.json(
      { ok: false, error: "Payload too large." },
      { status: 413, headers: CORS_HEADERS },
    );
  }

  try {
    const body = asRecord(await request.json());

    if (!body) {
      throw new Error("Invalid JSON payload.");
    }

    const incomingId = readOptionalString(body.incomingId);
    const rawSource = readOptionalString(body.source);
    const sourceListingId = readOptionalString(body.sourceListingId);
    const canonicalUrlValue =
      readOptionalString(body.canonicalUrl) ?? readOptionalString(body.url);
    const canonicalUrl = canonicalUrlValue
      ? normalizeUrl(canonicalUrlValue)
      : null;
    const normalizedSource = rawSource
      ? normalizeListingSource(rawSource)
      : null;
    const source =
      normalizedSource && !isGenericListingSource(normalizedSource)
        ? normalizedSource
        : inferListingSourceFromUrl(canonicalUrl);
    const incoming = await findIncomingListing({
      incomingId,
      source,
      sourceListingId,
      canonicalUrl,
    });
    const capturedAt = new Date().toISOString();
    const mergedRow = {
      ...body,
      source: source ?? incoming?.source ?? rawSource ?? "browser",
      sourceListingId: sourceListingId ?? incoming?.sourceListingId,
      url: canonicalUrl ?? incoming?.canonicalUrl ?? incoming?.url,
      canonicalUrl: canonicalUrl ?? incoming?.canonicalUrl ?? incoming?.url,
      title: readOptionalString(body.title) ?? incoming?.title,
      description:
        readOptionalString(body.description) ?? incoming?.description,
      price: body.price ?? incoming?.price,
      sqm: body.sqm ?? incoming?.sqm,
      rooms: body.rooms ?? incoming?.rooms,
      zone: readOptionalString(body.zone) ?? incoming?.zone,
      imageUrls:
        body.imageUrls ??
        body.images ??
        (readOptionalString(body.imageUrl)
          ? [readOptionalString(body.imageUrl)]
          : incoming?.imageUrl
            ? [incoming.imageUrl]
            : []),
      firstSeenAt: incoming?.emailReceivedAt ?? incoming?.createdAt,
      lastSeenAt: capturedAt,
      checkedAt: capturedAt,
      status: "new",
      rawPayload: {
        provider: "browser-extension",
        incomingId: incoming?.id ?? incomingId,
        capturedAt,
        pageMetadata: asRecord(body.rawPayload),
      },
    };
    const normalized = normalizeImportedRows([mergedRow], {
      provider: "browser-extension",
      defaultSource: source ?? incoming?.source ?? rawSource ?? "browser",
    });

    if (!normalized.listings.length) {
      return NextResponse.json(
        {
          ok: false,
          error: normalized.errors[0]?.message ?? "Unable to normalize listing.",
        },
        { status: 422, headers: CORS_HEADERS },
      );
    }

    const listingToSave = normalized.listings[0];
    const missingFields = getMissingListingFields(listingToSave);
    const completenessScore = getListingCompletenessScore(listingToSave);

    if (hasRequiredListingGaps(listingToSave)) {
      listingToSave.status = "review";
      listingToSave.note = [
        listingToSave.note,
        `Campi da completare dopo import: ${missingFields
          .map((field) => field.label)
          .join(", ")}.`,
      ]
        .filter(Boolean)
        .join("\n");
    }

    const result = await upsertListings(normalized.listings);
    const savedListing = result.listings[0];

    if (!savedListing) {
      throw new Error("Listing was not persisted.");
    }

    if (incoming) {
      await markIncomingListingEnriched(incoming.id, savedListing.id);
    }

    revalidatePath("/listings");
    revalidatePath(`/listings/${savedListing.id}`);
    revalidatePath("/incoming");
    revalidatePath("/dashboard");
    revalidatePath("/map");

    return NextResponse.json(
      {
        ok: true,
        listingId: savedListing.id,
        incomingId: incoming?.id ?? null,
        inserted: result.inserted,
        updated: result.updated,
        detailUrl: `/listings/${savedListing.id}`,
        completenessScore,
        missingFields,
      },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Browser import failed.",
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
