import {Client}from'pg';
import type {SupabaseClient}from'@supabase/supabase-js';
import {archiveDigest,copyArchiveBatch,type ArchiveSql}from'./external-fingerprints';
import {pendingArchiveReader}from'./source-reader';
import {backupExternalArchive}from'./cloud-backup';
import {pruneArchiveBackups}from'./backup-retention';
export async function maintainExternalArchive(db:SupabaseClient,options:{connection:string;sourceUrl:string;compact?:boolean;acknowledge?:boolean;budgetMs?:number}){
 const url=new URL(options.connection);
 if(url.hostname!=='db.prisma.io'||url.searchParams.get('sslmode')!=='verify-full')throw Error('Verified Prisma connection required');
 const source=archiveDigest(new URL(options.sourceUrl).origin),start=Date.now(),deadline=start+(options.budgetMs??270000);
 const client=new Client({connectionString:url.href,connectionTimeoutMillis:10000,query_timeout:25000});
 const sql:ArchiveSql={query:(q,p)=>client.query(q,p)};const report={phase:'connect',copied:0,acknowledged:0,compacted:0,remaining:0,backup:null as Awaited<ReturnType<typeof backupExternalArchive>>|null,busy:false};
 let run:string|null=null;
 try{
  await client.connect();
  const lock=await client.query('select pg_try_advisory_lock(hashtextextended($1,0)) acquired',[source]);
  if(!lock.rows[0]?.acquired){report.busy=true;return report;}
  const created=await db.from('fingerprint_archive_maintenance_runs').insert({status:'RUNNING'}).select('id').single();
  if(created.error||!created.data)throw Error('Maintenance journal unavailable');run=created.data.id;
  report.phase='compaction';
  if(options.compact!==false){const running=await db.from('lifecycle_jobs').select('id').eq('status','RUNNING').limit(1);if(running.error)throw Error('Sync state unavailable');
   if(!running.data?.length){const pubs=await db.rpc('fingerprint_compaction_publications',{p_limit:10});if(pubs.error)throw Error('Compaction candidates unavailable');
    for(const row of pubs.data??[]){if(Date.now()>start+25000)break;const result=await db.rpc('compact_image_fingerprints',{p_publication_id:row.publication_id,p_limit:1000});if(result.error)throw Error('Local compaction failed');report.compacted+=Number(result.data);}}}
  report.phase='copy';
  const state=await client.query('select last_id::text last_id from radar_archive.sources where source=$1',[source]);let cursor=String(state.rows[0]?.last_id??'0');
  const pending=pendingArchiveReader(db);
  // PostgreSQL sequences allocate before commit: a late transaction may expose
  // an older ID after the external checkpoint advanced. Reconcile those safely.
  const earlier=(await pending('0')).filter(row=>BigInt(row.id)<=BigInt(cursor));
  if(earlier.length)await copyArchiveBatch(sql,source,earlier,cursor,true);
  while(Date.now()<start+50000){const rows=await pending(cursor);if(!rows.length)break;const result=await copyArchiveBatch(sql,source,rows,cursor);cursor=result.lastId;report.copied+=rows.length;}
  report.phase='backup';report.backup=await backupExternalArchive(sql,db,source,cursor,deadline-25000);
  report.phase='acknowledgement';
  if(options.acknowledge!==false){while(Date.now()<deadline){const result=await db.from('image_fingerprint_archive_groups').select('id').lte('id',cursor).order('id').limit(25);if(result.error)throw Error('Pending receipt read failed');if(!result.data?.length)break;
   const acknowledged=await db.rpc('acknowledge_external_fingerprint_groups',{p_ids:result.data.map(r=>r.id)});if(acknowledged.error)throw Error('Verified acknowledgement failed');report.acknowledged+=Number(acknowledged.data);}}
  const pendingCount=await db.from('image_fingerprint_archive_groups').select('id',{count:'exact',head:true});if(pendingCount.error)throw Error('Pending count unavailable');report.remaining=pendingCount.count??0;
  if(report.remaining===0&&options.acknowledge!==false){const reclaimed=await db.rpc('reclaim_empty_fingerprint_outbox');if(reclaimed.error)throw Error('Outbox space reclaim failed');}
  report.phase='retention';if(Date.now()<deadline-10000)await pruneArchiveBackups(db,source,report.backup.name,deadline-5000);
  report.phase='complete';
  const complete=await db.from('fingerprint_archive_maintenance_runs').update({status:'SUCCEEDED',finished_at:new Date().toISOString(),summary:report}).eq('id',run);if(complete.error)throw Error('Maintenance outcome not persisted');
  return report;
 }catch(error){const reason=String(error instanceof Error?error.message:'Archive maintenance failed').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[redacted]').slice(0,250);if(run)await db.from('fingerprint_archive_maintenance_runs').update({status:'FAILED',finished_at:new Date().toISOString(),summary:{...report,error:reason}}).eq('id',run);throw error;}
 finally{await client.end();}
}
