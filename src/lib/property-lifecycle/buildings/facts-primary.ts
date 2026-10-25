import type {SupabaseClient} from '@supabase/supabase-js';
import {hashValue} from '../contracts/normalized-listing';
import {normalizeBuildingPracticeRows,parseBuildingPracticeCsv} from './practices';
import {extractPropertyFacts,deepCandidate,FACT_POLICY,type PropertyFact} from './property-facts';
import {allFactRecords,readSemanticProjections,type SemanticProjection} from './facts-projection';
import type {NewsSourceContext} from './news-triage';
export interface PrimaryFacts {sourceKey:string;sourceRecordKey:string;events:PropertyFact[];newsContext?:NewsSourceContext}
/** Operates on the already-fetched CSV in memory, stores no free subject/person data. */
export function csvPrimaryFacts(csv:string,sourceKey:string,url:string,observedAt:string):PrimaryFacts[]{
 const hash=hashValue(csv),groups=new Map<string,PropertyFact[]>();
 const raw=parseBuildingPracticeCsv(csv);
 for(let i=0;i<raw.length;i++){
  const n=normalizeBuildingPracticeRows([raw[i]]).records[0];if(!n)continue;
  const events=groups.get(n.sourceRecordKey)??[];
  for(const field of ['Oggetto','Oggetto Fascicolo','Tipo Pratica']){
   const text=Object.entries(raw[i]).find(([k])=>k.replace(/\s/g,'').toLowerCase()===field.replace(/\s/g,'').toLowerCase())?.[1];if(!text)continue;
   for(const e of extractPropertyFacts(n.sourceRecordKey,{text,field,sourceUrl:url,sourceHash:hash,observedAt,row:i+2},n.occurredAt?.slice(0,10)??null))if(!events.some(v=>v.event_type===e.event_type))events.push(e);
  }
  groups.set(n.sourceRecordKey,events);
 }
 return [...groups].map(([sourceRecordKey,events])=>({sourceKey,sourceRecordKey,events}));
}
export async function bindPrimaryFacts(db:SupabaseClient,inputs:PrimaryFacts[]){
 const [records,previous]=await Promise.all([allFactRecords(db),readSemanticProjections(db)]);
 const byKey=new Map(inputs.map(i=>[`${i.sourceKey}:${i.sourceRecordKey}`,i]));
 const out=new Map<string,SemanticProjection>();
 for(const r of records){const input=byKey.get(`${r.source_key}:${(r as typeof r&{source_record_key:string}).source_record_key}`);if(!input)continue;
  const prior=previous.get(r.id),old=prior?.hash===r.content_hash?prior.projection.events??[]:[];
  const events=input.events.map(e=>{const existing=old.find(o=>o.event_type===e.event_type&&o.evidence_location.source_hash===e.evidence_location.source_hash&&o.evidence_location.field===e.evidence_location.field);return existing?.classification_version===e.classification_version?existing:{...e,observed_at:existing?.observed_at??e.observed_at,id:hashValue({recordId:r.id,type:e.event_type,field:e.evidence_location.field,page:e.evidence_location.page})};});
  // Preserve separately verified deep-document evidence for the same record version.
  for(const e of old.filter(e=>e.evidence_location.field==='pdf.text'))if(!events.some(v=>v.event_type===e.event_type))events.push(e);
  out.set(r.id,{version:FACT_POLICY.version,events:events.slice(0,FACT_POLICY.maxEvents),candidate:deepCandidate(r),primaryReviewed:true,status:events.length?'EXTRACTED':'NO_SUPPORTED_FACT',...(input.newsContext?{newsContext:input.newsContext}:prior?.hash===r.content_hash&&prior.projection.newsContext?{newsContext:prior.projection.newsContext}:{}),...(prior?.hash===r.content_hash&&prior.projection.deep?{deep:prior.projection.deep}:{})});
 }
 return out;
}
