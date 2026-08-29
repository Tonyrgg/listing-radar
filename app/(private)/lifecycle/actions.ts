"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, requireUser } from "@/lib/auth";
import { LifecycleJobQueue } from "@/lib/property-lifecycle/jobs/queue";
import { PropertyLifecycleRepository } from "@/lib/property-lifecycle/persistence/repository";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const PROPERTY_SALE_STATES = new Set([
  "UNKNOWN",
  "SOLD_CONFIRMED",
  "NOT_SOLD_CONFIRMED",
]);
const AGENCY_STATES = new Set([
  "CLOSED_WITHDRAWN",
  "CLOSED_SWITCHED",
  "CLOSED_TO_PRIVATE",
  "OFF_MARKET_NO_SALE_EVIDENCE",
]);
/* Ogni tipo di caso ha le sue risposte: a «sono la stessa casa?» non si
 * risponde «è fuori zona». Prima l'insieme era uno solo e i casi di posizione
 * si chiudevano registrando una decisione di identità che non voleva dire
 * niente. */
const REVIEW_DECISIONS: Record<string, ReadonlySet<string>> = {
  IDENTITY: new Set(["SAME", "DIFFERENT", "NOT_SURE"]),
  GEOGRAPHY: new Set(["IN_SCOPE", "OUT_OF_SCOPE", "NOT_SURE"]),
};
const DEFAULT_REVIEW_DECISIONS = REVIEW_DECISIONS.IDENTITY;

const OVERRIDE_TARGET_BY_REVIEW_TYPE: Record<string, "IDENTITY_MATCH" | "GEOGRAPHY_SCOPE"> = {
  IDENTITY: "IDENTITY_MATCH",
  GEOGRAPHY: "GEOGRAPHY_SCOPE",
};

function requiredText(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`Il campo ${key} è obbligatorio.`);
  return value;
}

function optionalText(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

async function currentReviewerId(): Promise<string> {
  await requireUser();
  const user = await getCurrentUser();
  if (!user) {
    throw new Error(
      "Accedi con un account autorizzato per registrare una correzione manuale.",
    );
  }
  return user.id;
}

function revalidateLifecycle(propertyId?: string) {
  revalidatePath("/lifecycle");
  revalidatePath("/lifecycle/opportunities");
  revalidatePath("/lifecycle/agencies");
  revalidatePath("/lifecycle/archive");
  revalidatePath("/lifecycle/review");
  revalidatePath("/lifecycle/private");
  if (propertyId) revalidatePath(`/casa/${propertyId}`);
}

export async function enqueueGlobalLifecycleRefresh() {
  await requireUser();
  const queue = new LifecycleJobQueue(getSupabaseServiceClient());
  await queue.enqueue({
    jobType: "DEEP_SYNC_ALL",
    priority: 100,
    dedupeKey: "ui:DEEP_SYNC_ALL",
    payload: { requestedFrom: "LIFECYCLE_UI" },
  });
  revalidateLifecycle();
}

export async function enqueueAgencyLifecycleRefresh(formData: FormData) {
  await requireUser();
  const slug = requiredText(formData, "agencySlug");
  const db = getSupabaseServiceClient();
  const repository = new PropertyLifecycleRepository(db);
  const agency = await repository.getAgencyBySlug(slug);
  await new LifecycleJobQueue(db).enqueue({
    jobType: "DEEP_SYNC_AGENCY",
    agencyId: agency.id,
    priority: 100,
    dedupeKey: `ui:DEEP_SYNC_AGENCY:${agency.slug}`,
    payload: { requestedFrom: "LIFECYCLE_UI" },
  });
  revalidatePath(`/lifecycle/agencies/${slug}`);
  revalidateLifecycle();
}

export async function recordPropertySaleOverride(formData: FormData) {
  const createdBy = await currentReviewerId();
  const propertyId = requiredText(formData, "propertyId");
  const nextState = requiredText(formData, "saleStatus");
  const reason = requiredText(formData, "reason");
  if (!PROPERTY_SALE_STATES.has(nextState)) {
    throw new Error("Stato vendita non supportato.");
  }
  const db = getSupabaseServiceClient();
  const current = await db
    .from("properties")
    .select("sale_status")
    .eq("id", propertyId)
    .single();
  if (current.error) throw new Error(current.error.message);
  await new PropertyLifecycleRepository(db).recordManualOverride({
    targetType: "PROPERTY",
    targetId: propertyId,
    overrideKey: "sale_status",
    overrideValue: nextState,
    previousValue: current.data.sale_status,
    reason,
    source: "LIFECYCLE_UI_MANUAL_CONFIRMATION",
    createdBy,
  });
  revalidateLifecycle(propertyId);
}

export async function recordAgencyOutcomeOverride(formData: FormData) {
  const createdBy = await currentReviewerId();
  const agencyListingId = requiredText(formData, "agencyListingId");
  const propertyId = requiredText(formData, "propertyId");
  const nextState = requiredText(formData, "agencyState");
  const reason = requiredText(formData, "reason");
  if (!AGENCY_STATES.has(nextState)) {
    throw new Error("Esito agenzia non supportato.");
  }
  const db = getSupabaseServiceClient();
  const current = await db
    .from("agency_listings")
    .select("state")
    .eq("id", agencyListingId)
    .single();
  if (current.error) throw new Error(current.error.message);
  await new PropertyLifecycleRepository(db).recordManualOverride({
    targetType: "AGENCY_LISTING",
    targetId: agencyListingId,
    overrideKey: "state",
    overrideValue: nextState,
    previousValue: current.data.state,
    reason,
    source: "LIFECYCLE_UI_MANUAL_CONFIRMATION",
    createdBy,
  });
  revalidateLifecycle(propertyId);
}

export async function flagPropertyForLifecycleReview(formData: FormData) {
  const createdBy = await currentReviewerId();
  const propertyId = requiredText(formData, "propertyId");
  const reason = requiredText(formData, "reason");
  const db = getSupabaseServiceClient();
  const review = await db.from("review_queue").upsert(
    {
      review_type: "LIFECYCLE",
      status: "OPEN",
      priority: 100,
      property_id: propertyId,
      title: "Verifica manuale richiesta",
      details: { reason, requestedBy: createdBy, source: "LIFECYCLE_UI" },
      dedupe_key: `manual-verification:${propertyId}`,
    },
    { onConflict: "dedupe_key" },
  );
  if (review.error) throw new Error(review.error.message);
  revalidateLifecycle(propertyId);
}

export async function recordReviewDecision(formData: FormData) {
  const createdBy = await currentReviewerId();
  const reviewId = requiredText(formData, "reviewId");
  const decision = requiredText(formData, "decision");
  const reason = requiredText(formData, "reason");
  /* Con più candidate «stessa casa» da solo non dice quale: la decisione
   * resta scritta insieme alla scheda che stavi guardando. */
  const candidatePropertyId = optionalText(formData, "candidatePropertyId");
  const db = getSupabaseServiceClient();
  const review = await db
    .from("review_queue")
    .select("id,status,property_id,review_type")
    .eq("id", reviewId)
    .single();
  if (review.error) throw new Error(review.error.message);
  const reviewType = String(review.data.review_type);
  const ammesse = REVIEW_DECISIONS[reviewType] ?? DEFAULT_REVIEW_DECISIONS;
  if (!ammesse.has(decision)) {
    throw new Error("Decisione di revisione non supportata.");
  }
  const override = await new PropertyLifecycleRepository(db).recordManualOverride({
    targetType: OVERRIDE_TARGET_BY_REVIEW_TYPE[reviewType] ?? "IDENTITY_MATCH",
    targetId: reviewId,
    overrideKey: "review_decision",
    overrideValue: candidatePropertyId ? { decision, candidatePropertyId } : decision,
    previousValue: review.data.status,
    reason,
    source: "LIFECYCLE_REVIEW_UI",
    createdBy,
  });
  const update = await db
    .from("review_queue")
    .update({
      status: decision === "NOT_SURE" ? "IN_REVIEW" : "RESOLVED",
      resolution: { decision, reason, overrideId: override, candidatePropertyId },
      resolved_by: decision === "NOT_SURE" ? null : createdBy,
      resolved_at: decision === "NOT_SURE" ? null : new Date().toISOString(),
    })
    .eq("id", reviewId);
  if (update.error) throw new Error(update.error.message);
  revalidateLifecycle(review.data.property_id ?? undefined);
}
