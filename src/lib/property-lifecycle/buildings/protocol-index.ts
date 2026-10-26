import {BITONTO_PROTOCOL_OFFICES,BITONTO_PROTOCOL_RESOURCE} from './protocol-register';
import {hashValue} from '../contracts/normalized-listing';

const fields=['_id','Applicazione','Numero Pratica','Oggetto','Data Protocollo','Numero Protocollo','Ufficio Responsabile'];
const officeFilter='"Ufficio Responsabile" IN ('+BITONTO_PROTOCOL_OFFICES.map(office=>"'"+office.replaceAll("'","''")+"'").join(',')+')';
const endpoint='https://dati.puglia.it/ckan/api/3/action/datastore_search_sql';
const limit=1000,maxBytes=3_000_000;

async function query(sql:string,fetcher:typeof fetch){
 const url=new URL(endpoint);url.searchParams.set('sql',sql);
 let response:Response|undefined;
 for(let attempt=0;attempt<3;attempt++){
  if(attempt)await new Promise(resolve=>setTimeout(resolve,450*2**attempt));
  response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(25000)});
  if(response.status!==429&&response.status<500)break;
  await response.body?.cancel();
 }
 if(!response?.ok)throw Error('Territory protocol source HTTP '+response?.status);
 if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw Error('Territory protocol response too large');}
 const reader=response.body?.getReader();if(!reader)throw Error('Empty territory protocol response');
 const chunks:Uint8Array[]=[];let bytes=0;
 try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>maxBytes)throw Error('Territory protocol response too large');chunks.push(chunk.value);}}
 catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
 let result;
 try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Territory CKAN returned invalid JSON');}
 if(result.success!==true||!Array.isArray(result.result?.records))throw Error('Territory CKAN response not confirmed');
 return result.result as {records:Array<Record<string,unknown>>;fields?:Array<{id:string}>};
}

async function readIndex(resource:string,columns:string[],filter:string,maxRows:number,fetcher:typeof fetch,officesOnly:boolean){
 const table='"'+resource+'"';
 const countSql=`SELECT COUNT(*) AS total FROM ${table} WHERE ${filter}`;
 const total=Number((await query(countSql,fetcher)).records[0]?.total);
 if(!Number.isSafeInteger(total)||total<1||total>maxRows)throw Error('Unexpected territory protocol inventory size');
 const rows:Array<Record<string,unknown>>=[];const ids=new Set<number>();let pages=0,lastId=-1;
 for(let offset=0;offset<total;offset+=limit){
  if(pages)await new Promise(resolve=>setTimeout(resolve,450));
  const result=await query(`SELECT ${columns.map(field=>'"'+field+'"').join(',')} FROM ${table} WHERE ${filter} AND "_id">${lastId} ORDER BY "_id" ASC LIMIT ${limit}`,fetcher);
  if(!result.fields||columns.some(field=>!result.fields!.some(value=>value.id===field)))throw Error('Territory protocol schema changed');
  if(result.records.length!==Math.min(limit,total-offset))throw Error('Incomplete territory protocol page');
  for(const record of result.records){
   const id=Number(record._id);
   if(!Number.isSafeInteger(id)||id<=lastId||ids.has(id)||(officesOnly&&(BITONTO_PROTOCOL_OFFICES as readonly string[]).indexOf(String(record['Ufficio Responsabile']))<0))throw Error('Territory protocol inventory drift');
   if(columns.some(field=>record[field]!==null&&!['string','number'].includes(typeof record[field])))throw Error('Unexpected territory protocol field');
   if(columns.some(field=>String(record[field]??'').length>20000))throw Error('Territory protocol field exceeds limit');
   ids.add(id);lastId=id;rows.push(record);
  }
  pages++;
 }
 if(Number((await query(countSql,fetcher)).records[0]?.total)!==total)throw Error('Territory protocol inventory changed during reading');
 const cell=(value:unknown)=>'"'+String(value??'').replaceAll('"','""')+'"';
 const csv=[columns.map(cell).join(','),...rows.map(record=>columns.map(field=>cell(record[field])).join(','))].join('\n');
 return {csv,pages,inputRows:rows.length,structureFingerprint:hashValue({fields:columns,offices:officesOnly?BITONTO_PROTOCOL_OFFICES:null,resource}),sourceEtag:hashValue(csv)};
}
/** Bounded public index for five exact offices. Raw subjects live only in memory. */
export const readTerritoryProtocolIndex=(fetcher:typeof fetch=fetch)=>readIndex(BITONTO_PROTOCOL_RESOURCE,fields,officeFilter,8000,fetcher,true);
/** Official regional datastore, independently available from the Maggioli CSV host. */
export const read2025PracticeIndex=(fetcher:typeof fetch=fetch)=>readIndex('ac5b1cf7-c4c3-4b42-8a00-88ea9df5ce2b',fields.slice(0,-1),'TRUE',20000,fetcher,false);
