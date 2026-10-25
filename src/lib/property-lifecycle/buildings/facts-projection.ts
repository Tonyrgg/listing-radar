import type {SupabaseClient} from '@supabase/supabase-js';
import {cheapFacts,deepCandidate,FACT_POLICY,type FactRecord,type PropertyFact} from './property-facts';
import type {NewsSourceContext} from './news-triage';
export interface SemanticProjection {version:string;events:PropertyFact[];candidate:{priority:number;reason:string};status:'EXTRACTED'|'NO_SUPPORTED_FACT'|'REVIEW';primaryReviewed?:boolean;newsContext?:NewsSourceContext;deep?:{status:string;url?:string;reason?:string}}
export async function allFactRecords(db:SupabaseClient){
 const rows:FactRecord[]=[];for(let from=0;;from+=500){const q=await db.from('market_observer_public_records').select('id,content_hash,source_key,source_record_key,source_url,record_type,practice_type,intervention_type,record_date,source_status,document_urls,territorial_references').order('id').range(from,from+499);if(q.error)throw Error(q.error.message);rows.push(...q.data as FactRecord[]);if(q.data.length<500)break;}return rows;
}
export async function readSemanticProjections(db:SupabaseClient){
 const out=new Map<string,{hash:string|null;projection:SemanticProjection}>();for(let n=0;;n+=500){const r=await db.from('public_record_territorial_resolutions').select('record_id,semantic_input_hash,semantic_projection').order('record_id').range(n,n+499);if(r.error)throw Error(r.error.message);for(const v of r.data)out.set(v.record_id,{hash:v.semantic_input_hash,projection:v.semantic_projection});if(r.data.length<500)return out;}
}
/** No network, no commercial mutation. Preserve primary spans and original observation time on replay. */
export async function projectPropertyFacts(db:SupabaseClient,apply=false,provided?:Map<string,SemanticProjection>){
 const [records,previous]=await Promise.all([allFactRecords(db),readSemanticProjections(db)]),at=new Date().toISOString();
 const rows=records.map(r=>{const prior=previous.get(r.id);const projection=provided?.get(r.id)??(prior?.hash===r.content_hash&&['property_facts_v1',FACT_POLICY.version].includes(prior.projection.version)?structuredClone(prior.projection):{version:FACT_POLICY.version,events:cheapFacts(r,at),candidate:deepCandidate(r),status:'REVIEW' as const});if(projection.events.length)projection.status='EXTRACTED';return {recordId:r.id,inputHash:r.content_hash,projection};});
 if(apply)for(let i=0;i<rows.length;i+=100){const r=await db.rpc('project_public_record_facts',{p_records:rows.slice(i,i+100)});if(r.error)throw Error(r.error.message);}
 return {processed:rows.length,events:rows.reduce((s,r)=>s+r.projection.events.length,0),review:rows.filter(r=>r.projection.status==='REVIEW').length,rows};
}
