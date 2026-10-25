import {describe,it,expect,vi} from 'vitest';
import {extractPropertyFacts,FACT_POLICY} from '@/lib/property-lifecycle/buildings/property-facts';
import {projectPropertyFacts,type SemanticProjection} from '@/lib/property-lifecycle/buildings/facts-projection';
import {bindPrimaryFacts} from '@/lib/property-lifecycle/buildings/facts-primary';

const at='2026-01-05T10:00:00Z';
const evidence={text:'cambio destinazione d’uso',field:'Oggetto',sourceUrl:'https://www.comune.bitonto.ba.it/test',sourceHash:'a'.repeat(64),observedAt:at};
function setup(){
 const old={...extractPropertyFacts('record',evidence,'2026-01-01')[0],classification_version:'property_facts_v1'};
 const pdf={...extractPropertyFacts('record',{...evidence,text:'Oggetto: divisione in due unità',field:'pdf.text',page:1,sourceHash:'b'.repeat(64)},'2026-01-01')[0],classification_version:'property_facts_v1'};
 const projection:SemanticProjection={version:'property_facts_v1',events:[old,pdf],candidate:{priority:80,reason:'PRIMARY'},status:'EXTRACTED',primaryReviewed:true};
 const record={id:'record',source_key:'source',source_record_key:'key',content_hash:'record-hash',source_url:evidence.sourceUrl,record_type:'SCIA',record_date:'2026-01-01'};
 const rpc=vi.fn().mockResolvedValue({error:null});
 const db={from(table:string){const query={select:()=>query,order:()=>query,range:async()=>({error:null,data:table==='market_observer_public_records'?[record]:[{record_id:'record',semantic_input_hash:'record-hash',semantic_projection:projection}]})};return query;},rpc};
 return{db,record,projection,old,pdf};
}
describe('versioned primary facts preserve historical evidence',()=>{
 it('a policy upgrade without fresh primary evidence keeps the complete V1 projection and its observation dates',async()=>{
  const{db,projection}=setup(),before=structuredClone(projection);
  const result=await projectPropertyFacts(db as never,false);
  expect(result.rows[0].projection).toEqual(before);
  expect(projection).toEqual(before);
 });
 it('fresh V2 evidence improves the transition without refreshing its original observation or deleting separately verified PDF facts',async()=>{
  const{db,pdf}=setup();
  const events=extractPropertyFacts('key',{...evidence,text:'cambio destinazione d’uso da uso ufficio ad uso abitativo',observedAt:'2026-10-25T12:00:00Z'},'2026-01-01');
  const projections=await bindPrimaryFacts(db as never,[{sourceKey:'source',sourceRecordKey:'key',events}]);
  const result=projections.get('record')!;
  expect(result.version).toBe(FACT_POLICY.version);
  expect(result.events.find(f=>f.event_type==='CAMBIO_DESTINAZIONE_USO')).toMatchObject({from_use:'OFFICE',to_use:'RESIDENTIAL',classification_version:'property_facts_v2',observed_at:at});
  expect(result.events.find(f=>f.event_type==='FRAZIONAMENTO')).toEqual(pdf);
 });
 it('a changed document hash cannot reuse an old semantic assertion',async()=>{
  const{db,record}=setup();record.content_hash='different-hash';
  const result=await projectPropertyFacts(db as never,false);
  expect(result.rows[0].projection).toMatchObject({version:FACT_POLICY.version,events:[],status:'REVIEW'});
 });
});
