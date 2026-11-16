import {appendFile} from 'node:fs/promises';
import {PRIVATE_PORTALS} from '../src/lib/property-lifecycle/private-radar/collector';
import {getSupabaseServiceClient} from '../src/lib/supabase/service';
async function main(){
 const db=getSupabaseServiceClient();
 const health=await db.from('private_radar_source_health').select('source,state,checked_at,pages_visited,discovered_count');if(health.error)throw health.error;
 const lines=['## Copertura Radar privati','','I conteggi riguardano gli URL conosciuti. Non dimostrano la copertura totale del portale.','','| Portale | Lettura | Ultimo controllo | Pagine | URL conosciuti | Verificati | In attesa | Falliti | Esclusi |','|---|---|---|---:|---:|---:|---:|---:|---:|'];
 for(const source of Object.keys(PRIVATE_PORTALS)){
  const row=health.data.find(r=>r.source===source);
  const counts=await Promise.all([null,'ACCEPTED','PENDING','FAILED','EXCLUDED'].map(async status=>{let q=db.from('private_radar_inbox').select('id',{head:true,count:'exact'}).eq('source',source);if(status)q=q.eq('status',status);const r=await q;if(r.error)throw r.error;return r.count??0;}));
  const stale=!row||Date.now()-Date.parse(row.checked_at)>2*3600000;
  const state=stale?'CONTROLLO SCADUTO':row.state==='DEGRADED'?'PARZIALE / BLOCCATA':'OSSERVATA, TOTALE NON CERTIFICATO';
  lines.push(`| ${source} | ${state} | ${row?.checked_at??'mai'} | ${row?.pages_visited??0} | ${counts.join(' | ')} |`);
  if(stale||row?.state==='DEGRADED')console.log(`::warning::Radar ${source}: copertura incompleta; verificare il riepilogo`);
 }
 const report=lines.join('\n')+'\n';console.log(report);if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,report);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
