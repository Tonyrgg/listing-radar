import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PRIVATE_PORTALS } from '../src/lib/property-lifecycle/private-radar/collector';
import { getSupabaseServiceClient } from '../src/lib/supabase/service';

// Positive URL intake: detail verification remains the hourly collector's job.
export function portalUrl(value: string) {
 const url = new URL(value);
 if (url.protocol !== 'https:' || url.username || url.password) throw new Error('URL HTTPS pubblico richiesto');
 for (const [source, profile] of Object.entries(PRIVATE_PORTALS)) {
  const id = profile.id.exec(url.pathname)?.[1];
  if (url.origin === new URL(profile.url).origin && id) {
   url.search=''; url.hash='';
   return {source,source_listing_id:id,canonical_url:url.href};
  }
 }
 throw new Error('URL non riconosciuto nei portali supportati');
}
async function main(){
 const file=process.argv.find(v=>v.startsWith('--file='))?.slice(7);
 const input=file?JSON.parse(await readFile(file,'utf8')):process.argv.filter(v=>v.startsWith('https://'));
 if(!Array.isArray(input)||!input.length||input.length>1000||!input.every(v=>typeof v==='string'))throw new Error('Fornire URL o --file=lista.json (massimo 1000 URL)');
 const rows=[...new Map(input.map(v=>{const row=portalUrl(v);return [row.source+':'+row.source_listing_id,row] as const;})).values()];
 if(!process.argv.includes('--apply')){console.log(JSON.stringify({dryRun:true,urls:rows}));return;}
 const project=process.argv.find(v=>v.startsWith('--confirm-project='))?.split('=')[1];
 const host=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname;
 if(!['localhost','127.0.0.1'].includes(host)&&host.split('.')[0]!==project)throw new Error('Richiesto --confirm-project corrispondente');
 const db=getSupabaseServiceClient(),owner=randomUUID();
 const claim=await db.rpc('claim_private_radar',{p_owner:owner});if(claim.error||claim.data!==true)throw new Error('Raccoglitore occupato; riprovare dopo la run');
 try{
  for(let start=0;start<rows.length;start+=100){
   const saved=await db.from('private_radar_inbox').upsert(rows.slice(start,start+100),{onConflict:'source,source_listing_id',ignoreDuplicates:true});if(saved.error)throw saved.error;
  }
  console.log(JSON.stringify({queued:rows.length,verified:false,note:'URL accodati; nessun annuncio dichiarato verificato prima della lettura del dettaglio'}));
 }finally{const release=await db.rpc('release_private_radar',{p_owner:owner});if(release.error)throw release.error;}
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/private-radar-add-urls.ts'))main().catch(e=>{console.error(e.message);process.exitCode=1;});
