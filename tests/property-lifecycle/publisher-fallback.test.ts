import{readFileSync}from'node:fs';import{it,expect,vi}from'vitest';
import{HttpClient}from'@/lib/http/client';import{StudioCasaAdapter,STUDIO_CASA_INVENTORY_URL}from'@/lib/property-lifecycle/adapters/studiocasa';
import{parseMomentoInventoryHtml,normalizeMomentoDetail}from'@/lib/property-lifecycle/adapters/momento';
import{rehashNormalizedListing}from'@/lib/property-lifecycle/contracts/normalized-listing';
import{PropertyLifecycleRepository}from'@/lib/property-lifecycle/persistence/repository';import{runAgencySync}from'@/lib/property-lifecycle/sync/engine';
import type{SupabaseClient}from'@supabase/supabase-js';
const fixture=(name:string)=>readFileSync('tests/fixtures/property-lifecycle/'+name,'utf8');
const path='/agenzie-immobiliari/studio-casa-bitonto-tc-91918';
const remap=(html:string)=>html.replaceAll('momento-casa-bitonto-tc-96100','studio-casa-bitonto-tc-91918').replaceAll('96100','91918').replace(/momento casa/gi,'Studio Casa Bitonto');
const response=(body:string,url:string,status=200)=>({body,url,status,ok:status===200,headers:new Headers()});
function listing(){const id='70534492',url='https://www.trovacasa.it/annunci/ba-tc-96100-'+id;return rehashNormalizedListing(normalizeMomentoDetail({item:{externalId:id,sourceKey:id,url,summary:{}},response:response(fixture('momento-active-detail.html'),url),observedAt:'2026-11-10T12:00:00Z'}),l=>({...l,provenance:{...l.provenance,accessFallback:true}}));}
it('uses the verified publisher catalog after 403 and never authorizes primary absence',async()=>{
 const http=new HttpClient({retries:0});const get=vi.spyOn(http,'get').mockImplementation(async url=>{
  if(url===STUDIO_CASA_INVENTORY_URL)return response('Denied',url,403);
  if(url.endsWith('/annunci'))return response(`<h1>Studio Casa Bitonto</h1><div class="agenziaAnnunci__card"><a href="${path}">publisher</a></div><a href="${path}/case-in-vendita">Case in Vendita (4)</a><a href="https://outside.test/case-in-vendita">ignore (4)</a>`,url);
  return response(remap(fixture('momento-inventory.html')),url);
 });
 const result=await new StudioCasaAdapter(http).fetchInventory();expect(result).toMatchObject({healthState:'HEALTHY',complete:true,absenceAuthoritative:false});expect(result.items).toHaveLength(4);expect(result.items[0].sourceKey).toMatch(/^trovacasa\.it:/);expect(get.mock.calls.every(([u])=>!u.includes('outside.test'))).toBe(true);
});
it('accepts the observed A gallery family while continuing to reject other publishers',()=>{
 const raw=fixture('momento-inventory.html').replaceAll('X_96100_','A_96100_');expect(parseMomentoInventoryHtml(raw).complete).toBe(true);
 expect(parseMomentoInventoryHtml(raw.replace('A_96100_70534497_1877995969','A_99999_70534497_1877995969')).complete).toBe(false);
});
it('keeps an identified partial catalog degraded and an empty catalog failed',async()=>{
 const http=new HttpClient({retries:0});
 const get=vi.spyOn(http,'get').mockImplementation(async url=>{
  if(url===STUDIO_CASA_INVENTORY_URL)return response('Denied',url,403);
  if(url.endsWith('/annunci'))return response(`<h1>Studio Casa Bitonto</h1><div class="agenziaAnnunci__card"><a href="${path}">publisher</a></div><a href="${path}/case-in-vendita">Case in Vendita (5)</a>`,url);
  return response(remap(fixture('momento-inventory.html')),url);
 });
 const partial=await new StudioCasaAdapter(http).fetchInventory();
 expect(partial).toMatchObject({healthState:'DEGRADED',complete:false,absenceAuthoritative:false});
 expect(partial.items).toHaveLength(4);
 get.mockImplementation(async url=>response('Unavailable',url,403));
 expect(await new StudioCasaAdapter(http).fetchInventory()).toMatchObject({healthState:'FAILED',complete:false,items:[]});
});
it('defers an unconfirmed secondary identity without creating a property or reopening a resolved review',async()=>{
 const upsert=vi.fn().mockResolvedValue({error:null}),rpc=vi.fn();
 const db={from:(table:string)=>table==='agencies'?{select:()=>({eq:()=>({single:async()=>({data:{inventory_url:'https://primary.example/list'},error:null})})})}:{upsert},rpc}as unknown as SupabaseClient;
 const repo=new PropertyLifecycleRepository(db);
 vi.spyOn(repo as unknown as{publicationBySource:()=>Promise<null>},'publicationBySource').mockResolvedValue(null);
 vi.spyOn(repo as unknown as{identityCandidates:()=>Promise<[]>},'identityCandidates').mockResolvedValue([]);
 const result=await repo.persistObservation('agency','run',listing());expect(result).toMatchObject({deferred:true,createdProperty:false,createdPublication:false,propertyId:null});expect(rpc).not.toHaveBeenCalled();expect(upsert.mock.calls[0][0]).not.toHaveProperty('status');expect(upsert.mock.calls[0][0].details.reason).toBe('SECONDARY_PUBLISHER_IDENTITY_UNCONFIRMED');
});
it('never applies missing observations for a healthy secondary catalog and records pending identities separately',async()=>{
 const value=listing(),item={sourceKey:value.source.sourceKey,externalId:value.source.externalId!,url:value.source.canonicalUrl,summary:{}};
 const missing=vi.fn(),finalize=vi.fn().mockResolvedValue(undefined),assets=vi.fn().mockResolvedValue({assets:[],warnings:[]});
 const repo={getAgencyBySlug:async()=>({id:'agency',slug:'momento-casa-bitonto',adapter_key:'momento',settings:{}}),createSyncRun:async()=>'run',closeSettledGeographyReview:vi.fn(),persistObservation:async()=>({deferred:true,createdPublication:false,createdProperty:false}),recordAdapterHealth:async()=>({effectiveState:'HEALTHY',inventoryComplete:true,absenceEvaluationAllowed:true}),finalizeSyncRun:finalize,applyMissingObservations:missing}as unknown as PropertyLifecycleRepository;
 const result=await runAgencySync({repository:repo,mode:'SYNC',assetProcessor:assets,adapter:{key:'momento',agencySlug:'momento-casa-bitonto',inventoryUrl:'https://secondary.example',fetchInventory:async()=>({items:[item],healthState:'HEALTHY',complete:true,absenceAuthoritative:false,structureFingerprint:'f',diagnostics:{expectedCount:1,observedCount:1,duplicateCount:0,parseErrorCount:0,pagesVisited:1,expectedPages:1,requiredMarkers:{valid:true},reasons:[]},response:null}),fetchDetail:async()=>({item,response:response('',item.url),observedAt:value.observedAt}),normalize:async()=>value,healthCheck:vi.fn()}});
 expect(result.absenceEvaluationAllowed).toBe(false);expect(missing).not.toHaveBeenCalled();expect(assets).toHaveBeenCalled();expect(finalize.mock.calls[0][0].diagnostics.deferredIdentityCount).toBe(1);
});
