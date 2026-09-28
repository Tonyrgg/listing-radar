import Link from "next/link";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { romeLocalToUtc } from "@/lib/acquisition/time";
import { adjacentMonth,parseMonth,type LogbookEvent } from "@/lib/logbook";
import { LogbookEventRow } from "@/components/logbook-event-row";
import { QuickLogbook } from "@/components/quick-logbook";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const metadata = { title: "Diario" };
const pageSize = 40;
const filters = [
  ["all","Tutto"],["market","Mercato"],["calls","Chiamate"],["field","Zona"],
  ["intelligence","Notizie"],["followup","Follow-up"],
  ["acquisition","Acquisizioni"],["mandate","Incarichi"],
] as const;
type Params = {filter?:string;month?:string;locality?:string;source?:string;
  contact?:string;client?:string;property?:string;lead?:string;page?:string};
const validId = (value?:string) => z.uuid().safeParse(value).success;

export default async function LogbookPage({searchParams}:{searchParams:Promise<Params>}) {
  const p = await searchParams;
  const selected = filters.some(([key])=>key === p.filter) ? p.filter ?? "all" : "all";
  const page = Math.min(1000,Math.max(1,Number.parseInt(p.page ?? "1",10) || 1));
  const db = getSupabaseServiceClient();
  let query = db.from("universal_logbook").select(
    "id,event_category,event_type,source_type,property_id,contact_id,client_id,lead_id,request_id,occurred_at,title,description,outcome,importance,requires_action,next_action_type,next_action_at,address,locality,person_name,automatic,sensitive",
  );
  if (selected === "market") query = query.eq("event_category","MARKET");
  if (selected === "calls") query = query.eq("event_type","phone_call");
  if (selected === "field") query = query.eq("event_category","FIELD");
  if (selected === "intelligence") query = query.eq("event_category","INTELLIGENCE");
  if (selected === "followup") query = query.in("outcome",["FOLLOW_UP","follow_up_done"]);
  if (selected === "acquisition") query = query.in("event_type",["appointment_booked","acquisition"]);
  if (selected === "mandate") query = query.eq("outcome","mandate");
  if (p.month && parseMonth(p.month) === p.month) {
    query = query.gte("occurred_at",romeLocalToUtc(`${p.month}-01T00:00`).toISOString())
      .lt("occurred_at",romeLocalToUtc(`${adjacentMonth(p.month,1)}-01T00:00`).toISOString());
  }
  if (["Bitonto","Palombaio","Mariotto"].includes(p.locality ?? ""))
    query = query.eq("locality",p.locality!);
  if (p.source && p.source.length < 80) query = query.eq("source_type",p.source);
  if (validId(p.contact)) query = query.eq("contact_id",p.contact!);
  if (validId(p.client)) query = query.eq("client_id",p.client!);
  if (validId(p.property)) query = query.eq("property_id",p.property!);
  if (validId(p.lead)) query = query.eq("lead_id",p.lead!);
  const [events,leadChoices,contactChoices] = await Promise.all([
    query.order("occurred_at",{ascending:false}).order("id",{ascending:false})
      .range((page-1)*pageSize,page*pageSize),
    db.from("acquisition_leads").select("id,address").not("status","in",
      "(WON,FUTURE,NOT_INTERESTED,LOST)").order("updated_at",{ascending:false}).limit(80),
    db.from("acquisition_contacts").select("id,full_name").order("updated_at",{ascending:false}).limit(80),
  ]);
  for (const result of [events,leadChoices,contactChoices])
    if (result.error) throw new Error(`Diario: ${result.error.message}`);
  const rows = (events.data ?? []) as LogbookEvent[];
  const shown = rows.slice(0,pageSize);
  const link = (filter:string,pageNumber=1) => {
    const params = new URLSearchParams();
    for (const key of ["month","locality","source","contact","client","property","lead"] as const)
      if (p[key]) params.set(key,p[key]!);
    if (filter !== "all") params.set("filter",filter);
    if (pageNumber > 1) params.set("page",String(pageNumber));
    const suffix = params.toString();
    return `/logbook${suffix ? `?${suffix}` : ""}`;
  };
  return <main className="space-y-4 p-4 md:p-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--lr-ink-3)]">Attività e mercato</p>
        <h1 className="text-2xl font-semibold">Diario</h1>
        <p className="text-sm text-[var(--lr-ink-2)]">Ogni movimento significativo, in ordine cronologico.</p></div>
      <nav className="flex gap-3 text-sm underline">
        <Link href="/logbook/month">Mese</Link><Link href="/acquisition/stale">Senza movimento</Link>
        <Link href="/cerca">Cerca</Link>
      </nav>
    </header>
    <QuickLogbook leads={(leadChoices.data ?? []).map(x=>({id:x.id,label:x.address}))}
      contacts={(contactChoices.data ?? []).map(x=>({id:x.id,label:x.full_name}))}/>
    <nav className="flex gap-1 overflow-x-auto border-b border-[var(--lr-line-quiet)] pb-2" aria-label="Filtri diario">
      {filters.map(([key,label])=><Link key={key} href={link(key)}
        aria-current={selected === key ? "page" : undefined}
        className={`shrink-0 rounded px-2.5 py-1.5 text-sm ${selected === key
          ? "bg-[var(--lr-ink)] text-white" : "hover:bg-[var(--lr-raised)]"}`}>{label}</Link>)}
    </nav>
    <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
      {selected !== "all" && <input type="hidden" name="filter" value={selected}/>}
      <label>Mese<input name="month" type="month" defaultValue={p.month ?? ""}
        className="ml-2 rounded border p-1.5"/></label>
      <label>Località<select name="locality" defaultValue={p.locality ?? ""}
        className="ml-2 rounded border p-1.5"><option value="">Tutte</option>
        {["Bitonto","Palombaio","Mariotto"].map(x=><option key={x}>{x}</option>)}
      </select></label>
      <label>Fonte<input name="source" defaultValue={p.source ?? ""}
        className="ml-2 w-36 rounded border p-1.5"/></label>
      {p.contact && <input type="hidden" name="contact" value={p.contact}/>}
      {p.client && <input type="hidden" name="client" value={p.client}/>}
      {p.property && <input type="hidden" name="property" value={p.property}/>}
      {p.lead && <input type="hidden" name="lead" value={p.lead}/>}
      <button className="rounded border px-3 py-1.5">Filtra</button>
    </form>
    <section aria-label="Eventi del diario" className="border-t border-[var(--lr-line)]">
      {shown.length ? shown.map(event=><LogbookEventRow key={event.id} event={event}/>)
        : <div className="py-8 text-sm text-[var(--lr-ink-2)]">Nessun movimento per questi filtri.
          <Link href="/acquisition" className="ml-2 underline">Registra una notizia</Link></div>}
    </section>
    <nav className="flex items-center justify-between text-sm" aria-label="Pagine del diario">
      {page > 1 ? <Link href={link(selected,page-1)} className="underline">← Più recenti</Link> : <span/>}
      <span>Pagina {page}</span>
      {rows.length > pageSize ? <Link href={link(selected,page+1)} className="underline">Più vecchi →</Link> : <span/>}
    </nav>
  </main>;
}
