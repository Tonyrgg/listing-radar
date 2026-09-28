"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { romeLocalToUtc } from "@/lib/acquisition/time";
import { outreachBlockReason } from "@/lib/acquisition/contact-policy";
import { addActivityAction } from "../acquisition/actions";

const uuid = z.uuid();
const activity = z.enum(["phone_call","whatsapp","sms","email","in_person",
  "zone_visit","verification","note","private_sign","property_check","referral"]);
const outreach = new Set(["phone_call","whatsapp","sms","email","in_person"]);
const nativeLeadActivities = new Set(["phone_call","whatsapp","sms","email","in_person",
  "zone_visit","verification","note"]);
const category: Record<string,string> = {
  phone_call:"CONTACT",whatsapp:"CONTACT",sms:"CONTACT",email:"CONTACT",
  in_person:"CONTACT",referral:"CONTACT",zone_visit:"FIELD",
  property_check:"FIELD",private_sign:"INTELLIGENCE",verification:"INTELLIGENCE",
  note:"INTELLIGENCE",
};
const title: Record<string,string> = {
  phone_call:"Telefonata",whatsapp:"WhatsApp registrato",sms:"SMS registrato",
  email:"Email registrata",in_person:"Conversazione di persona",
  referral:"Segnalazione",zone_visit:"Attività in zona",
  property_check:"Verifica immobile",private_sign:"Cartello privato",
  verification:"Verifica",note:"Nota",
};
const read = (form:FormData,key:string,max=5000) =>
  z.string().max(max).parse(String(form.get(key) ?? "").trim());
const optionalId = (form:FormData,key:string) => {
  const raw = read(form,key,50);
  return raw ? uuid.parse(raw) : null;
};
const localDate = (form:FormData,key:string) => {
  const raw = read(form,key,30);
  return raw ? romeLocalToUtc(raw).toISOString() : null;
};
function refresh() {
  for (const path of ["/logbook","/logbook/month","/acquisition/today",
    "/acquisition/stale","/dashboard"]) revalidatePath(path);
}

export async function createLogbookEntryAction(form:FormData) {
  const user = await requireUser();
  const type = activity.parse(read(form,"event_type",50));
  const leadId = optionalId(form,"lead_id");
  const contactId = optionalId(form,"contact_id");
  const clientId = optionalId(form,"client_id");
  const propertyId = optionalId(form,"property_id");
  const nextAt = localDate(form,"next_action_at");
  const nextType = read(form,"next_action_type",100) || null;
  if (nextAt !== null && !nextType) throw new Error("Indica anche la prossima azione.");
  if (!nextAt && nextType) throw new Error("Indica quando fare la prossima azione.");
  if (outreach.has(type) && !leadId && !contactId && !clientId)
    throw new Error("Collega una persona prima di registrare un contatto.");
  const db = getSupabaseServiceClient();
  const leadResult = leadId ? await db.from("acquisition_leads")
    .select("contact_id,property_id,status").eq("id",leadId).single() : null;
  if (leadResult?.error) throw new Error(`Lettura opportunità: ${leadResult.error.message}`);
  const lead = leadResult?.data;
  if (lead && contactId && contactId !== lead.contact_id)
    throw new Error("La persona selezionata non è collegata a questa opportunità.");
  if (lead && propertyId && propertyId !== lead.property_id)
    throw new Error("L'immobile selezionato non è collegato a questa opportunità.");
  if (lead && nextAt && ["WON","FUTURE","NOT_INTERESTED","LOST"].includes(lead.status))
    throw new Error("Riapri l'opportunità prima di programmare una prossima azione.");
  if (leadId && nativeLeadActivities.has(type)) {
    const activityForm = new FormData();
    for (const key of ["outcome","note","next_action_type","next_action_at"])
      activityForm.set(key,read(form,key));
    activityForm.set("activity_type",type);
    await addActivityAction(leadId,activityForm);
    refresh();
    const linked = await db.from("acquisition_leads").select("property_id,contact_id")
      .eq("id",leadId).single();
    if (linked.error) throw new Error(`Aggiornamento diario: ${linked.error.message}`);
    if (linked.data.property_id) revalidatePath(`/casa/${linked.data.property_id}`);
    if (linked.data.contact_id) revalidatePath(`/contacts/${linked.data.contact_id}`);
    return;
  }
  let resolvedContact = contactId;
  let resolvedClient = clientId;
  let resolvedProperty = propertyId;
  if (lead) {
    resolvedContact = lead.contact_id;
    resolvedProperty = lead.property_id;
  }
  if (resolvedContact && !resolvedClient) {
    const linked = await db.from("acquisition_contacts").select("client_id")
      .eq("id",resolvedContact).single();
    if (linked.error) throw new Error(`Lettura persona: ${linked.error.message}`);
    resolvedClient = linked.data.client_id;
  }
  if (outreach.has(type) && resolvedContact) {
    const contact = await db.from("acquisition_contacts")
      .select("do_not_contact,contact_review_required,contact_status")
      .eq("id",resolvedContact).single();
    if (contact.error) throw new Error(`Verifica contatto: ${contact.error.message}`);
    const reason = outreachBlockReason(contact.data);
    if (reason) throw new Error(reason);
  }
  const inserted = await db.from("logbook_entries").insert({
    event_category:category[type],event_type:type,source_type:"manual",
    lead_id:leadId,contact_id:resolvedContact,client_id:resolvedClient,
    property_id:resolvedProperty,
    title:title[type],note:read(form,"note") || null,
    outcome:read(form,"outcome",100) || null,
    next_action_type:leadId ? null : nextType,
    next_action_at:leadId ? null : nextAt,
    occurred_at:localDate(form,"occurred_at") ?? new Date().toISOString(),
    created_by:user?.id ?? null,
  });
  if (inserted.error) throw new Error(`Registrazione nel Diario: ${inserted.error.message}`);
  if (leadId && nextAt && nextType) {
    const updated = await db.from("acquisition_leads").update({
      next_action_type:nextType,next_action_at:nextAt,
    }).eq("id",leadId);
    if (updated.error) throw new Error(`Prossima azione opportunità: ${updated.error.message}`);
  }
  refresh();
  if (leadId) revalidatePath(`/acquisition/${leadId}`);
  if (resolvedContact) revalidatePath(`/contacts/${resolvedContact}`);
  if (resolvedClient) revalidatePath(`/contacts/${resolvedClient}`);
  if (resolvedProperty) revalidatePath(`/casa/${resolvedProperty}`);
}

export async function completeLogbookAction(id:string) {
  await requireUser();
  uuid.parse(id);
  const db = getSupabaseServiceClient();
  const updated = await db.from("logbook_entries")
    .update({action_completed_at:new Date().toISOString()})
    .eq("id",id).is("action_completed_at",null);
  if (updated.error) throw new Error(`Chiusura azione: ${updated.error.message}`);
  refresh();
}

export async function setMonthlyFocusAction(form:FormData) {
  const user = await requireUser();
  const month = read(form,"month",7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mese non valido.");
  const entity = z.enum(["lead","contact","client","property"]).parse(read(form,"entity",20));
  const entityId = uuid.parse(read(form,"entity_id",50));
  const enable = read(form,"enabled",5) === "true";
  const monthStart = `${month}-01`;
  const column = `${entity}_id`;
  const db = getSupabaseServiceClient();
  if (enable) {
    const inserted = await db.from("monthly_focus").insert({
      month_start:monthStart,[column]:entityId,created_by:user?.id ?? null,
    });
    if (inserted.error && inserted.error.code !== "23505")
      throw new Error(`Focus mensile: ${inserted.error.message}`);
  } else {
    const deleted = await db.from("monthly_focus").delete()
      .eq("month_start",monthStart).eq(column,entityId);
    if (deleted.error) throw new Error(`Focus mensile: ${deleted.error.message}`);
  }
  revalidatePath("/logbook/month");
  revalidatePath("/acquisition/today");
  revalidatePath("/acquisition/stale");
  if (entity === "lead") revalidatePath(`/acquisition/${entityId}`);
  if (entity === "contact") revalidatePath(`/contacts/${entityId}`);
  if (entity === "client") revalidatePath(`/contacts/${entityId}`);
  if (entity === "property") revalidatePath(`/casa/${entityId}`);
}
