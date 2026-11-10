import {createHash} from 'node:crypto';

export type ArchiveGroup={id:string|number;property_id:string|null;publication_id:string|null;row_data:Record<string,unknown>;observations:Record<string,unknown>[]};
export interface ArchiveSql {query(sql:string,params?:unknown[]):Promise<{rows:Record<string,unknown>[]}>}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function canonicalArchive(value:unknown):string {
 return JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
}
export function archiveDigest(value:unknown){return createHash('sha256').update(canonicalArchive(value)).digest('hex');}
export function validateArchiveGroup(value:ArchiveGroup):ArchiveGroup{
 if(!/^[1-9]\d*$/.test(String(value.id))||!Number.isSafeInteger(Number(value.id)))throw Error('Invalid archive group ID');
 for(const id of [value.property_id,value.publication_id])if(id!==null&&!uuid.test(id))throw Error('Invalid archive relationship');
 if(!value.row_data||Array.isArray(value.row_data)||typeof value.row_data!=='object'||!Array.isArray(value.observations))throw Error('Incomplete archive group');
 const ids=new Set<string>();
 for(const o of value.observations){
  if(!o||typeof o.id!=='string'||!uuid.test(o.id)||ids.has(o.id)||o.snapshot_id!==null&&(typeof o.snapshot_id!=='string'||!uuid.test(o.snapshot_id))||typeof o.created_at!=='string'||!Number.isFinite(Date.parse(o.created_at)))throw Error('Invalid or repeated archive observation');
  ids.add(o.id);
 }
 return {...value,id:String(value.id)};
}

/** Dedicated connection required: the transaction and checkpoint must share it. */
export async function copyArchiveBatch(db:ArchiveSql,source:string,input:ArchiveGroup[],expectedCursor:string,reconcileEarlier=false){
 if(!/^[a-f0-9]{64}$/.test(source)||!/^\d+$/.test(expectedCursor)||input.length>250)throw Error('Invalid archive batch');
 const rows=input.map(validateArchiveGroup);
 if(new Set(rows.map(r=>r.id)).size!==rows.length||rows.some((r,i)=>BigInt(r.id)<=BigInt(i?rows[i-1]!.id:reconcileEarlier?'0':expectedCursor)))throw Error('Unordered archive batch');
 await db.query('begin');
 try{
  await db.query('insert into radar_archive.sources(source) values($1) on conflict do nothing',[source]);
  const state=await db.query('select last_id::text last_id from radar_archive.sources where source=$1 for update',[source]);
  if(state.rows[0]?.last_id!==expectedCursor)throw Error('Archive cursor changed: reload before retry');
  const packed=rows.map(row=>({id:row.id,property_id:row.property_id,publication_id:row.publication_id,algorithm:typeof row.row_data.algorithm==='string'?row.row_data.algorithm:null,fingerprint:typeof row.row_data.fingerprint==='string'?row.row_data.fingerprint:null,payload:row,digest:archiveDigest(row)}));
  await db.query(`insert into radar_archive.fingerprint_groups(source,id,property_id,publication_id,algorithm,fingerprint,payload,digest)
   select $1,(r->>'id')::bigint,(r->>'property_id')::uuid,(r->>'publication_id')::uuid,r->>'algorithm',r->>'fingerprint',r->'payload',r->>'digest'
   from jsonb_array_elements($2::jsonb) r on conflict(source,id) do nothing`,[source,JSON.stringify(packed)]);
  const saved=await db.query('select id::text id,payload,digest from radar_archive.fingerprint_groups where source=$1 and id=any($2::bigint[]) order by radar_archive.fingerprint_groups.id',[source,rows.map(r=>r.id)]);
  if(saved.rows.length!==rows.length||saved.rows.some((r,i)=>r.digest!==packed[i]!.digest||archiveDigest(r.payload)!==packed[i]!.digest))throw Error('Archive readback differs: checkpoint unchanged');
  const last=String(BigInt(rows.at(-1)?.id??expectedCursor)>BigInt(expectedCursor)?rows.at(-1)!.id:expectedCursor);
  await db.query('update radar_archive.sources set last_id=$2,updated_at=now() where source=$1',[source,last]);
  await db.query('commit');return {lastId:last,groups:rows.length,observations:rows.reduce((n,r)=>n+r.observations.length,0)};
 }catch(error){await db.query('rollback');throw error;}
}

export async function readArchivedIdentity(db:ArchiveSql,source:string,ids:string[]){
 if(!/^[a-f0-9]{64}$/.test(source)||ids.length>75||ids.some(id=>!uuid.test(id)))throw Error('Invalid identity batch');
 const result=await db.query('select distinct property_id,algorithm,fingerprint from radar_archive.fingerprint_groups where source=$1 and property_id=any($2::uuid[]) order by property_id,algorithm,fingerprint',[source,ids]);
 return result.rows;
}
