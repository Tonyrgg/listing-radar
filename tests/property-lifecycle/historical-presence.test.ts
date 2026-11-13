import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
import {HttpClient} from '@/lib/http/client';
import {normalizeMomentoDetail} from '@/lib/property-lifecycle/adapters/momento';
import {rehashNormalizedListing} from '@/lib/property-lifecycle/contracts/normalized-listing';
import {historicalCandidates,sameHistoricalListing,enrichHistoricalPresence} from '@/lib/property-lifecycle/adapters/historical-presence';
import type {PropertyLifecycleAdapter,SourceDocument} from '@/lib/property-lifecycle/adapters/types';
const url='https://www.trovacasa.it/annunci/ba-tc-96100-70534492';
const document:SourceDocument={item:{sourceKey:'70534492',externalId:'70534492',url,summary:{}},response:{body:readFileSync('tests/fixtures/property-lifecycle/momento-active-detail.html','utf8'),url,ok:true,status:200,headers:new Headers()},observedAt:'2026-11-13T12:00:00Z'};
const current=rehashNormalizedListing(normalizeMomentoDetail(document),row=>({...row,assets:[1,2].map(n=>({kind:'IMAGE' as const,url:`https://images.example/${n}.jpg`,canonicalUrl:`https://images.example/${n}.jpg`,sourceRecordedAt:null,dateEvidenceMethod:null,metadata:{}}))}));
it('rejects reused URLs with changed references or physical characteristics',()=>{
 expect(sameHistoricalListing(current,current)).toBe(true);
 expect(sameHistoricalListing(current,{...current,commercial:{...current.commercial,surfaceSqm:(current.commercial.surfaceSqm??100)*2}})).toBe(false);
 expect(sameHistoricalListing(current,{...current,assets:[]})).toBe(false);
});
it('bounds lookups and changes candidate selection over time',()=>{
 const items=Array.from({length:80},(_,i)=>({sourceKey:String(i)}));
 expect(historicalCandidates(items,'2026-11-13').size).toBe(5);
 expect([...historicalCandidates(items,'2026-11-13')]).not.toEqual([...historicalCandidates(items,'2026-11-14')]);
});
it('adds a distinct dated presence claim only after matching the archived body',async()=>{
 const get=vi.spyOn(HttpClient.prototype,'get').mockImplementation(async u=>u.includes('/cdx/')?{body:JSON.stringify([['timestamp','original'],['20260102120000',url]]),url:u,status:200,ok:true,headers:new Headers()}:{body:'archived html',url:u,status:200,ok:true,headers:new Headers({'content-type':'text/html'})});
 try{
 const adapter={normalize:async()=>current} as unknown as PropertyLifecycleAdapter;
 const result=await enrichHistoricalPresence(adapter,document,current);
 expect(result.marketStart.evidence.at(-1)).toMatchObject({claimKey:'publication.archivedPresence',sourceRecordedAt:'2026-01-02T12:00:00Z',metadata:{semantics:'PRESENT_BY_NOT_MANDATE_START'}});
 expect(result.source.portalPublishedAt).toBe(current.source.portalPublishedAt);
 }finally{get.mockRestore();}
});
