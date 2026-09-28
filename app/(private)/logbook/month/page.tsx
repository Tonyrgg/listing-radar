import Link from "next/link";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { adjacentMonth,monthTitle,parseMonth } from "@/lib/logbook";
import { setMonthlyFocusAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mese operativo" };
type FocusRow = {id:string;month_start:string;lead_id:string|null;contact_id:string|null;
  client_id:string|null;
  property_id:string|null;label:string;priority:string|null;status:string|null;
  next_action_type:string|null;next_action_at:string|null;last_event_at:string|null};
type Summary = {events:number;people:number;properties:number;activities:number;
  signals:number;new_leads:number;calls:number;conversations:number;followups:number;
  zone_visits:number;booked:number;completed:number;mandates:number;
  productive_days:number;lost:number;by_source:{name:string;count:number}[];
  pipeline:{open:number;a:number;b:number;overdue:number;without_action:number}};
const open = ["NEW","VERIFY","TO_CONTACT","CONTACTED","CONVERSATION","FOLLOW_UP",
  "ACQUISITION_BOOKED","ACQUISITION_DONE"];

function FocusLine({row,month,carry=false}:{row:FocusRow;month:string;carry?:boolean}) {
  const entity = row.lead_id ? "lead" : row.contact_id ? "contact" : row.client_id ? "client" : "property";
  const id = row.lead_id ?? row.contact_id ?? row.client_id ?? row.property_id!;
  const href = row.lead_id ? `/acquisition/${id}` : row.contact_id
    ? `/contacts/${id}` : row.client_id ? `/contacts/${id}` : `/casa/${id}#diario`;
  const last = row.last_event_at ? new Date(row.last_event_at).toLocaleDateString("it-IT",{
    timeZone:"Europe/Rome"}) : "Nessun movimento";
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--lr-line-quiet)] py-2 text-sm">
    <div><Link href={href} className="font-semibold underline underline-offset-2">{row.label}</Link>
      <span className="ml-2 text-[var(--lr-ink-2)]">{row.priority ?? ""} {row.status ?? ""}</span>
      <p className="text-xs text-[var(--lr-ink-3)]">Ultimo movimento: {last}
        {row.next_action_at && ` · ${row.next_action_type ?? "Azione"} ${new Date(row.next_action_at).toLocaleDateString("it-IT",{timeZone:"Europe/Rome"})}`}</p>
    </div>
    <form action={setMonthlyFocusAction}>
      <input type="hidden" name="month" value={month}/>
      <input type="hidden" name="entity" value={entity}/>
      <input type="hidden" name="entity_id" value={id}/>
      <input type="hidden" name="enabled" value={String(carry)}/>
      <button className="rounded border px-2 py-1 text-xs">{carry ? "Porta nel Focus" : "Rimuovi"}</button>
    </form>
  </div>;
}

export default async function MonthPage({searchParams}:{searchParams:Promise<{month?:string}>}) {
  const month = parseMonth((await searchParams).month);
  const db = getSupabaseServiceClient();
  const [summaryResult,focusResult,previousResult,leadsResult] = await Promise.all([
    db.rpc("logbook_month_summary",{p_month:`${month}-01`}),
    db.from("monthly_focus_overview").select("*").eq("month_start",`${month}-01`)
      .order("created_at",{ascending:false}).limit(100),
    db.from("monthly_focus_overview").select("*")
      .eq("month_start",`${adjacentMonth(month,-1)}-01`).limit(100),
    db.from("acquisition_leads").select("id,address,priority,status")
      .in("status",open).order("updated_at",{ascending:false}).limit(100),
  ]);
  for (const result of [summaryResult,focusResult,previousResult,leadsResult])
    if (result.error) throw new Error(`Mese operativo: ${result.error.message}`);
  const stats = summaryResult.data as Summary;
  const focus = (focusResult.data ?? []) as FocusRow[];
  const focusIds = new Set(focus.map(x=>x.lead_id ?? x.contact_id ?? x.client_id ?? x.property_id));
  const carry = ((previousResult.data ?? []) as FocusRow[]).filter(x=>
    !focusIds.has(x.lead_id ?? x.contact_id ?? x.client_id ?? x.property_id)
    && (!x.lead_id || open.includes(x.status ?? "")));
  const groups = [
    ["Attività",[["Persone lavorate",stats.people],["Immobili lavorati",stats.properties],
      ["Attività",stats.activities],["Notizie",stats.signals],["Nuove piste",stats.new_leads]]],
    ["Prospecting",[["Telefonate",stats.calls],["Conversazioni",stats.conversations],
      ["Follow-up svolti",stats.followups],["Zona",stats.zone_visits]]],
    ["Conversione",[["Acquisizioni fissate",stats.booked],["Acquisizioni svolte",stats.completed],
      ["Incarichi",stats.mandates]]],
    ["Salute attuale",[["Lead A",stats.pipeline.a],["Lead B",stats.pipeline.b],
      ["Piste aperte",stats.pipeline.open],["Scaduti",stats.pipeline.overdue],
      ["Senza azione",stats.pipeline.without_action]]],
  ] as const;
  return <main className="space-y-6 p-4 md:p-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><Link href="/logbook" className="text-sm underline">Diario</Link>
        <h1 className="text-2xl font-semibold">{monthTitle(month)}</h1>
        <p className="text-sm text-[var(--lr-ink-2)]">{stats.productive_days} giorni con attività · {stats.events} movimenti registrati</p>
      </div>
      <nav className="flex gap-4 text-sm underline" aria-label="Navigazione mesi">
        <Link href={`?month=${adjacentMonth(month,-1)}`}>← {monthTitle(adjacentMonth(month,-1))}</Link>
        <Link href={`?month=${adjacentMonth(month,1)}`}>{monthTitle(adjacentMonth(month,1))} →</Link>
      </nav>
    </header>
    <div className="grid gap-5 lg:grid-cols-2">
      {groups.map(([heading,values])=><section key={heading}>
        <h2 className="mb-2 border-b border-[var(--lr-line)] pb-1 text-sm font-semibold uppercase tracking-wide">{heading}</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {values.map(([label,value])=><div key={label}><strong className="text-xl tabular-nums">{value}</strong>
            <p className="text-xs text-[var(--lr-ink-2)]">{label}</p></div>)}
        </div>
      </section>)}
    </div>
    <section className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(15rem,1fr)]">
      <div><div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Focus del mese · {focus.length}</h2>
        <Link href="/cerca" className="text-sm underline">Trova persona o immobile</Link></div>
        {focus.length ? focus.map(row=><FocusLine key={row.id} row={row} month={month}/>)
          : <p className="py-4 text-sm text-[var(--lr-ink-2)]">Nessun elemento nel Focus. Aggiungi una pista, persona o casa da seguire.</p>}
        <form action={setMonthlyFocusAction} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="month" value={month}/>
          <input type="hidden" name="entity" value="lead"/>
          <input type="hidden" name="enabled" value="true"/>
          <label>Aggiungi opportunità<select name="entity_id" required defaultValue=""
            className="ml-2 max-w-[17rem] rounded border p-1.5">
            <option value="" disabled>Seleziona una pista</option>
            {(leadsResult.data ?? []).filter(x=>!focusIds.has(x.id)).map(x=>
              <option key={x.id} value={x.id}>{x.address} · {x.priority}</option>)}
          </select></label>
          <button className="rounded border px-3 py-1.5">Aggiungi</button>
        </form>
      </div>
      <aside><h2 className="text-lg font-semibold">Da riportare</h2>
        <p className="mb-2 text-xs text-[var(--lr-ink-2)]">Elementi del Focus precedente ancora aperti.</p>
        {carry.length ? carry.map(row=><FocusLine key={row.id} row={row} month={month} carry/>)
          : <p className="text-sm text-[var(--lr-ink-2)]">Nessun elemento da riportare.</p>}
      </aside>
    </section>
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Riepilogo del mese</h2>
      <p className="text-sm">Piste perse: {stats.lost} · Giorni produttivi: {stats.productive_days}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {(stats.by_source ?? []).map(x=><span key={x.name}>{x.name}: {x.count}</span>)}
      </div>
      <Link href={`/logbook?month=${month}`} className="text-sm underline">Apri tutti i movimenti del mese</Link>
    </section>
  </main>;
}
