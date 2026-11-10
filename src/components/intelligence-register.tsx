import Link from "next/link";
import { PropertyThumbnail } from "@/components/property-thumbnail";
import { ArrowUpRight, CircleCheck, CircleHelp, Clock3, TrendingDown, FileText, Lightbulb, ListFilter, Newspaper, History } from "lucide-react";
import { Chip, Meta, type Tone } from "@/components/ui/primitives";
import { formatCurrency, formatDate, formatNumber, formatShouty } from "@/lib/formatting";
import { EXIT_LABELS, marketAgeLabel, type IntelligenceRow, type IntelligenceView } from "@/lib/property-lifecycle/read-models/intelligence";
import { opportunityReasonLabel, evidenceSourceLabel, propertyStateLabel, humanize } from "@/lib/property-lifecycle/read-models/presentation";

export const INTELLIGENCE_VIEW_COPY = {
 mercato:{title:"Il mercato osservato",description:"Confronta gli immobili, i prezzi e le presenze rilevate. Una riga per immobile; pubblicazioni e prove sono nel dossier."},
 opportunita:{title:"Casi che meritano attenzione",description:"Indizi ordinati per rilevanza. Ogni caso spiega perché compare e quali verifiche restano aperte."},
 usciti:{title:"Immobili usciti dal mercato",description:"Distingui assenze, ritiri e passaggi di agenzia. L’assenza di un annuncio non dimostra una vendita."},
 venduti:{title:"Segnali di vendita",description:"Vendite confermate e probabili rimangono distinte. Il prezzo richiesto non è il prezzo di compravendita."},
 notizie:{title:"Situazioni dal territorio",description:"Leggi cosa dichiarano gli atti, dove si riferiscono e quali trasformazioni vale la pena verificare."},
};
export function IntelligenceNavigation({view}:{view:string}) {
 const items=[["mercato","Mercato",ListFilter],["opportunita","Opportunità",Lightbulb],["notizie","Notizie",Newspaper],["usciti","Usciti",History],["venduti","Venduti",CircleCheck]] as const;
 return <nav aria-label="Viste Intelligence" className="lr-tabs">{items.map(([key,label,Icon])=><Link key={key} href={`?vista=${key}`} aria-current={view===key?"page":undefined}><Icon size={16} aria-hidden="true"/>{label}</Link>)}</nav>;
}
function statusTone(row:IntelligenceRow):Tone {
 if(row.exit_classification==="SOLD_CONFIRMED")return "ok";
 if(["SOLD_PROBABLE","MISSING_UNCONFIRMED","UNKNOWN_EXIT","EXPIRED_POSSIBLE"].includes(row.exit_classification))return "warn";
 if(["ACTIVE","RELISTED"].includes(row.exit_classification))return "info";
 return "neutral";
}
function characteristics(row:IntelligenceRow){return [row.property_type?humanize(row.property_type):null,row.surface_sqm!=null?`${formatNumber(row.surface_sqm)} m²`:null,row.rooms!=null?`${formatNumber(row.rooms)} ${row.rooms===1?"locale":"locali"}`:null].filter(Boolean).join(" · ")}
function Price({row}:{row:IntelligenceRow}){return <><p className="lr-price">{formatCurrency(row.latest_asking_price)}</p>{row.reduction_percent!=null&&row.reduction_percent>0?<p className="lr-price-change"><TrendingDown size={14} className="inline" aria-hidden="true"/> −{formatNumber(row.reduction_percent)}% osservato</p>:null}{row.source_price_conflict&&<p className="lr-record-meta">Prezzi discordanti tra fonti</p>}</>}
function Provenance({row}:{row:IntelligenceRow}){
 const prov=row.market_evidence_provenance;
 return <details className="lr-record-provenance"><summary>Fonti e date · {row.publication_count??0} pubblicazioni · {row.evidence_count??0} prove</summary><div className="space-y-1">
 <Meta>Prima osservazione {formatDate(row.first_seen_at)} · Prima evidenza pubblica {formatDate(row.earliest_market_evidence_at)}</Meta>
 <Meta>{prov?.url?`Provenienza: ${evidenceSourceLabel(prov.url)}, ${formatDate(prov.claimedAt??row.earliest_market_evidence_at)}`:"Provenienza: nostra osservazione"}</Meta>
 {row.first_asking_price!=null&&<Meta>Primo prezzo osservato {formatCurrency(row.first_asking_price)} ? {row.drop_count} ribassi confermati</Meta>}
 <Meta>Versione indice: {String(row.evidence_summary?.scoreVersion??"non dichiarata")}</Meta>
 <Meta>Ultima presenza {formatDate(row.last_seen_at)} · Ultima revisione {formatDate(row.updated_at??row.last_seen_at)}</Meta>
 <Meta>Fonti: {(row.publication_sources??[]).join(", ")||"da verificare"}{row.agent_name?` · Agente: ${row.agent_name}`:""}</Meta>
 {row.publication_date_disagreement&&<p>Date dichiarate discordanti: consulta le prove nel dossier.</p>}
 {row.price_source_url&&<a href={row.price_source_url} target="_blank" rel="noreferrer" className="underline">Provenienza del prezzo richiesto</a>}
 </div></details>;
}
export function IntelligenceRegister({rows,view,now,photos={}}:{rows:IntelligenceRow[];view:IntelligenceView;now:number;photos?:Record<string,string>}){
 if(view==="opportunita")return <div className="lr-opportunity-list">{rows.map(row=><article key={row.property_id} className="lr-opportunity">
 <div className="lr-opportunity-main"><div className="flex flex-wrap gap-2"><Chip tone={statusTone(row)} dot>{EXIT_LABELS[row.exit_classification]??propertyStateLabel(row.property_state)}</Chip>{row.document_count? <Chip tone="info"><FileText size={12} aria-hidden="true"/>{row.document_count} {row.document_count===1?"pratica":"pratiche"} edificio</Chip>:null}</div>
 <Link href={`/casa/${row.property_id}`} className="lr-record-title">{formatShouty(row.address)}</Link><p className="lr-record-meta">{row.agency_name} · {[row.locality,row.zone_name,characteristics(row)].filter(Boolean).join(" · ")}</p>
 <ul className="lr-opportunity-reasons">{(row.reasons??[]).length?(row.reasons??[]).map(reason=><li key={reason}><Lightbulb size={15} aria-hidden="true"/><span>{opportunityReasonLabel(reason)}</span></li>):<li><CircleHelp size={15} aria-hidden="true"/><span>La motivazione dettagliata è da verificare nel dossier.</span></li>}</ul>
 <p className="lr-opportunity-caution">Indizi da verificare. L’anzianità osservata non dimostra scadenza dell’incarico o disponibilità a vendere.</p><Provenance row={row}/></div>
 <aside className="lr-opportunity-aside"><div><p className="lr-field-label">Ultimo prezzo richiesto</p><Price row={row}/></div><div><p className="lr-field-label">Osservazione</p><p className="text-sm">{marketAgeLabel(row.first_seen_at,row.earliest_market_evidence_at,now)}</p></div><div><p className="lr-field-label">Indice di ordinamento</p><p className="font-semibold">{formatNumber(row.opportunity_score??0)}/100</p><p className="lr-record-meta">Ordina gli indizi disponibili. Non è una probabilità di vendita.</p></div><Link href={`/casa/${row.property_id}`} className="lr-open-dossier">Esamina il caso <ArrowUpRight size={16} aria-hidden="true"/></Link></aside>
 </article>)}</div>;
 return <div className="lr-register"><div className="lr-register-head" aria-hidden="true"><span>IMMOBILE / FONTE</span><span>PREZZO RICHIESTO</span><span>STATO OSSERVATO</span><span>ULTIMO RISCONTRO</span><span/></div>{rows.map(row=><article key={row.property_id} className="lr-register-item" aria-label={formatShouty(row.address)}>
 <div className="lr-market-row"><div className="lr-market-with-photo"><Link href={`/casa/${row.property_id}`} aria-label={`Apri ${formatShouty(row.address)}`}><PropertyThumbnail src={photos[row.property_id]} address={formatShouty(row.address)}/></Link><div className="lr-market-identity"><Link href={`/casa/${row.property_id}`} className="lr-record-title">{formatShouty(row.address)}</Link><p className="lr-record-meta">{[row.locality,row.zone_name,characteristics(row)].filter(Boolean).join(" · ")}</p><p className="lr-record-meta">{row.agency_name}{row.agency_role==="OUR_AGENCY"?" · Nostra filiale":""}</p></div></div>
 <div className="lr-market-price"><span className="lr-cell-label">{view==="venduti"?"Ultimo prezzo richiesto":"Prezzo richiesto"}</span><Price row={row}/></div>
 <div className="lr-market-state"><span className="lr-cell-label">Stato osservato</span><Chip tone={statusTone(row)} dot>{EXIT_LABELS[row.exit_classification]??propertyStateLabel(row.property_state)}</Chip>{row.sold_at?<p className="lr-record-meta">Dichiarata il {formatDate(row.sold_at)}</p>:row.sold_observed_at?<p className="lr-record-meta">Segnale del {formatDate(row.sold_observed_at)}</p>:null}{row.exit_confidence!=null&&view!=="mercato"&&<p className="lr-record-meta">Certezza classificazione {Math.round(row.exit_confidence*100)}%</p>}</div>
 <div className="lr-market-observation"><span className="lr-cell-label">Ultimo riscontro</span><p className="text-sm">{formatDate(row.last_seen_at)}</p><p className="lr-record-meta"><Clock3 size={12} className="inline" aria-hidden="true"/> {marketAgeLabel(row.first_seen_at,row.earliest_market_evidence_at,row.sold_at??row.sold_observed_at??now)}</p>{row.document_count?<p className="lr-record-meta">{row.document_count} {row.document_count===1?"pratica":"pratiche"} edificio</p>:null}</div>
 <Link href={`/casa/${row.property_id}`} className="lr-row-open" aria-label={`Apri dossier: ${formatShouty(row.address)}`}><ArrowUpRight size={18} aria-hidden="true"/></Link></div><Provenance row={row}/></article>)}</div>;
}

