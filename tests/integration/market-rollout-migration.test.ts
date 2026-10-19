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
