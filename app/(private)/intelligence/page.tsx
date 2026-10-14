import { ArrowRight, CheckCircle2, ExternalLink, Filter, History, RefreshCw, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { Card, Chip, EmptyState, Meta, buttonClass } from "@/components/ui/primitives";
import { PendingSubmitButton } from "@/components/loading-controls";
import { formatCurrency, formatDate, formatNumber, formatShouty } from "@/lib/formatting";
import { readNow } from "@/lib/clock";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { EXIT_LABELS, INTELLIGENCE_VIEWS, observableDays, readIntelligence, type IntelligenceView } from "@/lib/property-lifecycle/read-models/intelligence";
import { opportunityReasonLabel } from "@/lib/property-lifecycle/read-models/presentation";
import { enqueueGlobalLifecycleRefresh } from "../lifecycle/actions";

export const metadata: Metadata={title:"Intelligence"};
const tabs: Record<IntelligenceView,string>={mercato:"Mercato",opportunita:"Opportunità",usciti:"Usciti",venduti:"Venduti"};
export default async function IntelligencePage({searchParams}: {searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  await connection();
  const params=await searchParams;
  const value=(key:string)=>typeof params[key] === "string" ? params[key] as string : "";
  const requested=value("vista");
  const view: IntelligenceView=INTELLIGENCE_VIEWS.includes(requested as IntelligenceView) ? requested as IntelligenceView : "mercato";
  const page=Math.max(1,Math.min(10000,Math.floor(Number(value("pagina"))||1)));
  const q=value("q").slice(0,120), classification=value("esito");
  const now=await readNow();
  let result: Awaited<ReturnType<typeof readIntelligence>> | null=null;
  let failed=false;
  try { result=await readIntelligence(getSupabaseServiceClient(),{view,page,query:q,classification}); } catch { failed=true; }
  const pageUrl=(next:number)=>`?${new URLSearchParams({vista:view,pagina:String(next),...(q?{q}:{}),...(classification?{esito:classification}:{})})}`;
  return <div className="space-y-5">
    <PageHeader eyebrow="Intelligence" title={tabs[view]} description="Pubblicazioni, variazioni e opportunità, con le prove che le sostengono."
      actions={<form action={enqueueGlobalLifecycleRefresh}><PendingSubmitButton className={buttonClass("secondary")} pendingLabel="Metto in coda" icon={<RefreshCw aria-hidden="true" className="size-4"/>}>Rileggi le fonti</PendingSubmitButton></form>}/>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--lr-line-quiet)] pb-3">
      <nav className="flex flex-wrap gap-2" aria-label="Viste Intelligence">
        {INTELLIGENCE_VIEWS.map(tab=><Link key={tab} href={`?vista=${tab}`} className={buttonClass(tab===view?"secondary":"quiet")} aria-current={tab===view?"page":undefined}>{tabs[tab]}</Link>)}
      </nav>
      <div className="flex flex-wrap gap-2"><Link href="/fonti" className={buttonClass("quiet")}>Salute delle fonti</Link><Link href="/lifecycle/review" className={buttonClass("quiet")}>Da verificare</Link></div>
    </div>
    <form className="flex flex-wrap items-end gap-3" method="get">
      <input type="hidden" name="vista" value={view}/>
      <label className="flex min-w-0 flex-1 flex-col gap-1"><span className="text-[length:var(--lr-text-meta)] font-medium">Cerca indirizzo</span>
        <input name="q" defaultValue={q} placeholder="Via o civico" className="min-h-11 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-surface)] px-3"/>
      </label>
      {(view==="usciti"||view==="venduti")?<label className="flex flex-col gap-1"><span className="text-[length:var(--lr-text-meta)] font-medium">Esito</span><select name="esito" defaultValue={classification} className="min-h-11 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-surface)] px-3"><option value="">Tutti gli esiti</option>{Object.entries(EXIT_LABELS).filter(([key])=>view==="venduti"?["SOLD_CONFIRMED","SOLD_PROBABLE"].includes(key):!["ACTIVE","UNDER_OFFER","EXPIRED_POSSIBLE"].includes(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>:null}
      <button className={buttonClass("secondary")}><Search aria-hidden="true" className="size-4"/>Cerca</button>
      {(q||classification)?<Link href={`?vista=${view}`} className={buttonClass("quiet")}><Filter aria-hidden="true" className="size-4"/>Azzera filtri</Link>:null}
    </form>
    <Meta>{view==="venduti"?"Vendite confermate e probabili, distinguibili per esito e certezza. La data è quella del segnale osservato, non del rogito.":view==="opportunita"?"Punteggio di opportunità da 0 a 100: ogni contributo è spiegato nella scheda. Nessuna scadenza contrattuale è dedotta dall’età dell’annuncio.":"La scomparsa di una pubblicazione non prova da sola l’uscita dell’immobile dal mercato."}</Meta>
    {failed?<Card className="p-5"><EmptyState title="Intelligence non disponibile" description="Verifica che le migrazioni Market Observer siano state applicate e che il database sia raggiungibile."/></Card>:!result?.rows.length?<Card className="p-5"><EmptyState title="Nessun risultato in questa vista" description="Le evidenze arrivano dalle scansioni delle fonti. Cambia i filtri o consulta il mercato attivo." action={<Link href="?vista=mercato" className={buttonClass("secondary")}>Vai al mercato</Link>}/></Card>:<Card>
      {result.rows.map(row=>{
        const age=observableDays(row.earliest_market_evidence_at,row.sold_at ?? now);
        const reasons=(row.reasons??[]).filter(reason=>!["no_sale_evidence","no_new_agency_evidence","no_current_opportunity_signal","sold_confirmed"].includes(reason));
        return <article key={row.row_id} className="grid gap-3 border-t border-[var(--lr-line-quiet)] p-4 first:border-t-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)_auto]">
          <div className="min-w-0"><Link href={`/casa/${row.property_id}`} className="text-[length:var(--lr-text-record)] font-[650] hover:underline">{formatShouty(row.address)}</Link><p className="mt-1 text-[var(--lr-ink-2)]">{row.agency_name}{row.locality?` · ${row.locality}`:""}</p><div className="mt-2"><Chip tone={row.exit_classification==="SOLD_CONFIRMED"?"ok":row.exit_classification==="MISSING_UNCONFIRMED"?"warn":"neutral"}>{row.exit_classification==="SOLD_CONFIRMED"?<CheckCircle2 aria-hidden="true" className="size-3.5"/>:null}{EXIT_LABELS[row.exit_classification]??"Da verificare"}</Chip></div></div>
          <div className="min-w-0"><p className="font-[650] [font-family:var(--lr-font-mono)]">{formatCurrency(row.latest_asking_price)}{row.reduction_percent!=null&&row.reduction_percent>0?<span className="ml-3 text-[var(--lr-ok)]">−{formatNumber(row.reduction_percent)}%</span>:null}</p><Meta>{row.first_asking_price!=null?`Primo prezzo ${formatCurrency(row.first_asking_price)} · `:""}{row.drop_count??0} ribassi osservati</Meta><p className="mt-2 text-[length:var(--lr-text-meta)]">Sul mercato almeno dal {formatDate(row.earliest_market_evidence_at)}{age!=null?` · ${age}${row.sold_at?" giorni osservabili":"+ giorni"}`:""}</p><Meta>{row.sold_at?`Vendita osservata il ${formatDate(row.sold_at)}`:`Ultima presenza ${formatDate(row.last_seen_at)}`}{row.exit_confidence!=null?` · certezza ${Math.round(Number(row.exit_confidence)*100)}%`:""}</Meta>{view==="opportunita"?<p className="mt-2 text-[length:var(--lr-text-meta)]"><strong>{formatNumber(row.opportunity_score??0)}/100</strong> · {reasons.slice(0,2).map(opportunityReasonLabel).join(" · ")}</p>:null}</div>
          <div className="flex flex-wrap items-start gap-2 lg:flex-col"><Link href={`/casa/${row.property_id}`} className={buttonClass("secondary")}><ArrowRight aria-hidden="true" className="size-4"/>Apri scheda</Link>{row.price_source_url?<a href={row.price_source_url} target="_blank" rel="noreferrer" className={buttonClass("quiet")}><ExternalLink aria-hidden="true" className="size-4"/>Fonte prezzo</a>:null}</div>
        </article>;
      })}
    </Card>}
    <nav className="flex items-center justify-between gap-3" aria-label="Pagine dei risultati">{page>1?<Link href={pageUrl(page-1)} className={buttonClass("secondary")}>Precedenti</Link>:<span/>}<Meta>Pagina {page}</Meta>{result?.hasNext?<Link href={pageUrl(page+1)} className={buttonClass("secondary")}>Successivi</Link>:<span/>}</nav>
    <Meta><History aria-hidden="true" className="mr-1 inline size-3.5"/>Ogni riga rappresenta una commercializzazione osservata: la stessa casa può essere presente presso più agenzie.</Meta>
  </div>;
}
