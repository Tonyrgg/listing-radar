import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatDate } from "@/lib/formatting";
const labels:Record<string,string>={idealista:"Idealista",immobiliare:"Immobiliare.it",casa:"Casa.it",subito:"Subito",casadaprivato:"CasaDaPrivato"};
export async function PrivateRadarStatus(){
 const result=await getSupabaseServiceClient().from("private_radar_source_health").select("source,checked_at,state,discovered_count,failed_count").order("source");
 return <details className="lr-market-agencies"><summary>Copertura delle fonti</summary>
 <p>La prima osservazione e la data pubblicata dal portale restano distinte. Una lettura bloccata conserva i dati precedenti.</p>
 {result.error?<p>Stato delle fonti temporaneamente non disponibile.</p>:<ul>{Object.entries(labels).map(([key,label])=>{
  const row=result.data?.find(r=>r.source===key);
  return <li key={key}><strong>{label}</strong>: {row?`${row.state==="DEGRADED"?"lettura parziale o bloccata":"lettura effettuata"} · ${row.discovered_count} riferimenti raccolti · ${formatDate(row.checked_at)}`:"non ancora verificata"}</li>;
 })}</ul>}</details>;
}
