import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { parseMonth,type LogbookEvent } from "@/lib/logbook";
import { LogbookEventRow } from "@/components/logbook-event-row";
import { QuickLogbook } from "@/components/quick-logbook";
import { FocusToggle } from "@/components/focus-toggle";

export const dynamic = "force-dynamic";
export const metadata = { title: "Persona" };
export default async function ContactPage({params}:{params:Promise<{id:string}>}) {
  const {id} = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getSupabaseServiceClient();
  const [contactResult,buyerResult] = await Promise.all([
    db.from("acquisition_contacts").select("*").eq("id",id).maybeSingle(),
    db.from("clients").select("*").eq("id",id).maybeSingle(),
  ]);
  if (contactResult.error || buyerResult.error)
    throw new Error(`Persona: ${contactResult.error?.message ?? buyerResult.error?.message}`);
  const contact = contactResult.data;
  const buyer = buyerResult.data;
  if (!contact && !buyer) notFound();
  const clientId = contact?.client_id ?? buyer?.id ?? null;
  const contactId = contact?.id ?? null;
  const linkedContacts = buyer && !contact ? await db.from("acquisition_contacts")
    .select("id").eq("client_id",buyer.id).limit(30)
    : {data:[],error:null};
  if (linkedContacts.error) throw new Error(`Contatti cliente: ${linkedContacts.error.message}`);
  const relatedContactIds = [contactId,...(linkedContacts.data ?? []).map(x=>x.id)]
    .filter((value):value is string=>!!value);
  const month = parseMonth();
  const [events,leads,requests,focus] = await Promise.all([
    db.from("universal_logbook").select("id,event_category,event_type,source_type,property_id,contact_id,client_id,lead_id,request_id,occurred_at,title,description,outcome,importance,requires_action,next_action_type,next_action_at,address,locality,person_name,automatic,sensitive")
      .or([contactId ? `contact_id.eq.${contactId}` : "",clientId ? `client_id.eq.${clientId}` : ""]
        .filter(Boolean).join(","))
      .order("occurred_at",{ascending:false}).limit(60),
    relatedContactIds.length ? db.from("acquisition_leads").select("id,address,status,priority,property_id,next_action_at")
      .in("contact_id",relatedContactIds).order("updated_at",{ascending:false}).limit(30)
      : Promise.resolve({data:[],error:null}),
    clientId ? db.from("property_requests").select("id,title,status,municipality,needs_to_sell_first,property_to_sell_id")
      .eq("client_id",clientId).order("created_at",{ascending:false}).limit(30)
      : Promise.resolve({data:[],error:null}),
    db.from("monthly_focus").select("id").eq("month_start",`${month}-01`)
      .eq(contactId ? "contact_id" : "client_id",id).limit(1),
  ]);
  for (const result of [events,leads,requests,focus])
    if (result.error) throw new Error(`Scheda persona: ${result.error.message}`);
  const name = contact?.full_name ?? buyer?.full_name ?? "Persona senza nome";
  return <main className="space-y-5 p-4 md:p-6">
    <Link href="/cerca" className="text-sm underline">Cerca</Link>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">{name}</h1>
        <p className="text-sm">{contact?.role ?? "Cliente CRM"}{contact?.studio && ` · ${contact.studio}`}</p>
        <p className="text-sm">{contact?.phone ?? buyer?.phone ?? ""}
          {(contact?.email ?? buyer?.email) && ` · ${contact?.email ?? buyer?.email}`}</p>
        {contact && <p className="text-sm">Contatto: {contact.contact_status}
          {(contact.do_not_contact || contact.contact_review_required) && " · da non contattare senza verifica"}</p>}
      </div>
      <FocusToggle month={month} entity={contactId ? "contact" : "client"} id={id}
        active={!!focus.data?.length}/>
    </header>
    {(leads.data ?? []).length > 0 && <section><h2 className="font-semibold">Opportunità</h2>
      {(leads.data ?? []).map(lead=><Link key={lead.id} href={`/acquisition/${lead.id}`}
        className="block border-b py-2 text-sm underline">{lead.address} · {lead.status} · {lead.priority}</Link>)}
    </section>}
    {(requests.data ?? []).length > 0 && <section><h2 className="font-semibold">Richieste</h2>
      {(requests.data ?? []).map(request=><Link key={request.id} href={`/requests/${request.id}`}
        className="block border-b py-2 text-sm underline">{request.title ?? request.municipality ?? "Richiesta"} · {request.status}
          {request.needs_to_sell_first === "yes" && " · Deve vendere"}</Link>)}
    </section>}
    <QuickLogbook contactId={contactId ?? undefined} clientId={clientId ?? undefined}
      leads={(leads.data ?? []).map(x=>({id:x.id,label:x.address}))}/>
    <section><h2 className="mb-2 text-lg font-semibold">Diario della persona</h2>
      <div className="border-t border-[var(--lr-line)]">{(events.data ?? []).length
        ? (events.data as LogbookEvent[]).map(event=><LogbookEventRow key={event.id} event={event}/>)
        : <p className="py-4 text-sm">Nessun evento registrato.</p>}</div>
      <Link href={`/logbook?${contactId ? `contact=${contactId}` : `client=${clientId}`}`}
        className="mt-2 inline-block text-sm underline">Tutto lo storico →</Link>
    </section>
  </main>;
}
