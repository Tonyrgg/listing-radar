import {Meta} from "@/components/ui/primitives";
import {formatCurrency,formatDate,formatNumber} from "@/lib/formatting";
import {EXIT_LABELS,type IntelligenceRow} from "@/lib/property-lifecycle/read-models/intelligence";
import {humanize,locationPrecisionLabel,propertyStateLabel} from "@/lib/property-lifecycle/read-models/presentation";
export function PropertyHover({row}:{row:IntelligenceRow;now:number}){
 return <div className="w-[min(20rem,70vw)] space-y-2 text-sm text-[var(--lr-ink)]">
  <div><strong className="text-base">{row.address}</strong><Meta>{[row.locality,row.zone_name,row.property_type?humanize(row.property_type):null].filter(Boolean).join(" · ")}</Meta></div>
  <p className="lr-price">{formatCurrency(row.latest_asking_price)}</p>
  <p>{[row.surface_sqm!=null?`${formatNumber(row.surface_sqm)} m²`:null,row.rooms!=null?`${formatNumber(row.rooms)} ${row.rooms===1?"locale":"locali"}`:null].filter(Boolean).join(" · ")||"Misure non dichiarate"}</p>
  <p>{EXIT_LABELS[row.exit_classification]??propertyStateLabel(row.property_state)}</p>
  <p>{row.agency_name}</p>
  <Meta>Ultima presenza: {formatDate(row.last_seen_at)}</Meta>
  <Meta>Posizione: {locationPrecisionLabel(row.location_precision??"UNKNOWN")}</Meta>
  {row.source_price_conflict?<Meta>Prezzi discordanti: confronta le fonti nel dossier.</Meta>:null}
  {(row.specific_record_count||row.building_record_count||row.recent_street_count)?<div><Meta>Documenti specifici: {row.specific_record_count??0} · documenti edificio: {row.building_record_count??0}</Meta><Meta>Attività via: {row.recent_street_count??0} atti recenti. Il contesto non identifica la singola unità.</Meta></div>:null}
 </div>;
}
