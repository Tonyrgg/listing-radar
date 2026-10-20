import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {parseExternalHtml} from '@/lib/property-lifecycle/external/adapters';
import manifest from '../fixtures/property-lifecycle/external/remax/manifest.json';

describe.sequential('Controlled market rollout on PostgreSQL',()=>{
 let db:PGlite;
 const sql=async(file:string)=>(await readFile('supabase/migrations/'+file,'utf8')).replace(/^begin;\r?$/gm,'').replace(/^commit;\r?$/gm,'');
 beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key);create schema extensions;
   create function extensions.digest(text,text)returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;`);
  for(const file of ['0001_production_schema.sql','0010_acquisition_os.sql','0014_market_observer_reliability.sql',
   '0015_market_observer_intelligence.sql','0016_market_observer_private_projection.sql','0017_resource_compaction.sql',
   '0018_compaction_index_headroom.sql','0019_bounded_identity_fingerprints.sql','0020_fingerprint_update_uniqueness.sql',
   '0021_market_observer_read_indexes.sql','0022_market_observer_semantics.sql','0023_market_observer_projections.sql',
   '0024_external_market_evidence.sql','0025_external_market_projections.sql','0026_external_market_primary_verifier.sql']){
    await db.exec((await readFile('supabase/migrations/'+file,'utf8')).replace(/create extension if not exists pgcrypto;/g,''));
   }
  await db.exec(`insert into agencies(slug,name,adapter_key,website_url,inventory_url,market_role,settings) values
   ('ad-maiora-bitonto','Human confirmed','test','https://agency.test','https://agency.test','OUR_AGENCY','{"humanValue":true}'),
   ('futura-immobiliare-bitonto','Futura','test-futura','https://futura.test','https://futura.test','UNKNOWN','{"requestDelayMs":1700}');`);
  await db.exec(await sql('0028_bitonto_market_agency_registry.sql'));
  await db.exec(await sql('0033_confirm_specific_own_agency_branch.sql'));
  await db.exec(await sql('0031_restore_bounded_observation_fingerprints.sql'));
 },30000);
 beforeEach(async()=>{await db.exec('begin');});
 afterEach(async()=>{await db.exec('rollback');});
 afterAll(async()=>{await db?.close();});
 async function row(query:string,args:unknown[]=[]){return (await db.query<Record<string,unknown>>(query,args)).rows[0];}
 it('persists public territorial records atomically, deduplicates observations, preserves history and building versus unit semantics',async()=>{
  await db.exec((await sql('0006_bitonto_street_registry.sql')).replace(/create extension if not exists pgcrypto;/g,''));
  await db.exec(await sql('0034_intelligence_archive_public_records.sql'));
  await db.exec(await sql('0035_public_records_territorial_intelligence.sql'));
  await db.exec(await sql('0036_public_records_context_indexes.sql'));
  await db.exec(await sql('0037_public_records_street_aggregation.sql'));
  await db.exec(await sql('0038_territorial_knowledge_graph.sql'));
  await db.exec(await sql('0039_territorial_context_timeline.sql'));
  await db.exec(await sql('0040_historical_public_records.sql'));
  await db.exec(await sql('0041_historical_projection_guard.sql'));
  const loc=(await row("insert into locations(raw_text,municipality,locality,street_name,street_number,scope_state,resolution_method,resolution_confidence,precision_level,normalized_key) values('Piazza Cattedrale 23','Bitonto','Bitonto','Piazza Cattedrale','23','IN_SCOPE','TEST',1,'EXACT_ADDRESS','piazza-test') returning id")).id;
  const b=(await row("insert into buildings(location_id,normalized_key,display_name) values($1,'it|ba|bitonto|bitonto|piazza cattedrale|23','Piazza Cattedrale 23') returning id",[loc])).id;
  await db.exec(`insert into properties(primary_location_id,canonical_attributes) values('${loc}','{"address":"Piazza Cattedrale 23"}');`);
  const run=(await row("insert into building_data_import_runs(source_key) values('comune-bitonto-albo') returning id")).id;
  const record={sourceRecordKey:'golden-record',contentHash:'hash1',practiceNumber:'3/2024/SCA',year:'2024',title:'Agibilità · 3/2024/SCA',recordType:'AGIBILITY_SIGNAL',documentDate:'2024-01-09',
   sourceUrl:'https://bitonto.trasparenza-valutazione-merito.it/web/trasparenza/albo-pretorio/-/papca/display/123',classificationConfidence:.95,
   sanitizedPayload:{addresses:[{normalizedKey:'it|ba|bitonto|bitonto|piazza cattedrale|23',displayName:'Piazza Cattedrale 23',streetName:'Piazza Cattedrale',streetNumber:'23'}],cadastralReferences:[{sheet:'49',parcel:'1485',subaltern:'22'}]},metadata:{unitMatch:'REVIEW_REQUIRED'}};
  const persist=async(at:string,r=record)=>row('select persist_public_records_atomic($1,$2,$3,$4) result',[run,'comune-bitonto-albo',at,JSON.stringify([r])]);
  expect((await persist('2026-10-19T10:00:00Z')).result).toMatchObject({inserted:1,updated:0,links:1});
  await persist('2026-10-19T11:00:00Z');
  expect((await row('select count(*)::int n from building_practice_observations')).n).toBe(1);
  expect((await row('select first_seen_at<last_seen_at advanced from building_practice_records')).advanced).toBe(true);
  expect(await row('select relation_scope,unit_match,building_id from market_observer_public_record_property_links')).toEqual({relation_scope:'BUILDING',unit_match:'REVIEW_REQUIRED',building_id:b});
  expect((await row('select count(*)::int n from properties')).n).toBe(1);
  expect((await row('select count(*)::int n from acquisition_leads')).n).toBe(0);
  expect((await row('select recent_public_record_count from market_observer_property_public_record_summary')).recent_public_record_count).toBe(0);
  await persist('2026-10-19T12:00:00Z',{...record,contentHash:'hash2',title:'Agibilità · metadata aggiornati'});
  expect((await row('select count(*)::int n from building_practice_observations')).n).toBe(2);
  expect((await row('select published_at from market_observer_public_records')).published_at).toBeNull();
  await db.exec('savepoint invalid_public_record');
  await expect(persist('2026-10-19T13:00:00Z',{...record,contentHash:'broken',classificationConfidence:2})).rejects.toThrow();
  await db.exec('rollback to savepoint invalid_public_record');
  expect((await row('select content_hash from building_practice_records')).content_hash).toBe('hash2');
  expect(await row('select specific_record_count,building_record_count,unit_match from market_observer_graph_property_context')).toEqual({specific_record_count:0,building_record_count:1,unit_match:'REVIEW_REQUIRED'});
  expect((await row("select count(*)::int n from read_territorial_timeline('BUILDING',$1,30,0) where event_kind='PUBLIC_RECORD'",[b])).n).toBe(1);
  expect((await row("select has_function_privilege('anon','read_territorial_timeline(text,uuid,integer,integer)','execute') allowed")).allowed).toBe(false);
  expect((await row("select territorial_activity(0,0,0,0,0) a")).a).toMatchObject({score:0,version:'territorial_activity_v1'});
  const sid=(await row("insert into street_registry_streets(official_code,official_description,canonical_name,normalized_name,sister_search_name) values('golden-street','CATTEDRALE','Piazza Cattedrale','PIAZZA CATTEDRALE','CATTEDRALE') returning id")).id;
  const graphLocation={id:loc,streetId:sid,civic:'23',status:'RESOLVED',version:'territorial_graph_v1'};
  const rid=(await row("select id from building_practice_records where source_record_key='golden-record'")).id;
  const graphRecord={id:rid,inputHash:'hash2',version:'territorial_graph_v1',references:[{streetId:sid,streetName:'Piazza Cattedrale',civics:['23'],civicState:'EXPLICIT',candidateStreetIds:[sid]}],candidateBuildingIds:[b],unmatchedCause:null};
  const reconcile=()=>row('select recompute_territorial_graph($1,$2) result',[JSON.stringify([graphLocation]),JSON.stringify([graphRecord])]);
  expect((await reconcile()).result).toMatchObject({recordsProcessed:1,newBuildingLinks:0});
  const evaluated=(await row('select evaluated_at from public_record_territorial_resolutions')).evaluated_at;
  await reconcile();expect((await row('select evaluated_at from public_record_territorial_resolutions')).evaluated_at).toEqual(evaluated);
  expect((await row('select count(*)::int n from building_practice_observations')).n).toBe(2);
  expect((await row('select street_record_count from market_observer_graph_property_context')).street_record_count).toBe(1);
  expect((await row('select public_record_count from market_observer_graph_street_context where street_id=$1',[sid])).public_record_count).toBe(1);
  expect((await row("select count(*)::int n from read_territorial_timeline('STREET',$1,30,0) where event_kind='PUBLIC_RECORD'",[sid])).n).toBe(1);
  await db.exec("update building_practice_records set document_date=current_date,source_status='REVOKED' where id='"+rid+"'");
  expect(await row('select recent30,recent90 from market_observer_graph_record_facts')).toMatchObject({recent30:false,recent90:false});
  await db.exec("update building_practice_records set source_status='Revocato' where id='"+rid+"'");
  expect(await row('select recent30,recent90 from market_observer_graph_record_facts')).toMatchObject({recent30:false,recent90:false});
  expect((await row('select count(*)::int n from market_observer_building_duplicate_candidates')).n).toBe(0);
  await db.exec(`insert into buildings(location_id,normalized_key,display_name) values('${loc}','legacy-duplicate','Piazza Cattedrale 23, variante');`);
  expect((await row('select classification from market_observer_building_duplicate_candidates')).classification).toBe('PROBABLE_SAME_BUILDING');
  expect((await row('select count(*)::int n from buildings')).n).toBe(2); // Candidate only: no destructive merge.
  const token='10000000-0000-4000-8000-000000000001';
  const history=await row('select claim_public_record_history(2022,$1) result',[token]);
  const historyRun=history.result.id;
  await db.exec('savepoint lease_reject');
  await expect(db.query('select claim_public_record_history(2023,$1)',['10000000-0000-4000-8000-000000000002'])).rejects.toThrow('already leased');
  await db.exec('rollback to lease_reject');
  const liveBefore=await row("select count(*)::int n from building_data_import_runs where run_kind='LIVE'");
  await db.query("select commit_public_record_history($1,$2,'[]','{}','{\"done\":[\"official-id\"]}','{\"scanned\":50,\"inventoryComplete\":true}',true,null)",[historyRun,token]);
  expect((await row('select checkpoint from building_data_import_runs where id=$1',[historyRun])).checkpoint.done).toEqual(['official-id']);
  expect((await row("select count(*)::int n from building_data_import_runs where run_kind='LIVE'")).n).toBe(liveBefore.n);
  expect((await row('select count(*)::int n from market_observer_territorial_history where historical_record_density>0')).n).toBeGreaterThan(0);
  const resumed=await row('select claim_public_record_history(2022,$1) result',[token]);
  expect(resumed.result.id).toBe(historyRun);expect(resumed.result.checkpoint.done).toEqual(['official-id']);
  await db.query("select commit_public_record_history($1,$2,'[]','{}','{}','{}',false,'HTTP 403')",[historyRun,token]);
  expect((await row('select status from building_data_import_runs where id=$1',[historyRun])).status).toBe('FAILED');
  await row('select claim_public_record_history(2022,$1) result',[token]);
  const historical={...record,sourceRecordKey:'historical-2022',contentHash:'history-2022',documentDate:'2022-05-10',year:'2022'};
  const activityBefore=(await row('select activity from market_observer_graph_street_context where street_id=$1',[sid])).activity;
  const historyPersist=()=>row("select commit_public_record_history($1,$2,$3,'{}','{}','{}') result",[historyRun,token,JSON.stringify([historical])]);
  const originalDensity=(await row("select historical_record_density from market_observer_territorial_history where scope='BUILDING' and id=$1",[b])).historical_record_density;
  expect((await historyPersist()).result).toMatchObject({inserted:1,updated:0});
  expect((await row("select historical_record_density from market_observer_territorial_history where scope='BUILDING' and id=$1",[b])).historical_record_density).toBe(Number(originalDensity)+1);
  expect((await row("select count(*)::int n from market_observer_graph_record_streets s join building_practice_records r on r.id=s.record_id where r.source_record_key='historical-2022'")).n).toBe(0); // No legacy fallback before conservative projection.

  const densityBefore=(await row('select historical_record_density from market_observer_territorial_history where scope=\'BUILDING\' and id=$1',[b])).historical_record_density;
  expect((await historyPersist()).result).toMatchObject({inserted:0,updated:0});
  expect((await row("select count(*)::int n from building_practice_observations o join building_practice_records r on r.id=o.practice_record_id where r.source_record_key='historical-2022'")).n).toBe(1);
  expect((await row("select recent90 from market_observer_graph_record_facts where source_record_key='historical-2022'")).recent90).toBe(false);
  expect((await row('select activity from market_observer_graph_street_context where street_id=$1',[sid])).activity).toEqual(activityBefore);
  expect((await row('select historical_record_density from market_observer_territorial_history where scope=\'BUILDING\' and id=$1',[b])).historical_record_density).toBe(densityBefore);
  expect((await row("select count(*)::int n from read_territorial_timeline('BUILDING',$1,100,0) where event_kind='PUBLIC_RECORD' and event_at::date='2022-05-10'",[b])).n).toBe(1);
  await db.exec("create function auth.uid() returns uuid language sql as $$select '10000000-0000-4000-8000-000000000099'::uuid$$");
  await db.query("select review_public_record_street($1,0,'hash2','UNKNOWN',null)",[rid]);
  expect((await row('select human_overrides from public_record_territorial_resolutions where record_id=$1',[rid])).human_overrides['0'].decision).toBe('UNKNOWN');
  await db.query("select review_public_record_street($1,0,'hash2','SAME_STREET',$2)",[rid,sid]);
  expect((await row('select references_json from public_record_territorial_resolutions where record_id=$1',[rid])).references_json[0].streetId).toBe(sid);
  await db.query("select review_public_record_street($1,0,'hash2','DIFFERENT',null)",[rid]);
  expect((await row('select references_json from public_record_territorial_resolutions where record_id=$1',[rid])).references_json[0].streetId).toBeNull();
  expect((await row('select jsonb_array_length(review_history)::int n from public_record_territorial_resolutions where record_id=$1',[rid])).n).toBe(3);
  expect((await row("select has_function_privilege('anon','review_public_record_street(uuid,integer,text,text,uuid)','execute') allowed")).allowed).toBe(false);

  await db.exec('savepoint stale_review');
  await expect(db.query("select review_public_record_street($1,0,'old-hash','SAME_STREET',$2)",[rid,sid])).rejects.toThrow('Stale');
  await db.exec('rollback to stale_review');


 });
 it('projects the complete property archive and municipal register without creating leads or inferring unit/document dates',async()=>{
  await db.exec(await sql('0034_intelligence_archive_public_records.sql'));
  await db.exec(`insert into properties(property_type,canonical_attributes) values
    ('Appartamento','{"address":"Via Test 2","surfaceSqm":80,"rooms":3}'),
    ('Villa','{"address":"Contrada senza annuncio"}');
    insert into building_practice_records(source_key,source_record_key,application_code,practice_type,intervention_type,occurred_at,content_hash,sanitized_payload)
    values('municipal','scia-1','ape','SCIA - Segnalazione','OTHER','2024-01-01','hash','{"addresses":[]}');`);
  expect((await row('select count(*)::integer n from market_observer_property_archive')).n).toBe(2);
  expect(await row("select surface_sqm,rooms,publication_count from market_observer_property_archive where address='Via Test 2'"))
    .toEqual({surface_sqm:'80',rooms:'3',publication_count:0});
  expect(await row('select record_type,published_at,document_date,building_ids from market_observer_public_records'))
    .toEqual({record_type:'SCIA',published_at:null,document_date:null,building_ids:[]});
  expect((await row('select count(*)::integer n from acquisition_leads')).n).toBe(0);
  expect((await row("select has_table_privilege('anon','market_observer_property_archive','select') allowed")).allowed).toBe(false);
  const assessment=await row("select market_observer_assess_opportunity('UNKNOWN','OFF_MARKET_NO_SALE_EVIDENCE',180,0,0,0) assessment");
  expect(assessment.assessment).toMatchObject({score:55,components:{unsold_exit:25,observed_age:30}});
 });
 it('keeps one archive row and selects the active relationship ahead of a more recently updated closed relationship',async()=>{
  await db.exec(await sql('0034_intelligence_archive_public_records.sql'));
  await db.exec(`insert into properties(canonical_attributes) values('{"address":"Via Due Agenzie 1"}');
    insert into agency_listings(property_id,agency_id,state,last_seen_at)
    select p.id,a.id,case when a.slug='ad-maiora-bitonto' then 'ACTIVE' else 'OFF_MARKET_NO_SALE_EVIDENCE' end,
      case when a.slug='ad-maiora-bitonto' then '2026-10-01'::timestamptz else '2026-10-19'::timestamptz end
    from properties p cross join agencies a where a.slug in ('ad-maiora-bitonto','futura-immobiliare-bitonto');`);
  expect((await row('select count(*)::integer n from market_observer_intelligence')).n).toBe(2);
  expect((await row('select count(*)::integer n from market_observer_property_archive')).n).toBe(1);
  expect(await row('select agency_role,state from market_observer_property_archive')).toEqual({agency_role:'OUR_AGENCY',state:'ACTIVE'});
 });
 it('preserves human agency decisions, maps the specific own branch and rejects shared RE/MAX IDs',async()=>{
  expect(await row("select market_role,settings from agencies where slug='ad-maiora-bitonto'"))
   .toEqual({market_role:'OUR_AGENCY',settings:{humanValue:true}});
  expect((await row("select settings->>'requestDelayMs' delay from agencies where slug='futura-immobiliare-bitonto'")).delay).toBe('1700');
  expect((await row("select market_role from agencies where slug='tecnocasa-bitonto-matteotti'")).market_role).toBe('OUR_AGENCY');
  expect((await row("select settings->'marketObserverRegistry'->'humanConfirmed' confirmed from agencies where slug='tecnocasa-bitonto-matteotti'")).confirmed).toBe(true);
  expect(await row("select external_agency_id,normalized_name from market_observer_agency_identities where source_key='REMAX'"))
   .toEqual({external_agency_id:null,normalized_name:'remax stella polare - bari via caduti del lavoro'});
  expect((await row("select bool_and(not enabled and not missing_enabled) safe from market_observer_sources")).safe).toBe(true);
  expect((await row("select has_table_privilege('anon','market_observer_agent_observed_portfolio','select') allowed")).allowed).toBe(false);
 });
 it('refuses projection activation without a completed healthy verifier run',async()=>{
  await db.exec(await sql('0029_remax_known_publication_observation_rollout.sql'));
  await expect(db.exec(await sql('0030_remax_verified_projection_rollout.sql'))).rejects.toThrow('Healthy known-publication verifier run required');
 });
 it('stages interpretation and retains historical cross-source claims without changing presence, acquisition or price events',async()=>{
  await db.exec(await sql('0029_remax_known_publication_observation_rollout.sql'));
  const agency=(await row("select id from agencies where slug='remax-stella-polare-caduti'")).id;
  const o=parseExternalHtml('REMAX',await readFile('tests/fixtures/property-lifecycle/external/remax/crocifisso.html','utf8'),manifest[0].url,manifest[0].observedAt);
  const observe=async()=>row("select persist_market_external_observation_atomic('REMAX',$1,$2,$3,$4) result",[
   agency,JSON.stringify(o.listing),JSON.stringify({outcome:'NEW_PROPERTY',score:0,candidates:[]}),JSON.stringify(o.claims)]);
  await observe();
  expect((await row('select portal_published_at from publications')).portal_published_at).toBeNull();
  await db.exec("insert into market_observer_source_runs(source_key,state,finished_at,detail_fetch_count) values('REMAX','HEALTHY',now(),1)");
  await db.exec(await sql('0030_remax_verified_projection_rollout.sql'));
  o.listing.observedAt='2026-10-19T17:00:00.000Z';
  o.claims=o.claims.map(c=>({...c,observedAt:o.listing.observedAt}));
  await observe();
  const firstSeen=(await row('select first_seen_at from properties')).first_seen_at;
  await db.exec(await sql('0032_crocifisso_retained_historical_evidence.sql'));
  const count=(await row('select count(*)::integer n from evidence')).n;
  await db.exec(await sql('0032_crocifisso_retained_historical_evidence.sql'));
  expect((await row('select count(*)::integer n from evidence')).n).toBe(count);
  expect((await row('select first_seen_at from properties')).first_seen_at).toEqual(firstSeen);
  expect((await row('select estimated_acquisition_at from agency_listings')).estimated_acquisition_at).toBeNull();
  expect((await row('select count(*)::integer n from properties')).n).toBe(1);
  expect((await row('select count(*)::integer n from publications')).n).toBe(1);
  expect((await row("select count(*)::integer n from events where event_type in ('PRICE_DROP','PUBLICATION_RELAUNCHED')")).n).toBe(0);
  expect((await row("select count(*)::integer n from evidence where publication_id is null and metadata->>'historicalCaptureOnly'='true'")).n).toBe(13);
  expect((await row("select bool_and(not enabled and not projections_enabled and not missing_enabled) safe from market_observer_sources where source_key<>'REMAX'")).safe).toBe(true);
  expect(await row('select latest_asking_price,drop_count,estimated_acquisition_at from market_observer_intelligence'))
   .toEqual({latest_asking_price:155000,drop_count:0,estimated_acquisition_at:null});
 });
});
