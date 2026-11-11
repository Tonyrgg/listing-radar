import {gzipSync,gunzipSync}from'node:zlib';
import {createHash}from'node:crypto';
import type {SupabaseClient}from'@supabase/supabase-js';
import {canonicalArchive,validateArchiveGroup,type ArchiveGroup,type ArchiveSql}from'./external-fingerprints';
const sha=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex');
const bucket='radar-archive-backups';
export async function backupExternalArchive(db:ArchiveSql,storage:SupabaseClient,source:string,cutoff:string,deadline:number){
 const remote=storage.storage.from(bucket),parts:{name:string;sha256:string;bytes:number;groups:number}[]=[];
 const content=createHash('sha256');let cursor='0',groups=0,observations=0,bytes=0;
 // Reuse a verified immutable prefix. Re-download/check every saved chunk,
 // but avoid transferring the same full archive from PostgreSQL each day.
 const manifests=await remote.list('manifests',{limit:1000});
 if(manifests.error||!manifests.data||manifests.data.length===1000)throw Error('Backup catalog unavailable');
 const candidates=manifests.data.map(r=>r.name).filter(n=>/^\d{4}-\d{2}-\d{2}-\d+\.json$/.test(n))
  .filter(n=>BigInt(n.slice(11,-5))<=BigInt(cutoff)).sort((a,b)=>BigInt(a.slice(11,-5))>BigInt(b.slice(11,-5))?-1:1);
 for(const candidate of candidates){
  const saved=await remote.download('manifests/'+candidate);if(saved.error||!saved.data)throw Error('Previous backup manifest unavailable');
  const previous=JSON.parse(await saved.data.text());if(previous.source!==source)continue;
  const count=await db.query('select count(*)::int n from radar_archive.fingerprint_groups where source=$1 and id<=$2',[source,String(previous.checkpoint)]);
  if(count.rows[0]?.n!==previous.groups)break; // Late lower IDs require a fresh scan.
  const prefix=createHash('sha256');let previousObservations=0;
  for(let offset=0;offset<previous.parts.length;offset+=4){
   if(Date.now()>deadline)throw Error('Backup deadline reached; pending source preserved');
   const batch=await Promise.all(previous.parts.slice(offset,offset+4).map(async(part:{name:string;sha256:string;bytes:number;groups:number})=>{
    if(typeof part.name!=='string'||!part.name.startsWith('chunks/'+source+'/'))throw Error('Invalid previous backup chunk');
    const downloaded=await remote.download(part.name);if(downloaded.error||!downloaded.data)throw Error('Previous backup chunk unavailable');
    return {part,data:Buffer.from(await downloaded.data.arrayBuffer())};
   }));
   for(const {part,data}of batch){
   if(sha(data)!==part.sha256||data.length!==part.bytes)throw Error('Previous backup checksum differs');
   const lines=gunzipSync(data).toString();let partGroups=0;
   for(const line of lines.trimEnd().split('\n')){const row=validateArchiveGroup(JSON.parse(line));if(BigInt(row.id)<=BigInt(cursor)||BigInt(row.id)>BigInt(previous.checkpoint))throw Error('Previous backup order differs');cursor=String(row.id);partGroups++;previousObservations+=row.observations.length;}
   if(partGroups!==part.groups)throw Error('Previous backup count differs');
   prefix.update(lines);content.update(lines);groups+=partGroups;bytes+=data.length;parts.push(part);
   }
  }
  if(groups!==previous.groups||previousObservations!==previous.observations||prefix.digest('hex')!==previous.payloadSha256)throw Error('Previous backup incomplete');
  observations=previousObservations;break;
 }
 for(;;){
  if(Date.now()>deadline)throw Error('Backup deadline reached; pending source preserved');
  const rows=await db.query('select id::text id,payload from radar_archive.fingerprint_groups where source=$1 and id>$2 and id<=$3 order by radar_archive.fingerprint_groups.id limit 250',[source,cursor,cutoff]);
  if(!rows.rows.length)break;
  const lines=rows.rows.map(r=>{const row=validateArchiveGroup(r.payload as ArchiveGroup);groups++;observations+=row.observations.length;return canonicalArchive(row)+'\n';}).join('');
  content.update(lines);const compressed=gzipSync(Buffer.from(lines)),digest=sha(compressed),name=`chunks/${source}/${digest}.jsonl.gz`;
  if(compressed.length>45000000)throw Error('Backup chunk exceeds Free upload size');
  const upload=await remote.upload(name,compressed,{contentType:'application/gzip',upsert:false});
  if(upload.error&&String((upload.error as {statusCode?:string}).statusCode)!=='409'&&!/already exists|duplicate/i.test(upload.error.message))throw Error('Backup upload failed');
  const saved=await remote.download(name);if(saved.error||!saved.data)throw Error('Backup readback unavailable');
  const data=Buffer.from(await saved.data.arrayBuffer());if(sha(data)!==digest||gunzipSync(data).toString()!==lines)throw Error('Stored backup differs');
  parts.push({name,sha256:digest,bytes:data.length,groups:rows.rows.length});bytes+=data.length;cursor=String(rows.rows.at(-1)!.id);
 }
 const count=await db.query('select count(*)::int n from radar_archive.fingerprint_groups where source=$1 and id<=$2',[source,cutoff]);
 if(count.rows[0]?.n!==groups)throw Error('Backup is incomplete');
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const manifest={version:1,source,checkpoint:cutoff,day,groups,observations,bytes,payloadSha256:content.digest('hex'),parts};
 const name=`manifests/${day}-${cutoff}.json`,body=canonicalArchive(manifest);
 const saved=await remote.upload(name,Buffer.from(body),{contentType:'application/json',upsert:true});if(saved.error)throw Error('Backup manifest failed');
 const verify=await remote.download(name);if(verify.error||!verify.data||await verify.data.text()!==body)throw Error('Backup manifest readback differs');
 return {name,groups,observations,bytes,checkpoint:cutoff,sha256:manifest.payloadSha256};
}
