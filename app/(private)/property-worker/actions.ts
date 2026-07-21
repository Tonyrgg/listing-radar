"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function createPropertyWorkerJob(formData: FormData) {
  await requireUser();
  const supabase = await getSupabaseServerClient();
  const mode = formData.get("mode") === "automatic" ? "automatic" : "assisted";
  const value = (name: string) => String(formData.get(name) ?? "").trim() || null;
  const { data, error } = await supabase.from("property_worker_jobs").insert({
    mode, status: "ready", current_step: "ready", municipality: value("municipality"), street: value("street"), civic_number: value("civicNumber"),
  }).select("id").single();
  if (error) throw new Error(`Impossibile creare la lavorazione: ${error.message}`);
  revalidatePath("/property-worker");
  redirect(`/property-worker?job=${data.id}`);
}

export async function pausePropertyWorkerJob(formData: FormData) {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.from("property_worker_jobs").update({ status: "paused" }).eq("id", jobId).neq("status", "completed");
  if (error) throw new Error(`Impossibile mettere in pausa: ${error.message}`);
  revalidatePath("/property-worker");
}

export async function resumePropertyWorkerJob(formData: FormData) {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.from("property_worker_jobs").update({ status: "ready", error_message: null, error_details: null, completed_at: null }).eq("id", jobId).neq("status", "completed");
  if (error) throw new Error(`Impossibile preparare la ripresa: ${error.message}`);
  revalidatePath("/property-worker");
}

