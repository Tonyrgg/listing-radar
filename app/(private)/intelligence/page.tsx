import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { Chip, EmptyState, Meta, buttonClass, controlClass } from "@/components/ui/primitives";
import { formatCurrency, formatDate, formatNumber, formatShouty } from "@/lib/formatting";
import { readNow } from "@/lib/clock";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { EXIT_LABELS, INTELLIGENCE_VIEWS, marketAgeLabel, readIntelligence, readAgencyMarketIntelligence, type IntelligenceView } from "@/lib/property-lifecycle/read-models/intelligence";
import { opportunityReasonLabel, evidenceSourceLabel, propertyStateLabel, humanize } from "@/lib/property-lifecycle/read-models/presentation";
import {PropertyNews} from '@/components/property-news';

export const metadata:Metadata={title:"Intelligence"};
const tabs={mercato:"Mercato",opportunita:"Opportunità",usciti:"Usciti",venduti:"Venduti"};
const filterKeys=["q","esito","agenzia","localita","zona","stato","giorni","punteggio","ribasso","tipo","prezzo_min","prezzo_max","mq_min","mq_max","ribassato","fonte","atti"];
const sourceOptions=["admaiora","futura","garofalo","iconacasa","momento","puntocasa","studisanti","studiocasa","trio","vistocasa","REMAX","WIKICASA","IMMOBILIARE","CASA","IDEALISTA"];
export default async function IntelligencePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  await connection();
  const params=await searchParams;
  const value=(key:string)=>typeof params[key]==="string"?params[key] as string:"";
  if(value('vista')==='notizie')return <div className="space-y-5"><PageHeader title="Intelligence" description="Immobili, pubblicazioni e storia del mercato di Bitonto, Palombaio e Mariotto."/><nav aria-label="Viste Intelligence" className="flex flex-wrap gap-2 border-b border-[var(--lr-line-quiet)] pb-3">{Object.entries({...tabs,notizie:'Notizie'}).map(([t,label])=><Link key={t} href={`?vista=${t}`} aria-current={t==='notizie'?'page':undefined} className={buttonClass(t==='notizie'?'secondary':'quiet')}>{label}</Link>)}</nav><PropertyNews params={params} now={await readNow()}/></div>;
  const requested=value("vista"),view:IntelligenceView=INTELLIGENCE_VIEWS.includes(requested as IntelligenceView)?requested as IntelligenceView:"mercato";
  const page=Math.max(1,Math.min(10000,Math.floor(Number(value("pagina"))||1)));
  const numeric=(key:string)=>value(key)===""?undefined:Number(value(key));
  const now=await readNow(),db=getSupabaseServiceClient();
  const [result,agencies,metrics]=await Promise.all([
    readIntelligence(db,{view,page,query:value("q"),classification:value("esito"),agency:value("agenzia"),locality:value("localita"),zone:value("zona"),state:value("stato"),minimumAge:numeric("giorni"),minimumScore:view==="opportunita"?numeric("punteggio"):undefined,minimumReduction:numeric("ribasso"),propertyType:value("tipo"),minimumPrice:numeric("prezzo_min"),maximumPrice:numeric("prezzo_max"),minimumSqm:numeric("mq_min"),maximumSqm:numeric("mq_max"),reduced:value("ribassato"),source:value("fonte"),publicRecords:value("atti")}).catch(()=>null),
    db.from("agencies").select("id,name").order("name"),
    view==="mercato"?readAgencyMarketIntelligence(db).catch(()=>[]):Promise.resolve([]),
  ]);
  const pageUrl=(next:number)=>{const q=new URLSearchParams({vista:view,pagina:String(next)});for(const key of filterKeys)if(value(key))q.set(key,value(key));return `?${q}`;};
  const field=(name:string,label:string,type="text",placeholder?:string)=><label key={name} className="flex min-w-0 flex-col gap-1"><span className="text-[length:var(--lr-text-meta)] font-medium">{label}</span><input className={controlClass()} name={name} defaultValue={value(name)} type={type} min={type==="number"?0:undefined} placeholder={placeholder}/></label>;
  const select=(name:string,label:string,options:Record<string,string>)=><label key={name} className="flex min-w-0 flex-col gap-1"><span className="text-[length:var(--lr-text-meta)] font-medium">{label}</span><select className={controlClass()} name={name} defaultValue={value(name)}><option value="">Tutti</option>{Object.entries(options).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>;
  return <div className="space-y-5">
    <PageHeader title="Intelligence" description="Immobili, pubblicazioni e storia del mercato di Bitonto, Palombaio e Mariotto."/>
    <nav aria-label="Viste Intelligence" className="flex flex-wrap gap-2 border-b border-[var(--lr-line-quiet)] pb-3">{INTELLIGENCE_VIEWS.map(t=><Link key={t} href={`?vista=${t}`} aria-current={t===view?"page":undefined} className={buttonClass(t===view?"secondary":"quiet")}>{tabs[t]}</Link>)}<Link href="?vista=notizie" className={buttonClass('quiet')}>Notizie</Link></nav>
    <form method="get" className="space-y-3">
      <input type="hidden" name="vista" value={view}/>
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto]">{field("q","Indirizzo o civico","search","Cerca nell’archivio…")}{select("agenzia","Agenzia",Object.fromEntries((agencies.data??[]).map(a=>[a.id,a.name])))}<button className={buttonClass("secondary")}>Cerca</button></div>
      <details open={filterKeys.slice(3).some(k=>value(k))||undefined} className="border-b border-[var(--lr-line-quiet)] pb-3"><summary className="cursor-pointer py-2 text-[length:var(--lr-text-meta)] font-medium">Filtra per territorio, caratteristiche e fonti</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {select("localita","Località",{Bitonto:"Bitonto",Palombaio:"Palombaio",Mariotto:"Mariotto"})}{field("zona","Zona dichiarata")}
          {select("stato","Stato",{ACTIVE:"Attivo",EXIT_PENDING:"Presenza da verificare",CLOSED_SOLD:"Concluso con segnale di vendita",OFF_MARKET_NO_SALE_EVIDENCE:"Uscita senza prova di vendita",CLOSED_SWITCHED:"Cambio agenzia",CLOSED_WITHDRAWN:"Ritirato",CLOSED_TO_PRIVATE:"Passato a privato"})}
          {field("tipo","Tipo immobile","text","Appartamento, villa, terreno?")}
          {field("prezzo_min","Prezzo minimo €","number")}{field("prezzo_max","Prezzo massimo €","number")}{field("mq_min","Superficie minima m²","number")}{field("mq_max","Superficie massima m²","number")}
          {field("giorni","Età mercato minima, giorni","number")}{select("ribassato","Ribassi confermati",{yes:"Con ribassi",no:"Senza ribassi osservati"})}{select("fonte","Fonte pubblicazione",Object.fromEntries(sourceOptions.map(s=>[s,s==="REMAX"?"RE/MAX":s==="IMMOBILIARE"?"Immobiliare.it":humanize(s)])))}
          {view==="opportunita"?field("punteggio","Punteggio minimo","number"):null}{field("ribasso","Riduzione minima %","number")}
          {view==="venduti"||view==="usciti"?select("esito","Classificazione uscita",EXIT_LABELS):null}
          {select("atti","Contesto territoriale",{specific:"Con documenti specifici dell’unità",building:"Con documenti dell’edificio",building_recent:"Con attività edificio, 90 giorni",street_recent:"In via con attività, 90 giorni",documents:"Con documenti pubblici, filtro precedente",recent:"Con atto recente, filtro precedente",signals:"Con nuovo segnale territoriale"})}
        </div><div className="mt-3 flex gap-2"><button className={buttonClass("secondary")}>Applica filtri</button><Link href={`?vista=${view}`} className={buttonClass("quiet")}>Azzera</Link></div>
      </details>
    </form>
    <Meta>{view==="mercato"?"Tutti gli immobili conosciuti, anche storici e non più rilevati. Una riga per immobile; tutte le commercializzazioni restano nel dossier.":view==="venduti"?"Segnali di vendita confermati e probabili. Ultimo asking e prezzo di vendita sono dati distinti: non conosciamo il prezzo di compravendita.":view==="opportunita"?"Interpretazione da verificare, con score e ragioni. Nessuna scadenza di incarico è dedotta dall’età. La nostra filiale è esclusa dalle opportunità competitor.":"Un’assenza non prova una vendita. La classificazione indica cosa sappiamo e quali prove restano da verificare."}</Meta>
    {!result?<EmptyState title="Archivio temporaneamente non disponibile" description="Impossibile leggere i dati aggiornati. Riprova tra poco; nessuna informazione è stata rimossa."/>:!result.rows.length?<EmptyState title="Nessun immobile con questi filtri" description="Amplia la ricerca o torna all’archivio completo." action={<Link href="/intelligence" className={buttonClass("secondary")}>Tutti gli immobili</Link>}/>:<div className="divide-y divide-[var(--lr-line-quiet)] border-y border-[var(--lr-line-quiet)]">
      {result.rows.map(row=>{
        const age=marketAgeLabel(row.first_seen_at,row.earliest_market_evidence_at,row.sold_at??row.sold_observed_at??now);
        const prov=row.market_evidence_provenance;
        const source=prov?.url?`${evidenceSourceLabel(prov.url)}, ${formatDate(prov.claimedAt??row.earliest_market_evidence_at)}`:`nostra osservazione, ${formatDate(row.first_seen_at)}`;
        return <article key={row.property_id} className="grid gap-3 py-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="min-w-0"><Link href={`/casa/${row.property_id}`} className="text-[length:var(--lr-text-record)] font-[650] hover:underline">{formatShouty(row.address)}</Link><p className="mt-1 text-[var(--lr-ink-2)]">{row.agency_name}{row.agency_role==="OUR_AGENCY"?" · Nostra filiale":""}</p><Meta>{[row.locality,row.zone_name,row.property_type?humanize(row.property_type):null,row.surface_sqm!=null?`${formatNumber(row.surface_sqm)} m²`:null,row.rooms!=null?`${formatNumber(row.rooms)} locali`:null].filter(Boolean).join(" · ")}</Meta><div className="mt-2"><Chip tone={row.exit_classification==="SOLD_CONFIRMED"?"ok":row.exit_classification==="MISSING_UNCONFIRMED"?"warn":"neutral"}>{EXIT_LABELS[row.exit_classification]??propertyStateLabel(row.property_state)}</Chip></div></div>
          <div><Meta>{view==="venduti"?"Ultimo prezzo richiesto":"Prezzo richiesto"}</Meta><p className="font-[650] [font-family:var(--lr-font-mono)]">{formatCurrency(row.latest_asking_price)}{row.reduction_percent!=null&&row.reduction_percent>0?<span className="ml-2 text-[var(--lr-ok)]">−{formatNumber(row.reduction_percent)}%</span>:null}</p>{row.first_asking_price!=null?<Meta>Primo osservato {formatCurrency(row.first_asking_price)}</Meta>:null}<Meta>{row.drop_count} ribassi confermati{row.source_price_conflict?" · prezzi diversi tra fonti":""}</Meta>{row.sold_at?<Meta>Vendita dichiarata {formatDate(row.sold_at)}</Meta>:row.sold_observed_at?<Meta>Segnale vendita osservato {formatDate(row.sold_observed_at)}</Meta>:null}{row.exit_confidence!=null&&view!=="mercato"?<Meta>Certezza classificazione {Math.round(row.exit_confidence*100)}%</Meta>:null}</div>
          <div><p title={`Prima evidenza: ${source}`} className="font-medium">{age}</p><Meta>Monitorato dal {formatDate(row.first_seen_at)}</Meta><Meta>Ultima presenza {formatDate(row.last_seen_at)}</Meta><Meta>{row.publication_count??0} pubblicazioni · {row.evidence_count??0} prove{row.document_count?` · ${row.document_count} pratiche edificio`:""}</Meta>{row.agent_name?<Meta>Agente: {row.agent_name}</Meta>:null}{row.publication_date_disagreement?<Meta>Date dichiarate discordanti: consulta le prove.</Meta>:null}</div>
          <div className="flex items-start lg:justify-end"><Link href={`/casa/${row.property_id}`} className={buttonClass("secondary",{compact:true})}>Apri dossier</Link></div>
          {view==="opportunita"?<details className="lg:col-span-4"><summary className="cursor-pointer py-1 font-medium">{formatNumber(row.opportunity_score??0)}/100 · Perché compare qui</summary><p className="text-[length:var(--lr-text-meta)]">{(row.reasons??[]).map(opportunityReasonLabel).join(" · ")}</p><Meta>Versione {String(row.evidence_summary?.scoreVersion??"non dichiarata")}. Il punteggio ordina gli indizi e non misura una probabilità verificata.</Meta></details>:null}
          <details className="lg:col-span-4"><summary className="cursor-pointer py-1 text-[length:var(--lr-text-meta)]">Fonti e date</summary><Meta>Prima evidenza pubblica: {formatDate(row.earliest_market_evidence_at)} · {source}</Meta><Meta>Ultima revisione scheda {formatDate(row.updated_at??row.last_seen_at)} · Fonti: {(row.publication_sources??[]).join(", ")||"da verificare"}</Meta>{row.price_source_url?<a href={row.price_source_url} target="_blank" rel="noreferrer" className="text-[length:var(--lr-text-meta)] underline">Provenienza del prezzo richiesto</a>:null}</details>
        </article>;
      })}
    </div>}
    <nav aria-label="Pagine dell’archivio" className="flex items-center justify-between gap-3">{page>1?<Link className={buttonClass("secondary")} href={pageUrl(page-1)}>Precedenti</Link>:<span/>}<Meta>Pagina {page}</Meta>{result?.hasNext?<Link className={buttonClass("secondary")} href={pageUrl(page+1)}>Successivi</Link>:<span/>}</nav>
    {metrics.length?<details className="border-t border-[var(--lr-line-quiet)] pt-3"><summary className="cursor-pointer py-2 font-medium">Agenzie · portafoglio osservato</summary><Meta>Campione monitorato, non statistiche definitive sul mercato.</Meta><div className="divide-y divide-[var(--lr-line-quiet)]">{metrics.map(a=><div key={a.agency_id} className="grid gap-1 py-3 sm:grid-cols-2"><strong>{a.name}</strong><p>{a.active_listings} attivi · {a.sold_observed} segnali vendita · {a.median_known_age==null?"età non ricostruita":`${formatNumber(a.median_known_age)} gg, età mediana`} · {a.unknown_exit_count} uscite senza esito</p></div>)}</div></details>:null}
  </div>;
}
