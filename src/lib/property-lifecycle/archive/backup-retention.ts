import type {SupabaseClient} from '@supabase/supabase-js';
export function retainedManifests(names:string[],today:string){
 const sorted=[...names].sort().reverse(),keep=new Set<string>(),weeks=new Set<number>();
 const now=Date.parse(today+'T00:00:00Z');
 for(const name of sorted){const match=/^(\d{4}-\d{2}-\d{2})-\d+\.json$/.exec(name);if(!match)throw Error('Unknown backup manifest');
  const time=Date.parse(match[1]+'T00:00:00Z'),age=(now-time)/86400000,week=Math.floor(time/604800000);
  if(age<=7){keep.add(name);weeks.add(week);}else if(age<=35&&!weeks.has(week)){keep.add(name);weeks.add(week);}
 }
 if(sorted[0])keep.add(sorted[0]);return keep;
}
/** Fail closed: inspect every retained manifest before deleting any chunk. */
export async function pruneArchiveBackups(storage:SupabaseClient,source:string,current:string,deadline:number){
 const remote=storage.storage.from('radar-archive-backups');
 const listed=await remote.list('manifests',{limit:1000,sortBy:{column:'name',order:'asc'}});if(listed.error||!listed.data||listed.data.length===1000)throw Error('Backup retention listing incomplete');
 const all=listed.data.map(r=>r.name),day=new Date().toISOString().slice(0,10),keep=retainedManifests(all,day);keep.add(current.replace('manifests/',''));
 const referenced=new Set<string>();
 for(const name of all){if(Date.now()>deadline)return {removed:0};const saved=await remote.download('manifests/'+name);if(saved.error||!saved.data)throw Error('Retention manifest unavailable');const manifest=JSON.parse(await saved.data.text());
  // A bucket may hold other source archives. Preserve their manifests and chunks.
  if(manifest.source!==source){keep.add(name);continue;}
  if(keep.has(name)){if(!Array.isArray(manifest.parts)||!manifest.parts.length)throw Error('Retention manifest incomplete');for(const part of manifest.parts){if(typeof part.name!=='string'||!part.name.startsWith('chunks/'+source+'/'))throw Error('Invalid retained chunk');referenced.add(part.name);}}
 }
 if(Date.now()>deadline)return {removed:0};
 const obsolete=all.filter(n=>!keep.has(n)).map(n=>'manifests/'+n);if(obsolete.length){const result=await remote.remove(obsolete);if(result.error)throw Error('Manifest retention failed');}
 let removed=obsolete.length,offset=0;const garbage:string[]=[];
 for(;;){if(Date.now()>deadline)return {removed};const chunks=await remote.list('chunks/'+source,{limit:1000,offset,sortBy:{column:'name',order:'asc'}});if(chunks.error||!chunks.data)throw Error('Chunk listing failed');
  for(const chunk of chunks.data){const path='chunks/'+source+'/'+chunk.name;if(!referenced.has(path)&&chunk.created_at&&Date.parse(chunk.created_at)<Date.now()-48*3600000)garbage.push(path);}offset+=chunks.data.length;if(chunks.data.length<1000)break;}
 for(let i=0;i<garbage.length;i+=100){if(Date.now()>deadline)break;const deleted=await remote.remove(garbage.slice(i,i+100));if(deleted.error)throw Error('Chunk retention failed');removed+=Math.min(100,garbage.length-i);}return {removed};
}
