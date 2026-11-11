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
import { intelligenceSort } from "@/lib/property-lifecycle/read-models/intelligence-sorting";
import { RadarFilterPanel } from "@/components/radar-filter-panel";
import {readPropertyThumbnails} from '@/lib/lifecycle-photos';

export const metadata:Metadata={title:"Intelligence"};
const filterKeys=["q","esito","agenzia","localita","zona","stato","giorni","punteggio","ribasso","tipo","prezzo_min","prezzo_max","mq_min","mq_max","ribassato","fonte","atti","civico","via","coordinate","precisione"];
const precisionOptions={EXACT_ADDRESS:"Indirizzo esatto",EXACT_COORDINATES:"Coordinate esatte",STREET_ONLY:"Solo via",APPROXIMATE_AREA:"Zona approssimativa",UNKNOWN:"Posizione da verificare"};
const sourceOptions=["admaiora","futura","garofalo","iconacasa","momento","puntocasa","studisanti","studiocasa","vistocasa","REMAX","WIKICASA","IMMOBILIARE","CASA","IDEALISTA"];
export default async function IntelligencePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  await connection();
  const params=await searchParams;
  const value=(key:string)=>typeof params[key]==="string"?params[key] as string:"";
  if(value('vista')==='notizie')return <div className="lr-radar-desk lr-news-desk"><PageHeader title="Situazioni dal territorio" description="Fatti, luoghi e documenti da verificare."/><IntelligenceNavigation view="notizie"/><PropertyNews params={params} now={await readNow()}/></div>;
  const requested=value("vista"),view:IntelligenceView=INTELLIGENCE_VIEWS.includes(requested as IntelligenceView)?requested as IntelligenceView:"mercato";
  const page=Math.max(1,Math.min(10000,Math.floor(Number(value("pagina"))||1)));
  const numeric=(key:string)=>value(key)===""?undefined:Number(value(key));
  const now=await readNow(),db=getSupabaseServiceClient();
  const sort=intelligenceSort(value("ordine"),value("direzione"),view);
  const [result,agencies,metrics]=await Promise.all([
    readIntelligence(db,{view,page,sort:sort.key,direction:sort.ascending?"asc":"desc",query:value("q"),classification:value("esito"),agency:value("agenzia"),locality:value("localita"),zone:value("zona"),state:value("stato"),minimumAge:numeric("giorni"),minimumScore:view==="opportunita"?numeric("punteggio"):undefined,minimumReduction:numeric("ribasso"),propertyType:value("tipo"),minimumPrice:numeric("prezzo_min"),maximumPrice:numeric("prezzo_max"),minimumSqm:numeric("mq_min"),maximumSqm:numeric("mq_max"),reduced:value("ribassato"),source:value("fonte"),publicRecords:value("atti"),civic:value("civico"),street:value("via"),coordinates:value("coordinate"),locationPrecision:value("precisione")}).catch(()=>null),
    db.from("agencies").select("id,name").order("name"),
    view==="mercato"?readAgencyMarketIntelligence(db).catch(()=>[]):Promise.resolve([]),
  ]);
  const pageUrl=(next:number)=>{const q=new URLSearchParams({vista:view,pagina:String(next),ordine:sort.key,direzione:sort.ascending?"asc":"desc"});for(const key of filterKeys)if(value(key))q.set(key,value(key));return `?${q}`;};
  const photos=result?await readPropertyThumbnails(result.rows.map(r=>r.property_id)).catch(()=>({})):{};
  const field=(name:string,label:string,type="text",placeholder?:string)=><label key={name} className="flex min-w-0 flex-col gap-1"><span className="text-[length:var(--lr-text-meta)] font-medium">{label}</span><input className={controlClass()} name={name} defaultValue={value(name)} type={type} min={type==="number"?0:undefined} placeholder={placeholder}/></label>;
  const select=(name:string,label:string,options:Record<string,string>)=><label key={name} className="flex min-w-0 flex-col gap-1"><span className="text-[length:var(--lr-text-meta)] font-medium">{label}</span><select className={controlClass()} name={name} defaultValue={value(name)}><option value="">Tutti</option>{Object.entries(options).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>;
  const filterDisplay=(key:string)=>{
    const raw=value(key);
    if(key==='agenzia')return (agencies.data??[]).find(a=>a.id===raw)?.name??'Agenzia selezionata';
    if(key==='esito')return EXIT_LABELS[raw]??'Esito selezionato';
    if(key==='civico')return raw==='yes'?'Presente':'Assente';
    if(key==='via')return raw==='yes'?'Conosciuta':'Non conosciuta';
    if(key==='coordinate')return raw==='yes'?'Disponibili':'Non disponibili';
    if(key==='precisione')return precisionOptions[raw as keyof typeof precisionOptions]??raw;
    if(key==='stato')return propertyStateLabel(raw);
    if(key==='prezzo_min'||key==='prezzo_max')return formatCurrency(Number(raw));
    if(key==='ribassato')return raw==='yes'?'Con ribassi':'Senza ribassi osservati';
    if(key==='atti')return ({specific:'Documenti della singola unità',building:'Documenti edificio',building_recent:'Edificio: ultimi 90 giorni',street_recent:'Via: ultimi 90 giorni',documents:'Documenti pubblici',recent:'Atti recenti',signals:'Segnali territoriali'} as Record<string,string>)[raw]??'Contesto selezionato';
    return key==='fonte'?humanize(raw):raw;
  };

  const resetUrl="?"+new URLSearchParams({vista:view,ordine:sort.key,direzione:sort.ascending?"asc":"desc"});
  const activeKeys=filterKeys.filter(k=>value(k));
  const filterLabels:Record<string,string>={q:"Ricerca",agenzia:"Agenzia",localita:"Località",zona:"Zona",stato:"Stato",giorni:"Giorni minimi",punteggio:"Indice minimo",ribasso:"Ribasso minimo",tipo:"Tipo",prezzo_min:"Prezzo da",prezzo_max:"Prezzo fino a",mq_min:"m² da",mq_max:"m² fino a",ribassato:"Ribassi",fonte:"Fonte",atti:"Documenti",esito:"Esito",civico:"Civico",via:"Via",coordinate:"Coordinate",precisione:"Precisione posizione"};
  const withoutFilter=(removed:string)=>{const q=new URLSearchParams({vista:view,ordine:sort.key,direzione:sort.ascending?"asc":"desc"});for(const key of filterKeys)if(key!==removed&&value(key))q.set(key,value(key));return "?"+q;};

  return <div className="lr-radar-desk">
    <PageHeader title={INTELLIGENCE_VIEW_COPY[view].title} description={INTELLIGENCE_VIEW_COPY[view].description}/>
    <IntelligenceNavigation view={view}/>
    <RadarFilterPanel count={activeKeys.length} filters={<form method="get" className="lr-radar-filter-form">
            <input type="hidden" name="vista" value={view}/><input type="hidden" name="ordine" value={sort.key}/><input type="hidden" name="direzione" value={sort.ascending?"asc":"desc"}/>
            <div className="lr-filter-submit"><button className={buttonClass("primary")}>Applica filtri</button><Link href={resetUrl} className={buttonClass("quiet")}>Azzera</Link></div>
            <fieldset><legend>Cerca un immobile</legend>{field("q","Indirizzo o civico","search","Via, civico…")}{select("agenzia","Agenzia",Object.fromEntries((agencies.data??[]).map(a=>[a.id,a.name])))}</fieldset>
            <fieldset><legend>Territorio</legend>{select("localita","Località",{Bitonto:"Bitonto",Palombaio:"Palombaio",Mariotto:"Mariotto"})}{field("zona","Zona")}</fieldset>
            <fieldset><legend>Informazioni geografiche</legend>
              {select("civico","Numero civico",{yes:"Presente",no:"Assente"})}
              {select("via","Via",{yes:"Conosciuta",no:"Non conosciuta"})}
              {select("coordinate","Coordinate sulla mappa",{yes:"Disponibili",no:"Non disponibili"})}
              {select("precisione","Precisione della posizione",precisionOptions)}
              <Meta>Le coordinate disponibili possono essere approssimative. Usa la precisione per distinguere i punti esatti.</Meta>
            </fieldset>
            <fieldset><legend>Prezzo richiesto</legend><div className="lr-filter-pair">{field("prezzo_min","Da €","number")}{field("prezzo_max","A €","number")}</div>{select("ribassato","Ribassi",{yes:"Con ribassi",no:"Senza ribassi osservati"})}</fieldset>
            <fieldset><legend>Caratteristiche</legend>{field("tipo","Tipologia","text","Appartamento, villa…")}<div className="lr-filter-pair">{field("mq_min","Da m²","number")}{field("mq_max","A m²","number")}</div></fieldset>
            <fieldset><legend>Presenza e segnali</legend>{field("giorni","Giorni minimi osservati","number")}{view==="opportunita"?field("punteggio","Indice minimo","number"):null}{field("ribasso","Riduzione minima %","number")}</fieldset>
            <details className="lr-extra-filters"><summary>Stato, fonti e documenti</summary><div>
              {select("stato","Stato",{ACTIVE:"Attivo",EXIT_PENDING:"Presenza da verificare",CLOSED_SOLD:"Segnale di vendita",OFF_MARKET_NO_SALE_EVIDENCE:"Uscita senza prova di vendita",CLOSED_SWITCHED:"Cambio agenzia",CLOSED_WITHDRAWN:"Ritirato",CLOSED_TO_PRIVATE:"Passato a privato"})}
              {select("fonte","Fonte",Object.fromEntries(sourceOptions.map(s=>[s,s==="REMAX"?"RE/MAX":s==="IMMOBILIARE"?"Immobiliare.it":humanize(s)])))}
              {view==="venduti"||view==="usciti"?select("esito","Esito",EXIT_LABELS):null}
              {select("atti","Documenti collegati",{specific:"Specifici dell’unità",building:"Dell’edificio",building_recent:"Edificio: ultimi 90 giorni",street_recent:"Via: ultimi 90 giorni",documents:"Documenti pubblici",recent:"Atti recenti",signals:"Segnali territoriali"})}
            </div></details>
          </form>}>
        <div className="lr-radar-results-bar"><span>{result?result.rows.length+" immobili in questa pagina":"Lettura in corso"}{result?.hasNext?" · continua nella pagina successiva":""}</span><span>{sort.label+" · "+(sort.ascending?"crescente":"decrescente")}</span></div>
        {activeKeys.length?<div className="lr-active-filters"><span className="sr-only">Filtri attivi</span>{activeKeys.map(key=><Link key={key} className="lr-applied-filter" href={withoutFilter(key)} aria-label={"Rimuovi filtro "+(filterLabels[key]??key)}>{filterLabels[key]??key}: {filterDisplay(key)} <span aria-hidden="true">×</span></Link>)}<Link href={resetUrl}>Azzera tutto</Link></div>:null}
        {!result?<EmptyState title="Archivio temporaneamente non disponibile" description="Impossibile leggere i dati aggiornati. Riprova tra poco; nessuna informazione è stata rimossa."/>:!result.rows.length?<EmptyState title="Nessun immobile con questi filtri" description="Amplia la ricerca o torna all’archivio completo." action={<Link href="/intelligence" className={buttonClass("secondary")}>Tutti gli immobili</Link>}/>:<IntelligenceRegister rows={result.rows} view={view} now={now} photos={photos} query={Object.fromEntries(Object.entries(params).filter((entry):entry is [string,string]=>typeof entry[1]==="string"))}/>}
        <nav aria-label="Pagine dell’archivio" className="lr-radar-pagination">{page>1?<Link className={buttonClass("secondary",{compact:true})} href={pageUrl(page-1)}>Precedenti</Link>:<span/>}<Meta>Pagina {page}</Meta>{result?.hasNext?<Link className={buttonClass("secondary",{compact:true})} href={pageUrl(page+1)}>Successivi</Link>:<span/>}</nav>
        {metrics.length?<details className="lr-market-agencies"><summary>Agenzie · portafoglio osservato</summary><Meta>Campione monitorato, non statistiche definitive sul mercato.</Meta><div className="divide-y divide-[var(--lr-line-quiet)]">{metrics.map(a=><div key={a.agency_id} className="grid gap-1 py-3 sm:grid-cols-2"><strong>{a.name}</strong><p>{a.active_listings} attivi · {a.sold_observed} segnali vendita · {a.median_known_age==null?"età non ricostruita":formatNumber(a.median_known_age)+" gg, età mediana"} · {a.unknown_exit_count} uscite senza esito</p></div>)}</div></details>:null}
    </RadarFilterPanel>
  </div>;
}
