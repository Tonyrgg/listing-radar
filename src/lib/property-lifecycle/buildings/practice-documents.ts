import type {SupabaseClient} from '@supabase/supabase-js';
import {hashValue} from '../contracts/normalized-listing';
import {safeAlboUrl} from './albo';
import {PRACTICE_INDEX_SOURCE_KEYS,PUBLIC_RECORD_POLICY} from './public-record-policy';

export const PRACTICE_DOCUMENT_POLICY='practice_primary_document_v1';
export interface AdministrativeIdentity {practiceNumber:string;protocolNumber:string;protocolDate:string}

function isoDate(value:string){
 const italian=value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
 const date=italian?`${italian[3]}-${italian[2].padStart(2,'0')}-${italian[1].padStart(2,'0')}`:value;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
 const parsed=new Date(date+'T00:00:00Z');
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date?date:null;
}
export function administrativeIdentity(practice:unknown,protocol:unknown,date:unknown):AdministrativeIdentity|null{
 if(typeof practice!=='string'||!['string','number'].includes(typeof protocol)||typeof date!=='string')return null;
 const number=practice.toUpperCase().trim().replace(/\s*\/\s*/g,'/');
 const prot=String(protocol).trim();
 if(!/^\d{1,12}\/(?:19|20)\d{2}\/(?:CILA|SCIA|SCA|CDU|PDC|SANATORIA|CONDONO)$/.test(number)||!/^\d{1,14}$/.test(prot))return null;
 const protocolDate=isoDate(date);
 return protocolDate?{practiceNumber:number,protocolNumber:prot.replace(/^0+(?=\d)/,''),protocolDate}:null;
}

/** Extract administrative identifiers only. Neither the subject nor names are retained. */
export function extractAdministrativeIdentity(text:string){
 const practices=[...text.matchAll(/\b\d{1,12}\s*\/\s*(?:19|20)\d{2}\s*\/\s*(?:CILA|SCIA|SCA|CDU|PDC|SANATORIA|CONDONO)\b/gi)];
 const protocols=[...text.matchAll(/\bprot(?:ocollo)?\.?\s*(?:(?:n(?:umero)?\.?|n°)\s*)?(\d{1,14})\s*(?:del|in\s+data)\s*(\d{1,2}[/.]\d{1,2}[/.]\d{4}|\d{4}-\d{2}-\d{2})\b/gi)];
 const practiceIds=[...new Set(practices.map(match=>match[0].replace(/\s/g,'').toUpperCase()))];
 const protocolIds=[...new Set(protocols.map(match=>`${match[1]}:${isoDate(match[2])??'INVALID'}`))];
 const close=practices.some(practice=>protocols.some(protocol=>Math.abs(practice.index!-protocol.index!)<=250));
 const identity=practiceIds.length===1&&protocolIds.length===1&&close?administrativeIdentity(practiceIds[0],protocols[0][1],protocols[0][2]):null;
 return {version:PRACTICE_DOCUMENT_POLICY,identity,practiceReferences:practiceIds.length,protocolReferences:protocolIds.length};
}

export interface PracticeIndexRecord {id:string;content_hash:string;practice_number:string|null;protocol_number:string|null;occurred_at:string|null;sanitized_payload?:Record<string,unknown>}
export interface PrimaryDocumentRecord {id:string;content_hash:string;document_urls:unknown;sanitized_payload:Record<string,unknown>}
export type DocumentSearchState='LINKED'|'NO_ATTACHMENT'|'NO_MATCH'|'AMBIGUOUS'|'IDENTIFIERS_MISSING';
function publicDocuments(value:unknown){
 if(!Array.isArray(value))return [] as string[];
 return [...new Set(value.filter((url):url is string=>typeof url==='string').flatMap(url=>{try{return [safeAlboUrl(url)];}catch{return [];}}))];
}
function primaryIdentity(record:PrimaryDocumentRecord){
 const ref=record.sanitized_payload.administrativeReferences as {identity?:AdministrativeIdentity}|undefined;
 return ref?.identity?administrativeIdentity(ref.identity.practiceNumber,ref.identity.protocolNumber,ref.identity.protocolDate):null;
}
const identityKey=(identity:AdministrativeIdentity)=>JSON.stringify(identity);

export function matchPracticeDocuments(index:PracticeIndexRecord[],documents:PrimaryDocumentRecord[]){
 const byIdentity=new Map<string,PrimaryDocumentRecord[]>();
 for(const record of documents){if(record.sanitized_payload.treatment==='ARCHIVE_ONLY_JUDICIAL')continue;const identity=primaryIdentity(record);if(!identity)continue;const key=identityKey(identity);byIdentity.set(key,[...(byIdentity.get(key)??[]),record]);}
 return index.filter(record=>record.sanitized_payload?.treatment!=='ARCHIVE_ONLY_JUDICIAL').map(record=>{
  // The importer preserves one coherent protocol/date pair from the same row.
  // Multiple protocols, invalid dates and old records without this proof wait.
  const declared=record.sanitized_payload?.registryIdentity as AdministrativeIdentity|undefined;
  const identity=declared?administrativeIdentity(declared.practiceNumber,declared.protocolNumber,declared.protocolDate):null;
  const candidates=identity?byIdentity.get(identityKey(identity))??[]:[];
  const unique=candidates.length===1?candidates[0]:null;
  const urls=unique?publicDocuments(unique.document_urls):[];
  const state:DocumentSearchState=!identity?'IDENTIFIERS_MISSING':candidates.length>1?'AMBIGUOUS':!unique?'NO_MATCH':urls.length?'LINKED':'NO_ATTACHMENT';
  return {index_record_id:record.id,index_input_hash:record.content_hash,primary_record_id:unique?.id??null,primary_input_hash:unique?.content_hash??null,
   search_state:state,administrative_identity:identity??{},candidate_count:candidates.length,policy_version:PRACTICE_DOCUMENT_POLICY,
   signature_hash:hashValue({index:record.content_hash,identity,state,candidates:candidates.map(candidate=>({id:candidate.id,hash:candidate.content_hash})).sort((a,b)=>a.id.localeCompare(b.id)),urls,version:PRACTICE_DOCUMENT_POLICY})};
 });
}

async function sourceRecords<T>(db:SupabaseClient,key:string|string[],fields:string){
 const records:T[]=[];
 for(let from=0;;from+=500){
  const query=db.from('building_practice_records').select(fields);
  const result=await (typeof key==='string'?query.eq('source_key',key):query.in('source_key',key)).order('id').range(from,from+499);
  if(result.error)throw Error(result.error.message);
  records.push(...result.data as T[]);if(result.data.length<500)return records;
  if(records.length>=50000)throw Error('Practice-document read limit reached');
 }
}
/** Derived document links only: no propagation of facts, unit identity or location. */
export async function reconcilePracticeDocuments(db:SupabaseClient,apply=false){
 const [index,documents]=await Promise.all([
  sourceRecords<PracticeIndexRecord>(db,PRACTICE_INDEX_SOURCE_KEYS,'id,content_hash,practice_number,protocol_number,occurred_at,sanitized_payload'),
  sourceRecords<PrimaryDocumentRecord>(db,PUBLIC_RECORD_POLICY.alboSource,'id,content_hash,document_urls,sanitized_payload'),
 ]);
 const rows=matchPracticeDocuments(index,documents),checkedAt=new Date().toISOString();
 if(apply)for(let from=0;from<rows.length;from+=100){
  const result=await db.from('building_practice_document_search').upsert(rows.slice(from,from+100).map(row=>({...row,checked_at:checkedAt})),{onConflict:'index_record_id'});
  if(result.error)throw Error(result.error.message);
 }
 return {processed:rows.length,states:Object.fromEntries(['LINKED','NO_ATTACHMENT','NO_MATCH','AMBIGUOUS','IDENTIFIERS_MISSING'].map(state=>[state,rows.filter(row=>row.search_state===state).length])),applied:apply};
}
