import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ParsedEmailAlert } from "@/lib/email-alerts/types";
import { cleanText, parsePrice } from "@/lib/scrapers/parsers";
import type { IncomingListing, IncomingListingStatus } from "@/types";

type IncomingListingRow = {
  id: string;
  source: string;
  source_listing_id: string | null;
  url: string;
  canonical_url: string | null;
  title: string;
  description: string | null;
  price: number | null;
  sqm: number | null;
  rooms: number | null;
  zone: string | null;
  image_url: string | null;
  email_message_id: string | null;
  email_subject: string | null;
  email_sender: string | null;
  email_received_at: string | null;
  status: IncomingListingStatus;
  listing_id: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

const MONITORED_CITY_PATTERN = /\bBitonto\b/i;

function incomingRawPayloadText(rawPayload: Record<string, unknown> | null) {
  if (!rawPayload) {
    return "";
  }

  const values: string[] = [];
  const anchorTexts = rawPayload.anchorTexts;

  if (Array.isArray(anchorTexts)) {
    values.push(
      ...anchorTexts.filter((value): value is string => typeof value === "string"),
    );
  }

  return values.join(" ");
}

function isMonitoredIncomingRow(row: IncomingListingRow) {
  return MONITORED_CITY_PATTERN.test(
    [
      row.title,
      row.zone,
      incomingRawPayloadText(row.raw_payload),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function isMonitoredIncomingAlert(alert: ParsedEmailAlert) {
  return MONITORED_CITY_PATTERN.test(
    [
      alert.title,
      alert.zone,
      incomingRawPayloadText(alert.rawPayload ?? null),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function recoverIncomingPrice(row: IncomingListingRow) {
  const rawPayloadContext =
    typeof row.raw_payload?.context === "string" ? row.raw_payload.context : null;
  const rawPayloadAnchors = Array.isArray(row.raw_payload?.anchorTexts)
    ? row.raw_payload.anchorTexts.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const recoveredPrice =
    parsePrice([rawPayloadContext, ...rawPayloadAnchors].filter(Boolean).join(" ")) ??
    parsePrice(
      [row.description, row.zone, row.title].filter(Boolean).join(" "),
    );

  if (row.price != null) {
    if (row.price > 0 && row.price < 1000 && recoveredPrice != null) {
      return recoveredPrice;
    }

    return row.price;
  }

  return recoveredPrice;
}

function normalizeIncomingZone(value: string | null) {
  if (!value) {
    return null;
  }

  const zone = cleanText(value)
    .replace(/\s*(?:\u20ac\s*|(?:eur|euro)\b).*$/i, "")
    .replace(/\s+(?:\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,\d{1,2})?\s*(?:\u20ac|eur|euro)\b.*$/i, "")
    .replace(/\s+\d+(?:[,.]\d+)?\s*(?:m\u00b2|mq|m2|metri\s+quadri|locali|locale|vani|vano|stanze|stanza|bagni|bagno)\b.*$/i, "");

  return zone || null;
}

function mapIncomingListing(row: IncomingListingRow): IncomingListing {
  return {
    id: row.id,
    source: row.source,
    sourceListingId: row.source_listing_id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    description: row.description,
    price: recoverIncomingPrice(row),
    sqm: row.sqm,
    rooms: row.rooms,
    zone: normalizeIncomingZone(row.zone),
    imageUrl: row.image_url,
    emailMessageId: row.email_message_id,
    emailSubject: row.email_subject,
    emailSender: row.email_sender,
    emailReceivedAt: row.email_received_at,
    status: row.status,
    listingId: row.listing_id,
    rawPayload: row.raw_payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getIncomingListings(
  status: IncomingListingStatus | "all" = "pending",
) {
  try {
    const supabase = getSupabaseServiceClient();
    let query = supabase
      .from("incoming_listings")
      .select("*")
      .order("email_received_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error || !data) {
      return [];
    }

    return (data as IncomingListingRow[])
      .filter(isMonitoredIncomingRow)
      .map(mapIncomingListing);
  } catch {
    return [];
  }
}

export async function getIncomingDashboardData(limit = 4) {
  const fallback = {
    pendingCount: 0,
    recentCount: 0,
    pendingListings: [] as IncomingListing[],
    lastEmailCheck: null as null | {
      processedAt: string;
      status: string;
      listingsFound: number;
    },
  };

  try {
    const supabase = getSupabaseServiceClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [pendingResult, recentResult, lastEmailResult] = await Promise.all([
      supabase
        .from("incoming_listings")
        .select("*")
        .eq("status", "pending")
        .order("email_received_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("incoming_listings")
        .select("*")
        .gte("email_received_at", since),
      supabase
        .from("email_ingestion_messages")
        .select("processed_at, status, listings_found")
        .order("processed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const pendingRows = pendingResult.error
      ? []
      : ((pendingResult.data ?? []) as IncomingListingRow[]).filter(
          isMonitoredIncomingRow,
        );
    const recentRows = recentResult.error
      ? []
      : ((recentResult.data ?? []) as IncomingListingRow[]).filter(
          isMonitoredIncomingRow,
        );

    return {
      pendingCount: pendingRows.length,
      recentCount: recentRows.length,
      pendingListings: pendingRows.slice(0, limit).map(mapIncomingListing),
      lastEmailCheck:
        lastEmailResult.error || !lastEmailResult.data
          ? null
          : {
              processedAt: lastEmailResult.data.processed_at as string,
              status: lastEmailResult.data.status as string,
              listingsFound: lastEmailResult.data.listings_found as number,
            },
    };
  } catch {
    return fallback;
  }
}

export async function isEmailMessageProcessed(messageId: string) {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("email_ingestion_messages")
    .select("message_id")
    .eq("message_id", messageId)
    .maybeSingle();

  return Boolean(data);
}

export async function recordEmailMessage(input: {
  messageId: string;
  sender: string;
  subject: string;
  receivedAt: string;
  status: "processed" | "ignored" | "error";
  listingsFound: number;
  errorMessage?: string | null;
}) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("email_ingestion_messages").upsert({
    message_id: input.messageId,
    sender: input.sender,
    subject: input.subject,
    received_at: input.receivedAt,
    status: input.status,
    listings_found: input.listingsFound,
    error_message: input.errorMessage ?? null,
    processed_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Unable to record email ingestion: ${error.message}`);
  }
}

async function findExistingIncoming(alert: ParsedEmailAlert) {
  const supabase = getSupabaseServiceClient();

  if (alert.sourceListingId) {
    const { data } = await supabase
      .from("incoming_listings")
      .select("*")
      .eq("source", alert.source)
      .eq("source_listing_id", alert.sourceListingId)
      .maybeSingle();

    if (data) {
      return data as IncomingListingRow;
    }
  }

  const { data } = await supabase
    .from("incoming_listings")
    .select("*")
    .eq("canonical_url", alert.canonicalUrl)
    .maybeSingle();

  return (data as IncomingListingRow | null) ?? null;
}

export async function upsertIncomingAlerts(
  alerts: ParsedEmailAlert[],
  email: {
    messageId: string;
    subject: string;
    sender: string;
    receivedAt: string;
  },
) {
  const supabase = getSupabaseServiceClient();
  let inserted = 0;
  let updated = 0;

  for (const alert of alerts) {
    if (!isMonitoredIncomingAlert(alert)) {
      continue;
    }

    const existing = await findExistingIncoming(alert);
    const payload = {
      source: alert.source,
      source_listing_id: alert.sourceListingId,
      url: alert.url,
      canonical_url: alert.canonicalUrl,
      title: alert.title,
      description: alert.description,
      price: alert.price,
      sqm: alert.sqm,
      rooms: alert.rooms,
      zone: alert.zone,
      image_url: alert.imageUrl ?? existing?.image_url ?? null,
      email_message_id: email.messageId,
      email_subject: email.subject,
      email_sender: email.sender,
      email_received_at: email.receivedAt,
      status:
        existing?.status === "enriched" || existing?.status === "dismissed"
          ? existing.status
          : "pending",
      listing_id: existing?.listing_id ?? null,
      raw_payload: {
        ...alert.rawPayload,
        emailMessageId: email.messageId,
      },
    };
    const { error } = existing
      ? await supabase
          .from("incoming_listings")
          .update(payload)
          .eq("id", existing.id)
      : await supabase.from("incoming_listings").insert(payload);

    if (error) {
      throw new Error(`Unable to persist incoming listing: ${error.message}`);
    }

    if (existing) {
      updated += 1;
    } else {
      inserted += 1;
    }
  }

  return { inserted, updated };
}

export async function findIncomingListing(input: {
  incomingId?: string | null;
  source?: string | null;
  sourceListingId?: string | null;
  canonicalUrl?: string | null;
}) {
  const supabase = getSupabaseServiceClient();

  if (input.incomingId) {
    const { data } = await supabase
      .from("incoming_listings")
      .select("*")
      .eq("id", input.incomingId)
      .maybeSingle();

    if (data) {
      return mapIncomingListing(data as IncomingListingRow);
    }
  }

  if (input.source && input.sourceListingId) {
    const { data } = await supabase
      .from("incoming_listings")
      .select("*")
      .eq("source", input.source)
      .eq("source_listing_id", input.sourceListingId)
      .maybeSingle();

    if (data) {
      return mapIncomingListing(data as IncomingListingRow);
    }
  }

  if (input.canonicalUrl) {
    const { data } = await supabase
      .from("incoming_listings")
      .select("*")
      .eq("canonical_url", input.canonicalUrl)
      .maybeSingle();

    if (data) {
      return mapIncomingListing(data as IncomingListingRow);
    }
  }

  return null;
}

export async function markIncomingListingEnriched(
  incomingId: string,
  listingId: string,
) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("incoming_listings")
    .update({
      status: "enriched",
      listing_id: listingId,
    })
    .eq("id", incomingId);

  if (error) {
    throw new Error(`Unable to update incoming listing: ${error.message}`);
  }
}

export async function updateIncomingListingStatus(
  incomingId: string,
  status: IncomingListingStatus,
) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("incoming_listings")
    .update({ status })
    .eq("id", incomingId);

  if (error) {
    throw new Error(`Unable to update incoming listing status: ${error.message}`);
  }
}
