import type { IntelligenceRow } from "./intelligence";
export const TERRITORY_LABELS:Record<string,string>={active:"Attivo",sold:"Segnale vendita",exit:"Non più rilevato / uscita",unknown:"Stato da verificare",interesting:"Indizi di opportunità"};
export function territoryCategory(row:Pick<IntelligenceRow,"exit_classification"|"state"|"opportunity_score">):string {
  if(["SOLD_CONFIRMED","SOLD_PROBABLE"].includes(row.exit_classification))return "sold";
  if(["UNKNOWN_EXIT","WITHDRAWN","AGENCY_CHANGED","RELISTED","MISSING_UNCONFIRMED"].includes(row.exit_classification))return "exit";
  if(row.state!=="ACTIVE")return "unknown";
  if((row.opportunity_score??0)>=50)return "interesting";
  return "active";
}
