import Link from "next/link";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { parseMonth,type LogbookEvent } from "@/lib/logbook";
import { LogbookEventRow } from "@/components/logbook-event-row";
import { QuickLogbook } from "@/components/quick-logbook";
import { FocusToggle } from "@/components/focus-toggle";

export async function PropertyLogbook({propertyId}:{propertyId:string}) {
  const db = getSupabaseServiceClient();
  const month = parseMonth();
  const [events,leads,focus] = await Promise.all([
    db.from("universal_logbook").select("id,event_category,event_type,source_type,property_id,contact_id,client_id,lead_id,request_id,occurred_at,title,description,outcome,importance,requires_action,next_action_type,next_action_at,address,locality,person_name,automatic,sensitive")
      .eq("property_id",propertyId).order("occurred_at",{ascending:false}).limit(40),
    db.from("acquisition_leads").select("id,address,status,priority")
      .eq("property_id",propertyId).order("updated_at",{ascending:false}).limit(30),
    db.from("monthly_focus").select("id").eq("month_start",`${month}-01`)
      .eq("property_id",propertyId).limit(1),
  ]);
  for (const result of [events,leads,focus])
    if (result.error) throw new Error(`Diario immobile: ${result.error.message}`);
  return <section id="diario" className="mx-auto max-w-6xl space-y-3 px-4 py-6 md:px-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-xl font-semibold">Diario della casa</h2>
      <FocusToggle month={month} entity="property" id={propertyId} active={!!focus.data?.length}/>
    </div>
    {(leads.data ?? []).length > 0 && <div className="flex flex-wrap gap-2 text-sm">
      {(leads.data ?? []).map(lead=><Link key={lead.id} href={`/acquisition/${lead.id}`}
        className="rounded border px-2 py-1 underline">{lead.priority} · {lead.status} · {lead.address}</Link>)}
    </div>}
    <QuickLogbook propertyId={propertyId} leads={(leads.data ?? []).map(x=>({id:x.id,label:x.address}))}/>
    <div className="border-t border-[var(--lr-line)]">
      {(events.data ?? []).length ? (events.data as LogbookEvent[]).map(event=><LogbookEventRow
        key={event.id} event={event}/>) : <p className="py-5 text-sm">Nessun evento registrato.</p>}
    </div>
    <Link href={`/logbook?property=${propertyId}`} className="text-sm underline">Tutto lo storico →</Link>
  </section>;
}
