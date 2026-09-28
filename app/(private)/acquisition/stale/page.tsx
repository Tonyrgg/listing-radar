import Link from "next/link";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { parseMonth } from "@/lib/logbook";

export const dynamic = "force-dynamic";
export const metadata = { title: "Senza movimento" };
type Row = {id:string;address:string;locality:string;status:string;priority:string;
  next_action_type:string|null;next_action_at:string|null;last_movement_at:string;reason:string};
type Focus = {id:string;contact_id:string|null;client_id:string|null;property_id:string|null;lead_id:string|null;
  label:string;last_event_at:string|null;next_action_at:string|null};
function days(raw:string|null,now:number) {
  return raw ? Math.max(0,Math.floor((now-new Date(raw).getTime())/86400000)) : null;
}

export default async function StalePage({searchParams}:{searchParams:Promise<{
  a?:string;b?:string;c?:string;page?:string}>}) {
  const p = await searchParams;
  const threshold = (raw:string|undefined,fallback:number) => {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 1 && n <= 60 ? n : fallback;
  };
  const a = threshold(p.a,3), b = threshold(p.b,7), c = threshold(p.c,14);
  const page = Math.min(1000,Math.max(1,Number.parseInt(p.page ?? "1",10) || 1));
  const month = parseMonth();
  const db = getSupabaseServiceClient();
  const [staleResult,focusResult] = await Promise.all([
    db.rpc("acquisition_stale",{p_a_days:a,p_b_days:b,p_c_days:c})
      .select("*").range((page-1)*40,page*40),
    db.from("monthly_focus_overview").select(
      "id,contact_id,client_id,property_id,lead_id,label,last_event_at,next_action_at")
      .eq("month_start",`${month}-01`).limit(100),
  ]);
  for (const result of [staleResult,focusResult])
    if (result.error) throw new Error(`Senza movimento: ${result.error.message}`);
  const rows = (staleResult.data ?? []) as Row[];
  const now = new Date().getTime();
  const forgottenFocus = ((focusResult.data ?? []) as Focus[]).filter(x=>
    !x.lead_id && (!x.next_action_at || days(x.last_event_at,now)! >= 7));
  const route = (n:number) => `?a=${a}&b=${b}&c=${c}&page=${n}`;
  return <main className="space-y-5 p-4 md:p-6">
    <header><Link href="/acquisition/today" className="text-sm underline">Coda Oggi</Link>
      <h1 className="text-2xl font-semibold">Senza movimento</h1>
      <p className="text-sm text-[var(--lr-ink-2)]">Azioni scadute, piste senza prossimo passo e opportunità ferme.</p>
    </header>
    <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
      {[["a","Priorità A",a],["b","Priorità B",b],["c","Priorità C",c]].map(([key,label,value])=>
        <label key={key}> {label} · giorni
          <input name={String(key)} type="number" min="1" max="60" defaultValue={Number(value)}
            className="ml-2 w-16 rounded border p-1.5"/></label>)}
      <button className="rounded border px-3 py-1.5">Aggiorna soglie</button>
    </form>
    <section className="border-t border-[var(--lr-line)]">
      {rows.slice(0,40).map(row=><Link key={row.id} href={`/acquisition/${row.id}`}
        className="grid gap-1 border-b border-[var(--lr-line-quiet)] py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_10rem_9rem]">
        <span><strong>{row.address}</strong> · {row.locality}
          <span className="ml-2 text-xs text-[var(--lr-ink-3)]">{row.priority} · {row.status.replaceAll("_"," ")}</span></span>
        <span className={row.reason === "Azione scaduta" ? "font-semibold text-red-700" : "text-amber-700"}>{row.reason}</span>
        <span className="text-[var(--lr-ink-2)]">Ultimo movimento {days(row.last_movement_at,now)} giorni fa</span>
      </Link>)}
      {!rows.length && <p className="py-6 text-sm text-[var(--lr-ink-2)]">Nessuna pista ferma con queste soglie.</p>}
    </section>
    <nav className="flex justify-between text-sm">
      {page>1 ? <Link href={route(page-1)} className="underline">← Precedente</Link> : <span/>}
      {rows.length>40 ? <Link href={route(page+1)} className="underline">Successiva →</Link> : <span/>}
    </nav>
    {forgottenFocus.length>0 && <section>
      <h2 className="mb-2 text-lg font-semibold">Focus senza movimento</h2>
      {forgottenFocus.map(x=><Link key={x.id}
        href={x.contact_id || x.client_id ? `/contacts/${x.contact_id ?? x.client_id}` : `/casa/${x.property_id}#diario`}
        className="block border-b border-[var(--lr-line-quiet)] py-2 text-sm underline">
        {x.label} · {x.last_event_at ? `${days(x.last_event_at,now)} giorni` : "nessun evento"}
        {!x.next_action_at && " · senza prossima azione"}
      </Link>)}
    </section>}
  </main>;
}
