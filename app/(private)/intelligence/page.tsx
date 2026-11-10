import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState, Meta, buttonClass, controlClass } from "@/components/ui/primitives";
import { formatCurrency, formatNumber } from "@/lib/formatting";
import { readNow } from "@/lib/clock";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { EXIT_LABELS, INTELLIGENCE_VIEWS, readIntelligence, readAgencyMarketIntelligence, type IntelligenceView } from "@/lib/property-lifecycle/read-models/intelligence";
import { propertyStateLabel, humanize } from "@/lib/property-lifecycle/read-models/presentation";
import {IntelligenceNavigation, IntelligenceRegister, INTELLIGENCE_VIEW_COPY} from "@/components/intelligence-register";
import {PropertyNews} from '@/components/property-news';
import {readPropertyThumbnails} from '@/lib/lifecycle-photos';

export const metadata:Metadata={title:"Intelligence"};
const filterKeys=["q","esito","agenzia","localita","zona","stato","giorni","punteggio","ribasso","tipo","prezzo_min","prezzo_max","mq_min","mq_max","ribassato","fonte","atti"];
const sourceOptions=["admaiora","futura","garofalo","iconacasa","momento","puntocasa","studisanti","studiocasa","trio","vistocasa","REMAX","WIKICASA","IMMOBILIARE","CASA","IDEALISTA"];
export default async function IntelligencePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  await connection();
  const params=await searchParams;
  const value=(key:string)=>typeof params[key]==="string"?params[key] as string:"";
  if(value('vista')==='notizie')return <div className="space-y-5"><PageHeader eyebrow="Intelligence" title="Intelligence immobiliare" description="Immobili, trasformazioni e prove del territorio."/><IntelligenceNavigation view="notizie"/><PropertyNews params={params} now={await readNow()}/></div>;
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
  const photos=result&&view!=="opportunita"?await readPropertyThumbnails(result.rows.map(r=>r.property_id)).catch(()=>({})):{};
  const field=(name:string,label:string,type="text",placeholder?:string)=><label key={name} className="flex min-w-0 flex-col gap-1"><span className="text-[length:var(--lr-text-meta)] font-medium">{label}</span><input className={controlClass()} name={name} defaultValue={value(name)} type={type} min={type==="number"?0:undefined} placeholder={placeholder}/></label>;
  const select=(name:string,label:string,options:Record<string,string>)=><label key={name} className="flex min-w-0 flex-col gap-1"><span className="text-[length:var(--lr-text-meta)] font-medium">{label}</span><select className={controlClass()} name={name} defaultValue={value(name)}><option value="">Tutti</option>{Object.entries(options).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>;
  const filterDisplay=(key:string)=>{
    const raw=value(key);
    if(key==='agenzia')return (agencies.data??[]).find(a=>a.id===raw)?.name??'Agenzia selezionata';
    if(key==='esito')return EXIT_LABELS[raw]??'Esito selezionato';
    if(key==='stato')return propertyStateLabel(raw);
    if(key==='prezzo_min'||key==='prezzo_max')return formatCurrency(Number(raw));
    if(key==='ribassato')return raw==='yes'?'Con ribassi':'Senza ribassi osservati';
    if(key==='atti')return ({specific:'Documenti della singola unità',building:'Documenti edificio',building_recent:'Edificio: ultimi 90 giorni',street_recent:'Via: ultimi 90 giorni',documents:'Documenti pubblici',recent:'Atti recenti',signals:'Segnali territoriali'} as Record<string,string>)[raw]??'Contesto selezionato';
    return key==='fonte'?humanize(raw):raw;
  };
  return <div className="space-y-5">
    <PageHeader eyebrow="Intelligence" title="Intelligence immobiliare" description="Immobili, trasformazioni e prove del territorio."/>
    <IntelligenceNavigation view={view}/>
    <div className="lr-view-intro"><div><h2>{INTELLIGENCE_VIEW_COPY[view].title}</h2><p>{INTELLIGENCE_VIEW_COPY[view].description}</p></div></div>
    <form method="get" className="lr-filter-toolbar space-y-3">
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
      {filterKeys.some(k=>value(k))?<div className="lr-active-filters" aria-label="Filtri attivi"><span className="lr-record-meta">Filtri attivi</span>{filterKeys.filter(k=>value(k)).map(key=>{const q=new URLSearchParams({vista:view});for(const other of filterKeys)if(other!==key&&value(other))q.set(other,value(other));const labels:Record<string,string>={q:'Ricerca',agenzia:'Agenzia',localita:'Località',zona:'Zona',stato:'Stato',giorni:'Giorni',punteggio:'Punteggio',ribasso:'Ribasso',tipo:'Tipo',prezzo_min:'Prezzo da',prezzo_max:'Prezzo fino a',mq_min:'m² da',mq_max:'m² fino a',ribassato:'Ribassi',fonte:'Fonte',atti:'Contesto',esito:'Esito'};const shown=filterDisplay(key);return <Link key={key} href={`?${q}`} aria-label={`Rimuovi filtro ${labels[key]??key}`}><span>{labels[key]??key}: {shown}</span><span aria-hidden="true">?</span></Link>})}<Link href={`?vista=${view}`}>Azzera tutto</Link></div>:null}
    </form>
    <div className="lr-results-heading"><span>{result ? `${result.rows.length} immobili in questa pagina${result.hasNext?' · altri risultati nelle pagine successive':''}` : 'Lettura del registro'}</span><span>{view==='opportunita'?'Ordine: indice di rilevanza decrescente':'Ordine: ultima presenza rilevata'}</span></div>
    {!result?<EmptyState title="Archivio temporaneamente non disponibile" description="Impossibile leggere i dati aggiornati. Riprova tra poco; nessuna informazione è stata rimossa."/>:!result.rows.length?<EmptyState title="Nessun immobile con questi filtri" description="Amplia la ricerca o torna all’archivio completo." action={<Link href="/intelligence" className={buttonClass("secondary")}>Tutti gli immobili</Link>}/>:<IntelligenceRegister rows={result.rows} view={view} now={now} photos={photos}/>}
    <nav aria-label="Pagine dell’archivio" className="flex items-center justify-between gap-3">{page>1?<Link className={buttonClass("secondary")} href={pageUrl(page-1)}>Precedenti</Link>:<span/>}<Meta>Pagina {page}</Meta>{result?.hasNext?<Link className={buttonClass("secondary")} href={pageUrl(page+1)}>Successivi</Link>:<span/>}</nav>
    {metrics.length?<details className="border-t border-[var(--lr-line-quiet)] pt-3"><summary className="cursor-pointer py-2 font-medium">Agenzie · portafoglio osservato</summary><Meta>Campione monitorato, non statistiche definitive sul mercato.</Meta><div className="divide-y divide-[var(--lr-line-quiet)]">{metrics.map(a=><div key={a.agency_id} className="grid gap-1 py-3 sm:grid-cols-2"><strong>{a.name}</strong><p>{a.active_listings} attivi · {a.sold_observed} segnali vendita · {a.median_known_age==null?"età non ricostruita":`${formatNumber(a.median_known_age)} gg, età mediana`} · {a.unknown_exit_count} uscite senza esito</p></div>)}</div></details>:null}
  </div>;
}
