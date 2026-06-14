import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ParsedEmailAlert } from "@/lib/email-alerts/types";
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

function mapIncomingListing(row: IncomingListingRow): IncomingListing {
  return {
    id: row.id,
    source: row.source,
    sourceListingId: row.source_listing_id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    description: row.description,
    price: row.price,
    sqm: row.sqm,
    rooms: row.rooms,
    zone: row.zone,
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

    return (data as IncomingListingRow[]).map(mapIncomingListing);
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
        .select("*", { count: "exact" })
        .eq("status", "pending")
        .order("email_received_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("incoming_listings")
        .select("id", { count: "exact", head: true })
        .gte("email_received_at", since),
      supabase
        .from("email_ingestion_messages")
        .select("processed_at, status, listings_found")
        .order("processed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      pendingCount: pendingResult.count ?? 0,
      recentCount: recentResult.count ?? 0,
      pendingListings: pendingResult.error
        ? []
        : ((pendingResult.data ?? []) as IncomingListingRow[]).map(
            mapIncomingListing,
          ),
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
      status: existing?.status === "enriched" ? "enriched" : "pending",
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
