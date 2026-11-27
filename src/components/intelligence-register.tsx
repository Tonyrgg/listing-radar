import { RegisterLayout } from "./register-layout";
import { nextPropertyCheck } from "@/lib/property-lifecycle/read-models/next-check";
import { displayPropertyAddress } from "@/lib/property-lifecycle/read-models/display-address";
import {MarketContactSheet, type MarketContactFacts} from "./market-contact-sheet";
import {RecordTools,TabNotice} from "./workspace-updates";
import {getSourceLabel} from "@/lib/labels";
import Link from "next/link";
import {agencyDateSource} from '@/lib/property-lifecycle/read-models/agency-tenure';
import { ChevronRight, TrendingDown, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { PropertyThumbnail } from "@/components/property-thumbnail";
import { privateGalleryImages } from "@/lib/property-lifecycle/read-models/private-images";
import {intelligenceSort,type IntelligenceSort} from "@/lib/property-lifecycle/read-models/intelligence-sorting";
import { Chip, type Tone } from "@/components/ui/primitives";
import { formatCurrency, formatDate, formatNumber } from "@/lib/formatting";
import { EXIT_LABELS, marketAgeLabel, type IntelligenceRow, type IntelligenceView } from "@/lib/property-lifecycle/read-models/intelligence";
import { opportunityReasonLabel, propertyStateLabel, humanize, locationPrecisionLabel } from "@/lib/property-lifecycle/read-models/presentation";

export const INTELLIGENCE_VIEW_COPY = {
 preferiti:{title:"Preferiti",description:"Gli immobili che hai salvato, con gli stessi dati aggiornati dell’archivio."},
 privati:{title:"Radar privati",description:"Annunci da privati e venditori da verificare, con fonti e ultima lettura."},
 mercato:{title:"Mercato",description:"Immobili osservati a Bitonto, Palombaio e Mariotto."},
 opportunita:{title:"Opportunità",description:"Segnali ordinati per rilevanza. Le motivazioni restano da verificare."},
 usciti:{title:"Usciti e venduti",description:"Assenze, ritiri e cambi di agenzia. Un annuncio assente non dimostra una vendita."},
 venduti:{title:"Segnali di vendita",description:"Vendite confermate e probabili, mantenute distinte."},
 notizie:{title:"Notizie",description:"Trasformazioni immobiliari sostenute da documenti pubblici."},
};
export function IntelligenceNavigation({view,workArea}:{view:string;workArea?:string}) {
 const items=[["mercato","Mercato"],["opportunita","Opportunità"],["privati","Radar privati"],["notizie","Notizie"],["usciti","Usciti e venduti"],["preferiti","Preferiti"]];
 return <nav aria-label="Viste Intelligence" className="lr-tabs">{items.map(([key,label])=><Link key={key} href={"?"+new URLSearchParams({vista:key,...(workArea&&key!=="notizie"?{zona_lavoro:workArea}:{})})} aria-current={(view===key||(view==="venduti"&&key==="usciti"))?"page":undefined}>{label} <TabNotice tab={key}/></Link>)}</nav>;
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
function marketContactFacts(row: IntelligenceRow): MarketContactFacts {
 const text = (value: unknown) => typeof value === "string" ? value.trim() || null : null;
 const floor = row.attributes?.floor;
 const coordinates = typeof row.latitude === "number" && Math.abs(row.latitude) <= 90 &&
  typeof row.longitude === "number" && Math.abs(row.longitude) <= 180 ? `${row.latitude}, ${row.longitude}` : null;
 const street = [text(row.street_name), text(row.street_number)].filter(Boolean).join(" ");
 const position = [...new Set([street, row.zone_name, row.locality].filter(Boolean))].join(", ") || null;
 return {
  owner: text(row.attributes?.ownerName),
  civic: text(row.street_number), position, coordinates,
  precision: row.location_precision ? locationPrecisionLabel(row.location_precision) : coordinates ? "Precisione del punto da verificare" : null,
  floor: typeof floor === "number" && Number.isFinite(floor) ? String(floor) : text(floor),
  rooms: typeof row.rooms === "number" && Number.isFinite(row.rooms) ? formatNumber(row.rooms) : null,
 };
}
export function IntelligenceRegister({rows,view,now,photos={},query={}}:{rows:IntelligenceRow[];view:IntelligenceView;now:number;photos?:Record<string,string>;query?:Record<string,string>}){
 const signals=view==="opportunita",showAgencyTenure=view!=="privati",sort=intelligenceSort(query.ordine,query.direzione,view);
 const backQuery=new URLSearchParams({...query,vista:view});
 const detailUrl=(id:string)=>"/casa/"+id+"?"+new URLSearchParams({origine:view,ritorno:"/intelligence?"+backQuery});
 const heading=(key:IntelligenceSort,label:string,numeric=false)=>{
  const active=sort.key===key;
  const q=new URLSearchParams({...query,vista:view,ordine:key,direzione:active&&sort.ascending?"desc":"asc"});q.delete("pagina");
  return <th scope="col" data-extra={["metro","ribassi","zona","indice","giorni"].includes(key) || undefined} className={numeric?"lr-numeric":undefined} aria-sort={active?(sort.ascending?"ascending":"descending"):"none"}><Link href={"?"+q} title={"Ordina per "+label}><span>{label}</span>{active?(sort.ascending?<ArrowUp size={12}/>:<ArrowDown size={12}/>):<ChevronsUpDown size={12}/>}</Link></th>;
 };
 return <RegisterLayout initialDetail={["metro","ribassi","zona","indice","giorni"].includes(query.ordine??"")}><div className="lr-radar-register" role="region" aria-label="Registro immobili" tabIndex={0}>
  <table className="lr-radar-table">
   <caption className="sr-only">{INTELLIGENCE_VIEW_COPY[view].title}. Il prezzo è quello richiesto, non il prezzo di vendita. L’indice ordina gli indizi, non misura la probabilità di vendita.</caption>
   <thead><tr>{signals?heading("indice","Indice",true):null}{heading("immobile","Immobile")}<th scope="col">Prossimo controllo</th>{heading("zona","Zona")}{heading("prezzo","Prezzo richiesto",true)}{heading("metro","€/m²",true)}{heading("giorni","Sul mercato",true)}{showAgencyTenure?heading("giorni_agenzia","Giorni con agenzia",true):null}{heading("ribassi","Ribassi",true)}{heading("fonte","Fonte")}{heading("stato","Stato")}<th scope="col">Nominativo e immobile</th><th scope="col"><span className="sr-only">Apri</span></th></tr></thead>
   <tbody>{rows.map(row=>{
    const address=displayPropertyAddress(row.address,row.street_name,row.street_number);
    const age=marketAgeLabel(row.first_seen_at,row.earliest_market_evidence_at,row.sold_at??row.sold_observed_at??now);
    const end=row.sold_at??row.sold_observed_at;
    const start=row.earliest_market_evidence_at&&Date.parse(row.earliest_market_evidence_at)<Date.parse(row.first_seen_at)?row.earliest_market_evidence_at:row.first_seen_at;
    const dayCount=Math.floor(((end?Date.parse(end):now)-Date.parse(start))/86400000);
    const days=Number.isFinite(dayCount)&&dayCount>=0?dayCount:null;
    const publicDays=row.private_source?(row.public_market_date?Math.max(0,Math.floor((now-Date.parse(row.public_market_date))/86400000)):null):days;
    const observedDays=Math.max(0,Math.floor((now-Date.parse(row.first_seen_at))/86400000));
    const unitPrice=row.surface_sqm&&row.latest_asking_price!=null?Math.round(row.latest_asking_price/row.surface_sqm):null;
    const check=nextPropertyCheck({classification:row.exit_classification,saleStatus:row.sale_status,priceConflict:row.source_price_conflict,precision:row.location_precision,civic:row.street_number,hasAgency:Boolean(row.agency_id),agencyStart:row.agency_started_at,privateSellerUnknown:Boolean(row.private_source && !row.agency_id && row.private_seller_type!=="private")});
    return <tr key={row.property_id}>
     {signals?<td data-extra className="lr-table-score"><span className="lr-score-box" data-level={row.opportunity_score!=null&&row.opportunity_score>=60?"high":"normal"} title={"Indice di priorità, non probabilità di vendita"+(row.identifiability_bonus?` · +${row.identifiability_bonus} per informazioni utili a individuare l’immobile`:"")}>{row.opportunity_score==null?"—":formatNumber(Math.round(row.opportunity_score))}</span></td>:null}
     <td className="lr-table-identity"><div className="lr-table-property"><Link href={detailUrl(row.property_id)} aria-label={"Apri "+address}><PropertyThumbnail src={photos[row.property_id]} fallbackSrc={privateGalleryImages([row.private_image_url])[0]} address={address} preview/></Link><div><Link href={detailUrl(row.property_id)} className="lr-table-address" title={address}>{address}</Link><p className="lr-table-secondary" title={signals?(row.reasons??[]).map(opportunityReasonLabel).join(" · "):characteristics(row)}>{signals?(row.reasons??[]).map(opportunityReasonLabel).join(" · ")||"Indizi da verificare":characteristics(row)}</p></div></div></td>
     <td className="lr-check-cell"><Link href={detailUrl(row.property_id)+"#prossimo-controllo"}>{check.label} <ChevronRight size={13} aria-hidden="true"/></Link><small>{row.location_precision?locationPrecisionLabel(row.location_precision):"Posizione da verificare"}</small></td>
     <td data-extra className="lr-table-zone">{row.zone_name||row.locality||"Da verificare"}</td>
     <td data-label="Prezzo richiesto" className="lr-numeric lr-table-price"><strong>{formatCurrency(row.latest_asking_price)}</strong>{row.source_price_conflict?<p className="lr-table-warning">Fonti discordanti</p>:row.reduction_percent!=null&&row.reduction_percent>0?<p className="lr-table-reduction"><TrendingDown size={12} aria-hidden="true"/> −{formatNumber(row.reduction_percent)}%</p>:null}</td>
     <td data-extra className="lr-numeric">{unitPrice==null?"—":formatNumber(unitPrice)}</td>
     <td data-extra className="lr-numeric" title={(row.public_date_unavailable?"Dettaglio date non disponibile. ":"")+age}><span>{publicDays==null?"—":(row.private_source?"≥ ":"")+formatNumber(publicDays)}</span><p className="lr-table-secondary">Seguito da {formatNumber(observedDays)} g</p><span className="sr-only"> · {age}</span></td>
     {showAgencyTenure?<td data-label="Con agenzia" className="lr-numeric" title={row.agency_id?agencyDateSource(row.agency_started_at?row.agency_start_source:null)+(row.agency_started_at?' · '+formatDate(row.agency_started_at):''):undefined}><span>{row.days_with_agency==null?'—':`${row.agency_start_exact?'':'≥ '}${formatNumber(row.days_with_agency)}`}</span>{row.agency_id?<p className="lr-table-secondary">{row.agency_started_at?(row.agency_start_exact?"Ingresso confermato":"Presenza documentata"):"Data non ricostruita"}</p>:null}</td>:null}
     <td data-extra className="lr-numeric">{formatNumber(row.drop_count??0)}</td>
     <td data-label="Fonte" className="lr-table-source"><span title={row.agency_name}>{row.private_source&&row.agency_id==null?getSourceLabel(row.private_source):row.agency_name||"Da verificare"}</span><p className="lr-table-secondary" title="Ultima presenza rilevata">{row.private_seller_type&&row.agency_id==null?(row.private_seller_type==="private"?"Privato · ":"Da verificare · "):""}{formatDate(row.last_seen_at)}</p></td>
     <td data-label="Stato" className="lr-table-state"><Chip tone={statusTone(row)} dot>{EXIT_LABELS[row.exit_classification]??propertyStateLabel(row.property_state)}</Chip></td>
     <td><MarketContactSheet label={address} facts={marketContactFacts(row)}/></td>
     <td><RecordTools id={row.property_id} tab={view==="venduti"?"usciti":view==="preferiti"?"mercato":view}/><Link href={detailUrl(row.property_id)} className="lr-table-open" aria-label={"Apri dossier: "+address}><ChevronRight size={16} aria-hidden="true"/></Link></td>
    </tr>;
   })}</tbody>
  </table>
 </div></RegisterLayout>;
}
