"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import {
  calculatePricePerSqm,
  calculatePriorityScore,
  getMinimumDaysOnline,
  isPublishedToday,
} from "@/lib/listings/scoring";
import { getPersistedScoringConfig } from "@/lib/settings/scoring-config-repository";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ListingCrmStatus, SellerType } from "@/types";

function optionalString(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function updateListing(id: string, formData: FormData) {
  await requireUser();
  const supabase = getSupabaseServiceClient();
  const scoringConfig = await getPersistedScoringConfig();
  const { data: current, error } = await supabase.from("listings").select("*").eq("id", id).single();
  if (error || !current) throw new Error("Annuncio non trovato.");

  const price = optionalNumber(formData.get("price"));
  const sqm = optionalNumber(formData.get("sqm"));
  const description = optionalString(formData.get("description"));
  const phone = optionalString(formData.get("phone"));
  const sellerType = String(formData.get("sellerType") ?? "unknown") as SellerType;
  const crmStatus = String(
    formData.get("crmStatus") ?? current.crm_status ?? "untreated",
  ) as ListingCrmStatus;
  const isPriceDropped = current.price != null && price != null && price < current.price;
  const minimumDaysOnline = getMinimumDaysOnline({
    firstSeenAt: current.first_seen_at,
    portalDeclaredDate: current.portal_declared_date,
    metadataDatePublished: current.metadata_date_published,
  });
  const isNewToday = isPublishedToday({
    firstSeenAt: current.first_seen_at,
    portalDeclaredDate: current.portal_declared_date,
    metadataDatePublished: current.metadata_date_published,
  });
  const payload = {
    title: optionalString(formData.get("title")) ?? current.title,
    description,
    price,
    sqm,
    price_per_sqm: calculatePricePerSqm(price, sqm),
    rooms: optionalNumber(formData.get("rooms")),
    floor: optionalString(formData.get("floor")),
    zone: optionalString(formData.get("zone")),
    address_raw: optionalString(formData.get("addressRaw")),
    seller_type: sellerType,
    seller_name: optionalString(formData.get("sellerName")),
    phone,
    status: optionalString(formData.get("status")) ?? current.status,
    crm_status: crmStatus,
    is_price_dropped: current.is_price_dropped || isPriceDropped,
    is_new_today: isNewToday,
    priority_score: calculatePriorityScore(
      {
        sellerType,
        isNewToday,
        hasPhone: Boolean(phone),
        minimumDaysOnline,
        isPriceDropped: current.is_price_dropped || isPriceDropped,
        description,
        price,
        sqm,
      },
      scoringConfig,
    ),
  };

  if (current.price !== price) {
    await supabase.from("listing_snapshots").insert({
      listing_id: id,
      checked_at: new Date().toISOString(),
      source: current.source,
      url: current.url,
      price,
      title: payload.title,
      is_available: true,
      raw_payload: { origin: "manual-edit", previousPrice: current.price },
    });
  }

  const note = optionalString(formData.get("note"));
  if (note) await supabase.from("listing_notes").insert({ listing_id: id, note });

  const { error: updateError } = await supabase.from("listings").update(payload).eq("id", id);
  if (updateError) throw new Error("Salvataggio non riuscito.");

  revalidatePath(`/listings/${id}`);
  revalidatePath("/listings");
  revalidatePath("/dashboard");
}

export async function archiveListing(id: string) {
  await requireUser();
  const supabase = getSupabaseServiceClient();
  await supabase.from("listings").update({ status: "archived" }).eq("id", id);
  revalidatePath("/listings");
  revalidatePath("/dashboard");
  redirect("/listings");
}

export async function updateListingCrmStatus(
  id: string,
  crmStatus: ListingCrmStatus,
) {
  await requireUser();
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("listings")
    .update({ crm_status: crmStatus })
    .eq("id", id);

  if (error) throw new Error("Aggiornamento stato CRM non riuscito.");

  revalidatePath(`/listings/${id}`);
  revalidatePath("/listings");
  revalidatePath("/dashboard");
}
