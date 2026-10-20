import {normalizeStreetName} from '@/lib/street-registry/official-inventory';
import type {RegistryStreet} from './territorial-extraction';
export const TERRITORIAL_GRAPH_VERSION='territorial_graph_v1';
export function territorialRecordRecent(date:string|null|undefined,status:string|null|undefined,now:number,days:number){
 const day=Math.floor(now/86400000)*86400000,value=date?Date.parse(date):NaN;
 return !/annull|revocat|revok|cancel/i.test(status??'')&&Number.isFinite(value)&&value<=day&&day-value<=days*86400000;
}
export const UNMATCHED_CAUSES=['NO_ADDRESS_AVAILABLE','STREET_ONLY','STREET_AND_CIVIC_NOT_IN_REGISTRY','CIVIC_AMBIGUOUS','MULTIPLE_BUILDING_CANDIDATES','LOCALITY_ONLY','CADASTRAL_ONLY','AREA_DOCUMENT','DATASET_WITHOUT_TERRITORIAL_FIELDS','NORMALIZATION_FAILURE','OTHER'] as const;
export type UnmatchedCause=typeof UNMATCHED_CAUSES[number];
export function streetKey(value:string){
 return normalizeStreetName(value).replace(/'\s*/g,'').replace(/^V LE /,'VIALE ').replace(/^P ZZA /,'PIAZZA ').replace(/^C SO /,'CORSO ')
  .replace(/\b(PROFESSORE|PROFESSOR|PROF|DOTTORE|DOTTOR|DOTT|MONSIGNORE|MONS)\b/g,'').replace(/\s+/g,' ').trim();
}
export function localityKey(value:string|null|undefined){return /MARIOTTO/i.test(value??'')?'MARIOTTO':/PALOMBAIO/i.test(value??'')?'PALOMBAIO':'BITONTO';}
export function parseCivics(value:string|null|undefined):{state:'EXPLICIT'|'RANGE'|'SNC'|'MISSING'|'AMBIGUOUS';values:string[]}{
 const s=(value??'').trim().replace(/[–—]/g,'-');
 if(!s)return {state:'MISSING',values:[]};
 if(/^S\.?\s*N\.?\s*C\.?$/i.test(s))return {state:'SNC',values:[]};
 if(/\d[a-z]{0,2}\s*-\s*\d/i.test(s))return {state:'RANGE',values:[]};
 if(/^\d+[a-z]{0,2}\s*\/\s*\d+/i.test(s)&&!s.split('/').every(v=>/^\d+[a-z]{1,2}$/i.test(v.replace(/\s/g,''))))return {state:'RANGE',values:[]};
 const normalized=s.replace(/(\d)\s*\/\s*([a-z])\b/gi,'$1$2');
 const tokens=normalized.split(/\s*(?:,|;|\be\b|\/)\s*/i);
 const values=tokens.map(v=>v.replace(/\s+/g,'').toLowerCase()).map(v=>{const m=v.match(/^0*(\d+)([a-z]{0,2})$/);return m?String(Number(m[1]))+m[2]:null;});
 return values.every(Boolean)?{state:'EXPLICIT',values:[...new Set(values as string[])]}:{state:'AMBIGUOUS',values:[]};
}
function equivalent(request:string,official:string){
 const a=streetKey(request).split(' '),b=streetKey(official).split(' ');
 return a.length===b.length&&a.every((v,i)=>v===b[i]||(i>0&&v.length===1&&b[i].startsWith(v)));
}
export function resolveStreet(name:string,locality:string|null,streets:RegistryStreet[]):{street:RegistryStreet|null;candidateIds:string[];status:'RESOLVED'|'REVIEW'|'UNRESOLVED'}{
 const suffix=name.match(/\s*[-,]\s*(MARIOTTO|PALOMBAIO)$/i)?.[1];
 if(suffix&&locality&&localityKey(suffix)!==localityKey(locality))return {street:null,candidateIds:[],status:'REVIEW'};
 const requested=name.replace(/\s*[-,]\s*(?:MARIOTTO|PALOMBAIO)$/i,'');
 const candidates=streets.filter(s=>localityKey(s.locality)===localityKey(locality??suffix)&&[
  s.canonical_name,`${s.official_type??''} ${s.official_description??''}`,
 ].some(alias=>equivalent(requested,alias.replace(/\s*[-,]\s*(?:MARIOTTO|PALOMBAIO)$/i,''))));
 const ids=[...new Set(candidates.map(s=>s.id))].sort();
 return {street:ids.length===1?candidates[0]:null,candidateIds:ids,status:ids.length===1?'RESOLVED':ids.length?'REVIEW':'UNRESOLVED'} as const;
}
export interface LocationInput {id:string;municipality:string|null;locality:string|null;street_name:string|null;street_number:string|null;scope_state?:string}
export interface LocationResolution {id:string;streetId:string|null;civic:string|null;candidateIds:string[];status:string;version:string}
export function resolveLocation(l:LocationInput,streets:RegistryStreet[]):LocationResolution{
 const s=resolveStreet(l.street_name??'',l.locality,streets),c=parseCivics(l.street_number);
 const allowed=(l.municipality??'').toLowerCase()==='bitonto'&&l.scope_state==='IN_SCOPE'&&(!l.locality||/^(?:bitonto|palombaio|mariotto)$/i.test(l.locality));
 return {id:l.id,streetId:allowed?s.street?.id??null:null,civic:allowed&&c.values.length===1?c.values[0]:null,candidateIds:s.candidateIds,status:!allowed?'OUT_OF_SCOPE':s.status==='REVIEW'||c.state==='RANGE'||c.state==='AMBIGUOUS'?'REVIEW':s.status,version:TERRITORIAL_GRAPH_VERSION};
}
export interface GraphRecord {id:string;source_key:string;record_type:string;content_hash:string;area_name:string|null;addresses:Array<{streetName:string;streetNumber:string;locality?:string}>;territorial_references?:Array<{streetName:string;locality:string;civicText:string|null;civics:string[];candidateStreetIds?:string[]}>;cadastral_references:unknown[];building_ids:string[]}
export interface RecordResolution {id:string;inputHash:string;version:string;references:Array<{streetId:string|null;streetName:string;locality:string;civicText:string|null;civics:string[];civicState:string;candidateStreetIds:string[]}>;buildingIds:string[];candidateBuildingIds:string[];unmatchedCause:UnmatchedCause|null}
export function resolveRecord(r:GraphRecord,streets:RegistryStreet[],buildings:Array<{id:string;location_id:string|null}>,locations:LocationResolution[]):RecordResolution{
 const refs=(r.territorial_references?.length?r.territorial_references:r.addresses.map(a=>({streetName:a.streetName,locality:a.locality??'Bitonto',civicText:a.streetNumber,civics:[a.streetNumber]}))).map(a=>{
  const s=resolveStreet(a.streetName,a.locality,streets),c=parseCivics(a.civicText);
  return {streetId:s.street?.id??null,streetName:s.street?.canonical_name??a.streetName,locality:localityKey(a.locality),civicText:a.civicText,civics:c.values,civicState:c.state,candidateStreetIds:s.candidateIds};
 });
 const loc=new Map(locations.map(l=>[l.id,l])),exact=new Set<string>(),candidates=new Set<string>();let multiple=false;
 for(const ref of refs)for(const civic of ref.civics){if(!ref.streetId)continue;const bs=buildings.filter(b=>{const l=b.location_id?loc.get(b.location_id):null;return l?.streetId===ref.streetId&&l.civic===civic&&l.status==='RESOLVED';});bs.forEach(b=>candidates.add(b.id));if(bs.length===1)exact.add(bs[0].id);if(bs.length>1)multiple=true;}
 let cause:UnmatchedCause|null=null;
 if(!exact.size&&!r.building_ids.length){
  if(r.source_key==='comune-bitonto-elenco-pratiche-2025')cause='DATASET_WITHOUT_TERRITORIAL_FIELDS';
  else if(['URBAN_PLAN','URBAN_VARIANT'].includes(r.record_type))cause='AREA_DOCUMENT';
  else if(multiple)cause='MULTIPLE_BUILDING_CANDIDATES';
  else if(refs.some(s=>s.candidateStreetIds.length>1||['RANGE','AMBIGUOUS'].includes(s.civicState)))cause='CIVIC_AMBIGUOUS';
  else if(refs.some(s=>!s.streetId))cause='NORMALIZATION_FAILURE';
  else if(refs.some(s=>s.civics.length))cause='STREET_AND_CIVIC_NOT_IN_REGISTRY';
  else if(refs.length)cause='STREET_ONLY';
  else if(r.cadastral_references.length)cause='CADASTRAL_ONLY';
  else if(r.area_name)cause='LOCALITY_ONLY';else cause='NO_ADDRESS_AVAILABLE';
 }
 return {id:r.id,inputHash:r.content_hash,version:TERRITORIAL_GRAPH_VERSION,references:refs,buildingIds:[...exact].sort(),candidateBuildingIds:[...candidates].sort(),unmatchedCause:cause};
}
