import { Meta } from "@/components/ui/primitives";
import { formatCurrency,formatDate,formatNumber } from "@/lib/formatting";
import { EXIT_LABELS,marketAgeLabel,type IntelligenceRow } from "@/lib/property-lifecycle/read-models/intelligence";
import { humanize,locationPrecisionLabel,propertyStateLabel } from "@/lib/property-lifecycle/read-models/presentation";
export function PropertyHover({row,now}:{row:IntelligenceRow;now:number}) {
  const attrs=row.attributes??{},features=attrs.features&&typeof attrs.features==="object"?attrs.features as Record<string,unknown>:{};
  const extras=Object.entries({elevator:"Ascensore",balcony:"Balcone",terrace:"Terrazzo",garden:"Giardino",parking:"Posto auto",garage:"Garage"}).filter(([key])=>features[key]===true).map(([,label])=>label);
  return <div className="w-[min(20rem,70vw)] space-y-2 text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
    <div><strong className="text-[length:var(--lr-text-record)]">{row.address}</strong><Meta>{[row.locality,row.zone_name,row.property_type?humanize(row.property_type):null].filter(Boolean).join(" · ")}</Meta></div>
    <div><p className="font-medium">{row.agency_name}</p>{row.agent_name?<Meta>Agente dichiarato: {row.agent_name}</Meta>:null}</div>
    <p className="font-[650]">{formatCurrency(row.latest_asking_price)}{row.reduction_percent!=null&&row.reduction_percent>0?` · −${formatNumber(row.reduction_percent)}%`:""}</p>
    {row.first_asking_price!=null?<Meta>Primo asking osservato {formatCurrency(row.first_asking_price)} · {row.drop_count} ribassi</Meta>:null}
    {row.earliest_known_asking!=null&&row.earliest_known_asking!==row.first_asking_price?<Meta>Asking precedente noto {formatCurrency(row.earliest_known_asking)}{row.earliest_known_asking_at?` · ${formatDate(row.earliest_known_asking_at)}`:" · data non dichiarata"}</Meta>:null}
    <p>{[row.surface_sqm!=null?`${formatNumber(row.surface_sqm)} m²`:null,row.rooms!=null?`${formatNumber(row.rooms)} locali`:null,attrs.floor?`Piano ${attrs.floor}`:null,...extras].filter(Boolean).join(" · ")}</p>
    <p>{EXIT_LABELS[row.exit_classification]??propertyStateLabel(row.property_state)}</p>
    <div><p className="font-medium">{marketAgeLabel(row.first_seen_at,row.earliest_market_evidence_at,row.sold_at??row.sold_observed_at??now)}</p><Meta>Prima osservazione {formatDate(row.first_seen_at)}</Meta><Meta>Prima evidenza {formatDate(row.earliest_market_evidence_at)} · Ultima presenza {formatDate(row.last_seen_at)}</Meta></div>
    {row.relaunch_count?<Meta>{row.relaunch_count} ripubblicazioni rilevate</Meta>:null}
    {row.sold_at?<Meta>Vendita dichiarata {formatDate(row.sold_at)}</Meta>:row.sold_observed_at?<Meta>Segnale vendita osservato {formatDate(row.sold_observed_at)}</Meta>:null}
    <Meta>{row.publication_count??0} pubblicazioni · {row.evidence_count??0} prove{row.document_count?` · ${row.document_count} pratiche edificio, unità da verificare`:""}</Meta>
    {row.publication_sources?.length?<Meta>Fonti: {row.publication_sources.join(", ")}</Meta>:null}
    <Meta>{locationPrecisionLabel(row.location_precision??"UNKNOWN")}{(row.opportunity_score??0)>0?` · Opportunità indicativa ${formatNumber(row.opportunity_score??0)}/100`:""}</Meta>
    <p className="border-t border-[var(--lr-line-quiet)] pt-2 font-medium">Clicca il punto per aprire il dossier</p>
  </div>;
}
