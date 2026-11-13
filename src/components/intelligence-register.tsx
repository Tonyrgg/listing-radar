import Link from "next/link";
import {agencyDateSource} from '@/lib/property-lifecycle/read-models/agency-tenure';
import { ChevronRight, TrendingDown, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { PropertyThumbnail } from "@/components/property-thumbnail";
import {intelligenceSort,type IntelligenceSort} from "@/lib/property-lifecycle/read-models/intelligence-sorting";
import { Chip, type Tone } from "@/components/ui/primitives";
import { formatCurrency, formatDate, formatNumber, formatShouty } from "@/lib/formatting";
import { EXIT_LABELS, marketAgeLabel, type IntelligenceRow, type IntelligenceView } from "@/lib/property-lifecycle/read-models/intelligence";
import { opportunityReasonLabel, propertyStateLabel, humanize } from "@/lib/property-lifecycle/read-models/presentation";

export const INTELLIGENCE_VIEW_COPY = {
 mercato:{title:"Mercato",description:"Immobili osservati a Bitonto, Palombaio e Mariotto."},
 opportunita:{title:"Opportunità",description:"Segnali ordinati per rilevanza. Le motivazioni restano da verificare."},
 usciti:{title:"Usciti dal mercato",description:"Assenze, ritiri e cambi di agenzia. Un annuncio assente non dimostra una vendita."},
 venduti:{title:"Segnali di vendita",description:"Vendite confermate e probabili, mantenute distinte."},
 notizie:{title:"Notizie",description:"Trasformazioni immobiliari sostenute da documenti pubblici."},
};
export function IntelligenceNavigation({view}:{view:string}) {
 const items=[["mercato","Mercato"],["opportunita","Opportunità"],["notizie","Notizie"],["usciti","Usciti"],["venduti","Venduti"]];
 return <nav aria-label="Viste Intelligence" className="lr-tabs">{items.map(([key,label])=><Link key={key} href={"?vista="+key} aria-current={view===key?"page":undefined}>{label}</Link>)}</nav>;
}
function statusTone(row:IntelligenceRow):Tone {
 if(row.exit_classification==="SOLD_CONFIRMED")return "ok";
 if(["SOLD_PROBABLE","MISSING_UNCONFIRMED","UNKNOWN_EXIT","EXPIRED_POSSIBLE"].includes(row.exit_classification))return "warn";
 if(["ACTIVE","RELISTED"].includes(row.exit_classification))return "info";
 return "neutral";
}
function characteristics(row:IntelligenceRow){
 return [row.property_type?humanize(row.property_type):null,row.surface_sqm!=null?formatNumber(row.surface_sqm)+" m²":null,row.rooms!=null?formatNumber(row.rooms)+" locali":null].filter(Boolean).join(" · ");
}
export function IntelligenceRegister({rows,view,now,photos={},query={}}:{rows:IntelligenceRow[];view:IntelligenceView;now:number;photos?:Record<string,string>;query?:Record<string,string>}){
 const signals=view==="opportunita",sort=intelligenceSort(query.ordine,query.direzione,view);
 const backQuery=new URLSearchParams({...query,vista:view});
 const detailUrl=(id:string)=>"/casa/"+id+"?"+new URLSearchParams({origine:view,ritorno:"/intelligence?"+backQuery});
 const heading=(key:IntelligenceSort,label:string,numeric=false)=>{
  const active=sort.key===key;
  const q=new URLSearchParams({...query,vista:view,ordine:key,direzione:active&&sort.ascending?"desc":"asc"});q.delete("pagina");
  return <th scope="col" className={numeric?"lr-numeric":undefined} aria-sort={active?(sort.ascending?"ascending":"descending"):"none"}><Link href={"?"+q} title={"Ordina per "+label}><span>{label}</span>{active?(sort.ascending?<ArrowUp size={12}/>:<ArrowDown size={12}/>):<ChevronsUpDown size={12}/>}</Link></th>;
 };
 return <div className="lr-radar-register" role="region" aria-label="Registro immobili" tabIndex={0}>
  <table className="lr-radar-table">
   <caption className="sr-only">{INTELLIGENCE_VIEW_COPY[view].title}. Il prezzo è quello richiesto, non il prezzo di vendita. L’indice ordina gli indizi, non misura la probabilità di vendita.</caption>
   <thead><tr>{signals?heading("indice","Indice",true):null}{heading("immobile","Immobile")}{heading("zona","Zona")}{heading("prezzo","Prezzo richiesto",true)}{heading("metro","€/m²",true)}{heading("giorni","Giorni",true)}{signals?heading("giorni_agenzia","Giorni con agenzia",true):null}{heading("ribassi","Ribassi",true)}{heading("fonte","Fonte")}{heading("stato","Stato")}<th scope="col"><span className="sr-only">Apri</span></th></tr></thead>
   <tbody>{rows.map(row=>{
    const age=marketAgeLabel(row.first_seen_at,row.earliest_market_evidence_at,row.sold_at??row.sold_observed_at??now);
    const end=row.sold_at??row.sold_observed_at;
    const start=row.earliest_market_evidence_at&&Date.parse(row.earliest_market_evidence_at)<Date.parse(row.first_seen_at)?row.earliest_market_evidence_at:row.first_seen_at;
    const dayCount=Math.floor(((end?Date.parse(end):now)-Date.parse(start))/86400000);
    const days=Number.isFinite(dayCount)&&dayCount>=0?dayCount:null;
    const unitPrice=row.surface_sqm&&row.latest_asking_price!=null?Math.round(row.latest_asking_price/row.surface_sqm):null;
    return <tr key={row.property_id}>
     {signals?<td className="lr-table-score"><span className="lr-score-box" data-level={row.opportunity_score!=null&&row.opportunity_score>=60?"high":"normal"} title={"Indice di priorità, non probabilità di vendita"+(row.identifiability_bonus?` · +${row.identifiability_bonus} per informazioni utili a individuare l’immobile`:"")}>{row.opportunity_score==null?"—":formatNumber(Math.round(row.opportunity_score))}</span></td>:null}
     <td className="lr-table-identity"><div className="lr-table-property"><Link href={detailUrl(row.property_id)} aria-label={"Apri "+formatShouty(row.address)}><PropertyThumbnail src={photos[row.property_id]} address={formatShouty(row.address)} preview/></Link><div><Link href={detailUrl(row.property_id)} className="lr-table-address" title={formatShouty(row.address)}>{formatShouty(row.address)}</Link><p className="lr-table-secondary" title={signals?(row.reasons??[]).map(opportunityReasonLabel).join(" · "):characteristics(row)}>{signals?(row.reasons??[]).map(opportunityReasonLabel).join(" · ")||"Indizi da verificare":characteristics(row)}</p></div></div></td>
     <td className="lr-table-zone">{row.zone_name||row.locality||"Da verificare"}</td>
     <td className="lr-numeric lr-table-price"><strong>{formatCurrency(row.latest_asking_price)}</strong>{row.source_price_conflict?<p className="lr-table-warning">Fonti discordanti</p>:row.reduction_percent!=null&&row.reduction_percent>0?<p className="lr-table-reduction"><TrendingDown size={12} aria-hidden="true"/> −{formatNumber(row.reduction_percent)}%</p>:null}</td>
     <td className="lr-numeric">{unitPrice==null?"—":formatNumber(unitPrice)}</td>
     <td className="lr-numeric" title={age}><span>{days==null?"—":formatNumber(days)}</span><span className="sr-only"> · {age}</span></td>
     {signals?<td className="lr-numeric" title={agencyDateSource(row.agency_started_at?row.agency_start_source:null)+(row.agency_started_at?' · '+formatDate(row.agency_started_at):'')}><span>{row.days_with_agency==null?'—':`${row.agency_start_exact?'':'≥ '}${formatNumber(row.days_with_agency)}`}</span><p className="lr-table-secondary">{row.agency_started_at?formatDate(row.agency_started_at):'Data non ricostruita'}</p></td>:null}
     <td className="lr-numeric">{formatNumber(row.drop_count??0)}</td>
     <td className="lr-table-source"><span>{row.agency_name||"Da verificare"}</span><p className="lr-table-secondary" title="Ultima presenza rilevata">{formatDate(row.last_seen_at)}</p></td>
     <td className="lr-table-state"><Chip tone={statusTone(row)} dot>{EXIT_LABELS[row.exit_classification]??propertyStateLabel(row.property_state)}</Chip></td>
     <td><Link href={detailUrl(row.property_id)} className="lr-table-open" aria-label={"Apri dossier: "+formatShouty(row.address)}><ChevronRight size={16} aria-hidden="true"/></Link></td>
    </tr>;
   })}</tbody>
  </table>
 </div>;
}
