"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { romeLocalToUtc } from "@/lib/acquisition/time";
import { outreachBlockReason,sourceRequiresContactReview } from "@/lib/acquisition/contact-policy";

const stages = z.enum(["NEW","VERIFY","TO_CONTACT","CONTACTED","CONVERSATION",
  "FOLLOW_UP","ACQUISITION_BOOKED","ACQUISITION_DONE","WON","FUTURE","NOT_INTERESTED","LOST"]);
const engines = z.enum(["fsbo_radar","crm_mining","buyer_to_seller","abandoned_property",
  "building_event","smart_zone","professional_network","neighborhood_intelligence",
  "property_intelligence","succession","private_sign","condominium_works","moving",
  "administrators","technicians"]);
const activityTypes = z.enum(["phone_call","whatsapp","sms","email","in_person","zone_visit",
  "verification","note","appointment","acquisition","status_change","system_signal"]);
const terminal = new Set(["WON","FUTURE","NOT_INTERESTED","LOST"]);
const uuid = z.uuid();
const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => z.string().max(key === "note" ? 5000 : 500)
  .parse(value(form,key)) || null;
const date = (form: FormData, key: string) => {
  const raw = optional(form,key);
  if (!raw) return null;
  return romeLocalToUtc(raw).toISOString();
};
function check(error: { message: string } | null, context: string) {
  if (error) { console.error(`[acquisition] ${context}: ${error.message}`); throw new Error(`${context}: ${error.message}`); }
}
function refresh(id?: string) {
  revalidatePath("/acquisition"); revalidatePath("/acquisition/today");
  revalidatePath("/acquisition/zone"); revalidatePath("/acquisition/kpi");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/acquisition/${id}`);
}

async function assertOutreachAllowed(db: ReturnType<typeof getSupabaseServiceClient>, contactId: string | null) {
  if (!contactId) throw new Error(outreachBlockReason(null)!);
  const contact = await db.from("acquisition_contacts")
    .select("do_not_contact,contact_review_required,contact_status")
    .eq("id",contactId).single();
  check(contact.error,"Verifica contatto");
  const reason = outreachBlockReason(contact.data);
  if (reason) throw new Error(reason);
}

export async function createSignalAction(form: FormData) {
  const user = await requireUser();
  const address = z.string().min(3).max(300).parse(value(form,"address"));
  const locality = z.enum(["Bitonto","Palombaio","Mariotto"]).parse(value(form,"locality") || "Bitonto");
  const source = engines.parse(value(form,"source_type"));
  const signalType = z.string().min(2).max(100).parse(value(form,"signal_type"));
  const propertyId = optional(form,"property_id") ? uuid.parse(value(form,"property_id")) : null;
  const requestId = optional(form,"request_id") ? uuid.parse(value(form,"request_id")) : null;
  const priority = z.enum(["A","B","C"]).parse(value(form,"priority") || "C");
  const db = getSupabaseServiceClient();
  let leadId: string | undefined;
  if (propertyId) {
    const existing = await db.from("acquisition_leads").select("id,priority,next_action_at").eq("property_id",propertyId)
      .not("status","in","(WON,FUTURE,NOT_INTERESTED,LOST)").maybeSingle();
    check(existing.error,"Ricerca opportunità");
    leadId = existing.data?.id;
    if (existing.data) {
      const desired = { A: 0, B: 1, C: 2 };
      const next = date(form,"next_action_at");
      const patch: Record<string, string | null> = {};
      if (desired[priority] < desired[existing.data.priority as "A" | "B" | "C"])
        patch.priority = priority;
      if (!existing.data.next_action_at && next) {
        patch.next_action_at = next;
        patch.next_action_type = optional(form,"next_action_type");
        patch.next_action_note = optional(form,"next_action_note");
      }
      if (Object.keys(patch).length) {
        const updated = await db.from("acquisition_leads").update(patch).eq("id",leadId);
        check(updated.error,"Aggiornamento lead da notizia");
      }
    }
  }
  if (!leadId) {
    const possible = await db.from("acquisition_leads").select("id")
      .eq("locality",locality).ilike("address",address).limit(1);
    check(possible.error,"Ricerca possibili duplicati");
    const inserted = await db.from("acquisition_leads").insert({property_id:propertyId,address,locality,
      source_type:source,priority,request_id:requestId,
      possible_duplicate_of:propertyId ? null : possible.data?.[0]?.id ?? null,
      next_action_type:optional(form,"next_action_type"),next_action_at:date(form,"next_action_at"),
      next_action_note:optional(form,"next_action_note"),created_by:user?.id ?? null}).select("id").single();
    if (inserted.error?.code === "23505" && propertyId) {
      const existing = await db.from("acquisition_leads").select("id").eq("property_id",propertyId)
        .not("status","in","(WON,FUTURE,NOT_INTERESTED,LOST)").single();
      check(existing.error,"Rilettura opportunità"); leadId = existing.data!.id;
    } else { check(inserted.error,"Creazione opportunità"); leadId = inserted.data!.id; }
  }
  if (requestId) {
    const linkedRequest = await db.from("acquisition_lead_requests")
      .upsert({lead_id:leadId,request_id:requestId},{onConflict:"lead_id,request_id"});
    check(linkedRequest.error,"Collegamento richiesta buyer");
  }
  const name = optional(form,"contact_name");
  if (name) {
    const linked = await db.from("acquisition_leads").select("contact_id").eq("id",leadId).single();
    check(linked.error,"Verifica contatto esistente");
    if (!linked.data?.contact_id) {
      const phone = optional(form,"contact_phone");
      const duplicate = phone ? await db.from("acquisition_contacts").select("id").eq("phone",phone).limit(1) : null;
      if (duplicate) check(duplicate.error,"Verifica recapito duplicato");
      const contact = await db.from("acquisition_contacts").insert({full_name:name,
        phone,contact_source:source,possible_duplicate_of:duplicate?.data?.[0]?.id ?? null,
        sensitive_source:sourceRequiresContactReview(source),
        contact_review_required:sourceRequiresContactReview(source)})
        .select("id").single();
      check(contact.error,"Creazione contatto");
      const updated = await db.from("acquisition_leads").update({contact_id:contact.data!.id}).eq("id",leadId);
      check(updated.error,"Collegamento contatto");
    }
  }
  if (sourceRequiresContactReview(source)) {
    const linked = await db.from("acquisition_leads").select("contact_id").eq("id",leadId).single();
    check(linked.error,"Verifica fonte sensibile");
    if (linked.data?.contact_id) {
      const marked = await db.from("acquisition_contacts")
        .update({sensitive_source:true,contact_review_required:true})
        .eq("id",linked.data.contact_id);
      check(marked.error,"Protezione contatto da fonte sensibile");
    }
  }
  const signal = await db.from("acquisition_signals").insert({lead_id:leadId,property_id:propertyId,
    source_type:source,signal_type:signalType,description:optional(form,"note"),
    source_reference:optional(form,"source_reference"),
    observed_at:date(form,"observed_at") ?? new Date().toISOString(),
    details:source === "private_sign" ? {
      sign_type:optional(form,"sign_type"),still_present:value(form,"still_present") || "unknown",
      last_checked_at:date(form,"last_checked_at"),
    } : {},
    sensitive_source:sourceRequiresContactReview(source),
    contact_review_required:sourceRequiresContactReview(source)});
  check(signal.error,"Registrazione notizia");
  const activity = await db.from("acquisition_activities").insert({lead_id:leadId,
    activity_type:"system_signal",outcome:signalType,note:optional(form,"note"),actor_id:user?.id ?? null});
  check(activity.error,"Timeline notizia");
  refresh(leadId);
  redirect(`/acquisition/${leadId}`);
}

export async function updateLeadAction(id: string, form: FormData) {
  const user = await requireUser(); uuid.parse(id);
  const db = getSupabaseServiceClient();
  const current = await db.from("acquisition_leads").select("status,contact_id").eq("id",id).single();
  check(current.error,"Lettura opportunità");
  const status = stages.parse(value(form,"status"));
  if (status === "WON" && !["ACQUISITION_DONE","WON"].includes(current.data!.status))
    throw new Error("Registra prima l'esito dell'acquisizione.");
  if (["TO_CONTACT","CONTACTED","CONVERSATION"].includes(status))
    await assertOutreachAllowed(db,current.data!.contact_id);
  const patch = {status,priority:z.enum(["A","B","C"]).parse(value(form,"priority")),
    next_action_type:terminal.has(status) ? null : optional(form,"next_action_type"),
    next_action_at:terminal.has(status) ? null : date(form,"next_action_at"),
    next_action_note:terminal.has(status) ? null : optional(form,"next_action_note")};
  const updated = await db.from("acquisition_leads").update(patch).eq("id",id);
  check(updated.error,"Aggiornamento opportunità");
  if (status !== current.data!.status) {
    const activity = await db.from("acquisition_activities").insert({lead_id:id,activity_type:"status_change",
      outcome:status,note:`${current.data!.status} → ${status}`,actor_id:user?.id ?? null});
    check(activity.error,"Storico stato");
  }
  refresh(id);
}

export async function addActivityAction(id: string, form: FormData) {
  const user = await requireUser(); uuid.parse(id);
  const activityType = activityTypes.parse(value(form,"activity_type"));
  const db = getSupabaseServiceClient();
  const lead = await db.from("acquisition_leads").select("status,contact_id").eq("id",id).single();
  check(lead.error,"Lettura opportunità");
  if (["phone_call","whatsapp","sms","email","in_person"].includes(activityType))
    await assertOutreachAllowed(db,lead.data!.contact_id);
  if (terminal.has(lead.data!.status) && date(form,"next_action_at"))
    throw new Error("Riapri esplicitamente il lead prima di programmare un follow-up.");
  const activity = await db.from("acquisition_activities").insert({lead_id:id,activity_type:activityType,
    outcome:optional(form,"outcome"),note:optional(form,"note"),actor_id:user?.id ?? null});
  check(activity.error,"Registrazione attività");
  const nextAt = date(form,"next_action_at");
  if (nextAt) {
    const current = await db.from("acquisition_leads").select("status").eq("id",id).single();
    check(current.error,"Lettura stato follow-up");
    const updated = await db.from("acquisition_leads").update({status:"FOLLOW_UP",
      next_action_type:optional(form,"next_action_type") ?? "follow_up",
      next_action_at:nextAt,next_action_note:optional(form,"next_action_note")}).eq("id",id);
    check(updated.error,"Programmazione follow-up");
    if (current.data?.status !== "FOLLOW_UP") {
      const transition = await db.from("acquisition_activities").insert({lead_id:id,
        activity_type:"status_change",outcome:"FOLLOW_UP",note:`${current.data?.status} → FOLLOW_UP`,
        actor_id:user?.id ?? null});
      check(transition.error,"Storico follow-up");
    }
  } else if (value(form,"outcome") === "follow_up_done") {
    const cleared = await db.from("acquisition_leads").update({
      next_action_type:null,next_action_at:null,next_action_note:null,
    }).eq("id",id);
    check(cleared.error,"Chiusura follow-up");
  }
  refresh(id);
}

export async function bookAcquisitionAction(id: string, form: FormData) {
  const user = await requireUser(); uuid.parse(id);
  const scheduledAt = date(form,"scheduled_at");
  if (!scheduledAt) throw new Error("Indica la data dell'acquisizione.");
  const db = getSupabaseServiceClient();
  const lead = await db.from("acquisition_leads").select("status,contact_id").eq("id",id).single();
  check(lead.error,"Lettura opportunità");
  if (terminal.has(lead.data!.status)) throw new Error("Riapri il lead prima di fissare un'acquisizione.");
  await assertOutreachAllowed(db,lead.data!.contact_id);
  const open = await db.from("acquisition_appointments").select("id").eq("lead_id",id)
    .is("completed_at",null).limit(1);
  check(open.error,"Verifica appuntamento aperto");
  if (open.data?.length) throw new Error("Esiste già un appuntamento di acquisizione aperto.");
  const appointment = await db.from("acquisition_appointments").insert({lead_id:id,scheduled_at:scheduledAt,
    motivation:optional(form,"motivation"),selling_timing:optional(form,"selling_timing"),
    asking_price:optional(form,"asking_price"),estimated_price:optional(form,"estimated_price"),
    obstacles:optional(form,"obstacles"),competitors:optional(form,"competitors")}).select("id").single();
  check(appointment.error,"Appuntamento acquisizione");
  const updated = await db.from("acquisition_leads").update({status:"ACQUISITION_BOOKED",
    next_action_type:"acquisition",next_action_at:scheduledAt}).eq("id",id);
  check(updated.error,"Stato acquisizione");
  const activity = await db.from("acquisition_activities").insert({lead_id:id,activity_type:"appointment",outcome:"booked",actor_id:user?.id ?? null});
  check(activity.error,"Storico appuntamento");
  const transition = await db.from("acquisition_activities").insert({lead_id:id,
    activity_type:"status_change",outcome:"ACQUISITION_BOOKED",actor_id:user?.id ?? null});
  check(transition.error,"Storico stato acquisizione");
  refresh(id);
}

export async function completeAcquisitionAction(id: string, form: FormData) {
  const user = await requireUser(); uuid.parse(id);
  const outcome = z.enum(["mandate","follow_up","not_ready","lost","reconsider"]).parse(value(form,"outcome"));
  const db = getSupabaseServiceClient();
  const latest = await db.from("acquisition_appointments").select("id").eq("lead_id",id)
    .is("completed_at",null).order("scheduled_at",{ascending:false}).limit(1).maybeSingle();
  check(latest.error,"Lettura appuntamento");
  if (!latest.data) throw new Error("Nessun appuntamento aperto.");
  const done = await db.from("acquisition_appointments").update({outcome,completed_at:new Date().toISOString()})
    .eq("id",latest.data.id);
  check(done.error,"Esito acquisizione");
  const status = outcome === "mandate" ? "WON" : outcome === "lost" ? "LOST" :
    outcome === "follow_up" ? "FOLLOW_UP" : "ACQUISITION_DONE";
  const updated = await db.from("acquisition_leads").update({status,
    next_action_type:terminal.has(status) ? null : optional(form,"next_action_type"),
    next_action_at:terminal.has(status) ? null : date(form,"next_action_at"),
    next_action_note:terminal.has(status) ? null : optional(form,"next_action_note")}).eq("id",id);
  check(updated.error,"Stato dopo acquisizione");
  const activity = await db.from("acquisition_activities").insert({lead_id:id,
    activity_type:"acquisition",outcome,note:optional(form,"note"),actor_id:user?.id ?? null});
  check(activity.error,"Storico acquisizione");
  const transition = await db.from("acquisition_activities").insert({lead_id:id,
    activity_type:"status_change",outcome:status,note:`Esito acquisizione: ${outcome}`,actor_id:user?.id ?? null});
  check(transition.error,"Storico stato acquisizione");
  refresh(id);
}

export async function updateSellFirstAction(requestId: string, form: FormData) {
  await requireUser(); uuid.parse(requestId);
  const needs = z.enum(["yes","no","unknown"]).parse(value(form,"needs_to_sell_first"));
  const propertyToSell = optional(form,"property_to_sell_id") ? uuid.parse(value(form,"property_to_sell_id")) : null;
  const db = getSupabaseServiceClient();
  const update = await db.from("property_requests").update({needs_to_sell_first:needs,
    property_to_sell_id:propertyToSell,sale_situation_notes:optional(form,"sale_situation_notes")}).eq("id",requestId);
  check(update.error,"Situazione vendita buyer");
  revalidatePath(`/requests/${requestId}`);
}

export async function reviewContactAction(id: string, form: FormData) {
  const user = await requireUser(); uuid.parse(id);
  const db = getSupabaseServiceClient();
  const lead = await db.from("acquisition_leads").select("contact_id").eq("id",id).single();
  check(lead.error,"Lettura contatto");
  if (!lead.data?.contact_id) throw new Error("Nessun contatto collegato.");
  const updated = await db.from("acquisition_contacts").update({
    contact_review_required:form.get("contact_review_required") === "on",
    contact_review_at:date(form,"contact_review_at"),
    do_not_contact:form.get("do_not_contact") === "on",
    contact_status:z.enum(["unreviewed","reviewed","consented","blocked"]).parse(value(form,"contact_status")),
  }).eq("id",lead.data.contact_id);
  check(updated.error,"Revisione contatto");
  const activity = await db.from("acquisition_activities").insert({lead_id:id,
    activity_type:"verification",outcome:"contact_review",actor_id:user?.id ?? null});
  check(activity.error,"Storico revisione contatto"); refresh(id);
}

export async function verifySignalAction(id: string, signalId: string, form: FormData) {
  const user = await requireUser(); uuid.parse(id); uuid.parse(signalId);
  const verification = z.enum(["unverified","verified","rejected"]).parse(value(form,"verification_status"));
  const db = getSupabaseServiceClient();
  const updated = await db.from("acquisition_signals").update({verification_status:verification})
    .eq("id",signalId).eq("lead_id",id);
  check(updated.error,"Verifica notizia");
  const activity = await db.from("acquisition_activities").insert({lead_id:id,
    activity_type:"verification",outcome:verification,actor_id:user?.id ?? null});
  check(activity.error,"Storico verifica"); refresh(id);
}

export async function linkPropertyAction(id: string, form: FormData) {
  await requireUser(); uuid.parse(id);
  const propertyId = uuid.parse(value(form,"property_id"));
  const db = getSupabaseServiceClient();
  const property = await db.from("properties").select("id").eq("id",propertyId).maybeSingle();
  check(property.error,"Ricerca immobile");
  if (!property.data) throw new Error("Immobile V2 inesistente.");
  const other = await db.from("acquisition_leads").select("id").eq("property_id",propertyId)
    .not("status","in","(WON,FUTURE,NOT_INTERESTED,LOST)").neq("id",id).maybeSingle();
  check(other.error,"Verifica duplicato");
  if (other.data) throw new Error(`Immobile già collegato alla notizia ${other.data.id}.`);
  const updated = await db.from("acquisition_leads").update({property_id:propertyId,possible_duplicate_of:null})
    .eq("id",id);
  check(updated.error,"Collegamento immobile"); refresh(id);
}

export async function attachContactAction(id: string, form: FormData) {
  const user = await requireUser(); uuid.parse(id);
  const name = z.string().min(2).max(500).parse(value(form,"full_name"));
  const db = getSupabaseServiceClient();
  const lead = await db.from("acquisition_leads").select("contact_id,source_type").eq("id",id).single();
  check(lead.error,"Lettura opportunità");
  if (lead.data?.contact_id) throw new Error("Esiste già un contatto collegato: verifica prima di sostituirlo.");
  const source = lead.data!.source_type;
  const sensitiveSignals = await db.from("acquisition_signals").select("id")
    .eq("lead_id",id).eq("contact_review_required",true).limit(1);
  check(sensitiveSignals.error,"Verifica fonti collegate");
  const reviewRequired = sourceRequiresContactReview(source) || Boolean(sensitiveSignals.data?.length);
  const clientId = optional(form,"client_id") ? uuid.parse(value(form,"client_id")) : null;
  const phone = optional(form,"phone");
  const duplicate = phone ? await db.from("acquisition_contacts").select("id").eq("phone",phone).limit(1) : null;
  if (duplicate) check(duplicate.error,"Verifica recapito duplicato");
  const contact = await db.from("acquisition_contacts").insert({full_name:name,
    phone,email:optional(form,"email"),studio:optional(form,"studio"),
    zones:optional(form,"zones"),role:optional(form,"role") ?? "owner",client_id:clientId,
    possible_duplicate_of:duplicate?.data?.[0]?.id ?? null,
    contact_source:source,sensitive_source:reviewRequired,
    contact_review_required:reviewRequired}).select("id").single();
  check(contact.error,"Creazione contatto");
  const updated = await db.from("acquisition_leads").update({contact_id:contact.data!.id}).eq("id",id);
  check(updated.error,"Collegamento contatto");
  const activity = await db.from("acquisition_activities").insert({lead_id:id,
    activity_type:"verification",outcome:"contact_identified",actor_id:user?.id ?? null});
  check(activity.error,"Storico identificazione contatto"); refresh(id);
}
