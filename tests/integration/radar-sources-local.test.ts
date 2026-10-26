import {randomInt} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {describe,it,expect} from 'vitest';
import {BuildingIntelligenceImporter} from '@/lib/property-lifecycle/buildings/importer';
import {PRACTICES_2025,TERRITORY_PROTOCOLS} from '@/lib/property-lifecycle/buildings/public-record-policy';
import {csvPrimaryFacts,bindPrimaryFacts} from '@/lib/property-lifecycle/buildings/facts-primary';
import {recomputeTerritorialGraph} from '@/lib/property-lifecycle/buildings/graph-recompute';
import {projectPropertyFacts} from '@/lib/property-lifecycle/buildings/facts-projection';
import {extractPropertyFacts,FACT_POLICY} from '@/lib/property-lifecycle/buildings/property-facts';
import {prepareAlboRecord} from '@/lib/property-lifecycle/buildings/albo-record';
import {reconcilePracticeDocuments} from '@/lib/property-lifecycle/buildings/practice-documents';
import {PUBLIC_RECORD_POLICY} from '@/lib/property-lifecycle/buildings/public-record-policy';

const api=process.env.PROPERTY_LIFECYCLE_TEST_SUPABASE_URL;
const key=process.env.PROPERTY_LIFECYCLE_TEST_SERVICE_ROLE_KEY;
const enabled=api==='http://127.0.0.1:55521'&&Boolean(key)&&process.env.RADAR_TEST_PROJECT==='coreimmobiliare-radar-e2e';
const local=enabled?describe.sequential:describe.skip;

local('Radar on isolated Supabase Auth/PostgREST/database',()=>{
 const db=createClient(api??'http://127.0.0.1:55521',key??'unused',{auth:{persistSession:false,autoRefreshToken:false}});

 it('persists APE and APG independently, replays without duplicates and clears unsupported index facts',async()=>{
  const number=randomInt(10000000,99999999),practice=`${number}/2025/CILA`;
  const csv=[
   'Applicazione,Numero Pratica,Oggetto,Data Protocollo,Numero Protocollo',
   `ape,${practice},Persona sintetica - frazionamento in due unità,2025-06-02,${number}`,
   `ape,${practice},Persona sintetica - frazionamento in due unità,2025-06-02,${number}`,
   `apg,${practice},Persona sintetica - cambio destinazione d uso,2025-06-03,${number+1}`,
  ].join('\n');
  const importer=new BuildingIntelligenceImporter(db);
  const input={sourceKey:PRACTICES_2025.key,sourceUrl:PRACTICES_2025.url,csv,applicationCode:null};
  const started=await db.from('building_data_import_runs').insert({source_key:PRACTICES_2025.key,source_url:PRACTICES_2025.url}).select('id').single();
  expect(started.error).toBeNull();
  const first=await importer.importCsv({...input,importRunId:started.data!.id});
  expect(first.importRunId).toBe(started.data!.id);
  expect(first).toMatchObject({inputRows:3,eligibleRows:3,groupedRecords:2,insertedRecords:2,duplicateRows:1,buildingLinks:0,eventCount:0,
   dataQuality:{applicationCounts:{ape:1,apg:1},latestProtocolDate:'2025-06-03',groupsWithAddress:0,primaryDocumentLinks:0}});
  const replay=await importer.importCsv(input);
  expect(replay).toMatchObject({insertedRecords:0,updatedRecords:0,unchangedRecords:2,eventCount:0});
  await expect(importer.importCsv({...input,importRunId:first.importRunId})).rejects.toThrow('Running source import required');
  const stored=await db.from('building_practice_records').select('id,application_code,content_hash,sanitized_payload').eq('source_key',PRACTICES_2025.key).eq('practice_number',practice);
  expect(stored.error).toBeNull();expect(stored.data).toHaveLength(2);
  expect(stored.data?.map(row=>row.application_code).sort()).toEqual(['ape','apg']);
  expect(JSON.stringify(stored.data)).not.toContain('Persona sintetica');
  const run=await db.from('building_data_import_runs').select('diagnostics').eq('id',first.importRunId).single();
  expect(run.error).toBeNull();expect(run.data?.diagnostics).toMatchObject({latestProtocolDate:'2025-06-03',primaryDocumentLinks:0});
  await recomputeTerritorialGraph(db,true);
  const record=stored.data![0];
  const oldEvents=extractPropertyFacts(record.id,{text:'frazionamento in due unità',field:'Oggetto',sourceUrl:PRACTICES_2025.url,sourceHash:'a'.repeat(64),observedAt:'2026-01-01T00:00:00Z'},'2025-06-02');
  const seeded=await db.from('public_record_territorial_resolutions').update({semantic_input_hash:record.content_hash,semantic_projection:{version:FACT_POLICY.version,events:oldEvents,candidate:{priority:80,reason:'OLD_INDEX'},status:'EXTRACTED',primaryReviewed:true}}).eq('record_id',record.id);
  expect(seeded.error).toBeNull();
  const provided=await bindPrimaryFacts(db,csvPrimaryFacts(csv,PRACTICES_2025.key,PRACTICES_2025.url,new Date().toISOString()));
  expect(provided.get(record.id)).toMatchObject({events:[],primaryReviewed:false,status:'REVIEW',candidate:{reason:'PRIMARY_DOCUMENT_REQUIRED'}});
  await projectPropertyFacts(db,true,provided);
  const facts=await db.from('public_record_territorial_resolutions').select('semantic_projection').in('record_id',stored.data!.map(row=>row.id));
  expect(facts.error).toBeNull();expect(facts.data).toHaveLength(2);
  for(const row of facts.data??[])expect(row.semantic_projection).toMatchObject({events:[],primaryReviewed:false,status:'REVIEW'});
 },60000);

 it('persists exact document matches, hides stale links and enforces private access',async()=>{
  const number=randomInt(10000000,99999999),practice=`${number}/2025/SCIA`;
  const csv=`Applicazione,Numero Pratica,Oggetto,Data Protocollo,Numero Protocollo\nape,${practice},Cambio destinazione d uso,2025-03-01,${number}`;
  await new BuildingIntelligenceImporter(db).importCsv({sourceKey:PRACTICES_2025.key,sourceUrl:PRACTICES_2025.url,csv,applicationCode:null});
  const at=new Date().toISOString(),sourceUrl=PUBLIC_RECORD_POLICY.alboUrl+'/papca/display/'+number;
  const documentUrl=PUBLIC_RECORD_POLICY.alboUrl+'?p_p_resource_id=downloadAllegato&id='+number;
  const subject=`Pratica ${practice}, prot. n. ${number} del 01/03/2025. Persona sintetica da omettere.`;
  const prepared=prepareAlboRecord({id:String(number),url:sourceUrl,registration:String(number),act:`2026/${number}`,category:'SCIA',subject,start:'2026-10-26',end:null,marker:'synthetic'},
   {subject,documentDate:'2026-10-26',actDate:'2026-10-26',start:'2026-10-26',end:null,office:null,status:'Pubblicato',documents:[documentUrl]},[],at);
  const run=await db.from('building_data_import_runs').insert({source_key:PUBLIC_RECORD_POLICY.alboSource,source_url:PUBLIC_RECORD_POLICY.alboUrl}).select('id').single();
  expect(run.error).toBeNull();
  const stored=await db.rpc('persist_public_records_atomic',{p_run_id:run.data!.id,p_source_key:PUBLIC_RECORD_POLICY.alboSource,p_observed_at:at,p_records:[prepared]});
  expect(stored.error).toBeNull();
  await reconcilePracticeDocuments(db,true);
  const matched=await db.from('market_observer_practice_document_queue').select('*').eq('practice_number',practice).single();
  expect(matched.error).toBeNull();expect(matched.data).toMatchObject({search_state:'LINKED',document_urls:[documentUrl]});
  const firstSignature=await db.from('building_practice_document_search').select('signature_hash').eq('index_record_id',matched.data!.index_record_id).single();
  await reconcilePracticeDocuments(db,true);
  const replaySignature=await db.from('building_practice_document_search').select('signature_hash').eq('index_record_id',matched.data!.index_record_id).single();
  expect(replaySignature.data).toEqual(firstSignature.data);
  const primary=await db.from('building_practice_records').select('sanitized_payload').eq('id',matched.data!.primary_record_id).single();
  expect(JSON.stringify(primary.data)).not.toContain('Persona sintetica');
  const changed=await db.from('building_practice_records').update({content_hash:'changed-'+number}).eq('id',matched.data!.primary_record_id);
  expect(changed.error).toBeNull();
  const stale=await db.from('market_observer_practice_document_queue').select('search_state,document_urls,primary_record_id').eq('index_record_id',matched.data!.index_record_id).single();
  expect(stale.data).toEqual({search_state:'STALE',document_urls:[],primary_record_id:null});
  const anonKey=process.env.PROPERTY_LIFECYCLE_TEST_ANON_KEY!;
  const anonymous=createClient(api!,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const denied=await anonymous.from('market_observer_practice_document_queue').select('index_record_id').limit(1);
  expect(denied.error).not.toBeNull();
  const email=`radar-${number}@example.test`,password=`Synthetic-${number}-Password!`;
  const user=await db.auth.admin.createUser({email,password,email_confirm:true});expect(user.error).toBeNull();
  try{
   const signed=await anonymous.auth.signInWithPassword({email,password});expect(signed.error).toBeNull();
   const allowed=await anonymous.from('market_observer_practice_document_queue').select('index_record_id').eq('index_record_id',matched.data!.index_record_id);
   expect(allowed.error).toBeNull();expect(allowed.data).toHaveLength(1);
  }finally{await db.auth.admin.deleteUser(user.data.user!.id);}
  await new BuildingIntelligenceImporter(db).importCsv({sourceKey:TERRITORY_PROTOCOLS.key,sourceUrl:TERRITORY_PROTOCOLS.url,csv,applicationCode:null});
  await reconcilePracticeDocuments(db,true);
  const deduplicated=await db.from('market_observer_practice_document_queue').select('source_key,search_topics').eq('practice_number',practice);
  expect(deduplicated.error).toBeNull();
  expect(deduplicated.data).toEqual([{source_key:TERRITORY_PROTOCOLS.key,search_topics:['USE_CHANGE']}]);
  await new BuildingIntelligenceImporter(db).importCsv({sourceKey:TERRITORY_PROTOCOLS.key,sourceUrl:TERRITORY_PROTOCOLS.url,csv:csv.replace('Cambio destinazione d uso','Frazionamento in due unità'),applicationCode:null});
  const conflicting=await db.from('market_observer_practice_document_queue').select('source_key,search_topics').eq('practice_number',practice);
  expect(conflicting.error).toBeNull();expect(conflicting.data).toHaveLength(2);
  const land=`${number+2}/2026/CDU`,judicial=`${number+3}/2026/SCIA`;
  const extra=`Applicazione,Numero Pratica,Oggetto,Data Protocollo,Numero Protocollo\napg,${land},Terreno da non edificabile a edificabile,2026-09-16,${number+2}\napg,${judicial},Esecuzione immobiliare con frazionamento,2026-09-16,${number+3}`;
  await new BuildingIntelligenceImporter(db).importCsv({sourceKey:TERRITORY_PROTOCOLS.key,sourceUrl:TERRITORY_PROTOCOLS.url,csv:extra,applicationCode:null});
  const landQueue=await db.from('market_observer_practice_document_queue').select('practice_number,search_topics').eq('practice_number',land).overlaps('search_topics',['BUILDABILITY_MENTION']);
  expect(landQueue.error).toBeNull();expect(landQueue.data).toHaveLength(1);
  const excluded=await db.from('market_observer_practice_document_queue').select('index_record_id').eq('practice_number',judicial);
  expect(excluded.error).toBeNull();expect(excluded.data).toEqual([]);
 },60000);
});
