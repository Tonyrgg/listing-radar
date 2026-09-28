import Link from "next/link";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { QuickLogbook } from "@/components/quick-logbook";
import { completeLogbookAction } from "@/app/(private)/logbook/actions";
import { italianDayEnd } from "@/lib/acquisition/time";
import { parseMonth } from "@/lib/logbook";

export const dynamic = "force-dynamic";
export const metadata = { title: "Oggi · Acquisizioni" };
const pageSize = 50;

export default async function AcquisitionTodayPage({searchParams}: {
  searchParams: Promise<{page?: string}>;
}) {
  const requestedPage = Number((await searchParams).page ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const db = getSupabaseServiceClient();
  const [queue,pending,leadChoices,contactChoices,focus,zone] = await Promise.all([db.from("acquisition_today_queue")
    .select("id,address,locality,status,priority,next_action_type,next_action_at,source_type,queue_rank",{count:"exact"})
    .order("queue_rank",{ascending:true})
    .order("next_action_at",{ascending:true,nullsFirst:false})
    .order("id",{ascending:true})
    .range((page-1)*pageSize,page*pageSize-1),
  db.from("logbook_entries").select("id,title,note,next_action_type,next_action_at,property_id,contact_id,client_id")
    .not("next_action_at","is",null).is("action_completed_at",null)
    .lte("next_action_at",italianDayEnd(new Date()).toISOString()).order("next_action_at").limit(30),
  db.from("acquisition_leads").select("id,address").not("status","in",
    "(WON,FUTURE,NOT_INTERESTED,LOST)").order("updated_at",{ascending:false}).limit(80),
  db.from("acquisition_contacts").select("id,full_name").order("updated_at",{ascending:false}).limit(80),
  db.from("monthly_focus_overview").select("id,lead_id,contact_id,client_id,property_id,label,priority,status,last_event_at,next_action_at")
    .eq("month_start",`${parseMonth()}-01`).order("created_at",{ascending:false}).limit(12),
  db.from("logbook_entries").select("id,title,note,next_action_at,property_id,contact_id,client_id")
    .eq("event_type","zone_visit").not("next_action_at","is",null)
    .is("action_completed_at",null)
    .lte("next_action_at",italianDayEnd(new Date()).toISOString())
    .order("next_action_at").limit(12)]);
  for (const result of [queue,pending,leadChoices,contactChoices,focus,zone])
    if (result.error) throw new Error(`Coda Oggi: ${result.error.message}`);
  const {data,count} = queue;
  const pages = Math.max(1,Math.ceil((count ?? 0)/pageSize));
  const due = (data ?? []).filter(row=>row.queue_rank <= 1);
  const today = (data ?? []).filter(row=>row.queue_rank >= 2 && row.next_action_at);
  const noAction = (data ?? []).filter(row=>!row.next_action_at);
  const queueLine = (row:NonNullable<typeof data>[number])=><Link href={`/acquisition/${row.id}`} key={row.id}
    className="block border-b border-[var(--lr-line-quiet)] py-2.5 text-sm">
    <strong>{row.address}</strong> · {row.locality} · {row.priority} · {row.status}
    <span className="ml-2 text-[var(--lr-ink-2)]">{row.next_action_at
      ? `${row.next_action_type ?? "Azione"} · ${new Date(row.next_action_at).toLocaleString("it-IT",{timeZone:"Europe/Rome"})}`
      : "Imposta la prossima azione"}</span>
  </Link>;
  return <main className="space-y-4 p-4 md:p-6"><Link href="/acquisition" className="underline">Notizie</Link>
    <h1 className="text-2xl font-semibold">Oggi · {(count ?? 0)+(pending.data?.length ?? 0)} da lavorare</h1>
    <p>Appuntamenti, follow-up, lead A, azioni del Diario e opportunità senza prossimo passo.</p>
    <nav className="flex flex-wrap gap-3 text-sm underline">
      <Link href="/logbook">Diario</Link><Link href="/logbook/month">Mese</Link>
      <Link href="/acquisition/stale">Senza movimento</Link><Link href="/cerca">Cerca</Link>
    </nav>
    <QuickLogbook leads={(leadChoices.data ?? []).map(x=>({id:x.id,label:x.address}))}
      contacts={(contactChoices.data ?? []).map(x=>({id:x.id,label:x.full_name}))}/>
    {(pending.data ?? []).length > 0 && <section>
      <h2 className="mb-1 text-lg font-semibold">Azioni del Diario</h2>
      {(pending.data ?? []).map(row=><div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm">
        <div><strong>{row.next_action_type ?? row.title}</strong> · {new Date(row.next_action_at!).toLocaleString("it-IT",{timeZone:"Europe/Rome"})}
          {row.note && <span> · {row.note}</span>}
          {(row.contact_id || row.client_id || row.property_id) && <Link className="ml-2 underline"
            href={row.contact_id || row.client_id ? `/contacts/${row.contact_id ?? row.client_id}`
              : `/casa/${row.property_id}#diario`}>Apri</Link>}</div>
        <form action={completeLogbookAction.bind(null,row.id)}><button className="rounded border px-2 py-1">Completata</button></form>
      </div>)}
    </section>}
    <section><h2 className="text-lg font-semibold">Adesso · {due.length}</h2>
      {due.map(queueLine)}{!due.length && <p className="py-2 text-sm">Nessuna urgenza scaduta.</p>}
    </section>
    <section><h2 className="text-lg font-semibold">Oggi e prossimi passi · {today.length}</h2>
      {today.map(queueLine)}{!today.length && <p className="py-2 text-sm">Nessun follow-up programmato in questa vista.</p>}
    </section>
    <section><h2 className="text-lg font-semibold">Focus del mese · {focus.data?.length ?? 0}</h2>
      {(focus.data ?? []).map(row=><Link key={row.id}
        href={row.lead_id ? `/acquisition/${row.lead_id}` : row.contact_id || row.client_id
          ? `/contacts/${row.contact_id ?? row.client_id}` : `/casa/${row.property_id}#diario`}
        className="block border-b py-2 text-sm underline">{row.label} · {row.priority ?? row.status ?? "Focus"}</Link>)}
      {!focus.data?.length && <Link href="/logbook/month" className="text-sm underline">Scegli un elemento da seguire →</Link>}
    </section>
    <section><h2 className="text-lg font-semibold">Zona · {zone.data?.length ?? 0}</h2>
      {(zone.data ?? []).map(row=><div key={row.id} className="border-b py-2 text-sm">
        <strong>{row.next_action_at && new Date(row.next_action_at).toLocaleDateString("it-IT",{timeZone:"Europe/Rome"})}</strong> · {row.note ?? row.title}
      </div>)}
      {!zone.data?.length && <p className="py-2 text-sm">Nessuna visita in zona programmata.</p>}
    </section>
    <section><h2 className="text-lg font-semibold">Senza prossima azione · {noAction.length}</h2>
      {noAction.map(queueLine)}
    </section>
    <nav className="flex gap-4" aria-label="Pagine della coda">
      {page > 1 && <Link className="underline" href={`/acquisition/today?page=${page-1}`}>Precedente</Link>}
      <span>Pagina {page} di {pages}</span>
      {page < pages && <Link className="underline" href={`/acquisition/today?page=${page+1}`}>Successiva</Link>}
    </nav>
  </main>;
}
