import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {parseBitontoPlanCatalog,importBitontoPlanCatalog} from '@/lib/property-lifecycle/buildings/document-catalog';
import {hasPublicAccessChallenge} from '@/lib/property-lifecycle/external/http';
import {territoryCategory} from '@/lib/property-lifecycle/read-models/territory';
import {StudiSantiAdapter} from '@/lib/property-lifecycle/adapters/studisanti';
import {HttpClient} from '@/lib/http/client';
const html=readFileSync('tests/fixtures/property-lifecycle/municipal/bitonto-prg.html','utf8');
describe('Real Bitonto public document catalog',()=>{
 it('preserves the 22 original PDF URLs and separates locality context, without inventing dates or unit matches',()=>{
  const docs=parseBitontoPlanCatalog(html);
  expect(docs).toHaveLength(22);expect(docs.filter(d=>d.area==='Palombaio')).toHaveLength(2);
  expect(docs.filter(d=>d.area==='Mariotto')).toHaveLength(2);
  expect(docs.every(d=>d.url.startsWith('https://municipium-images-production.s3-eu-west-1.amazonaws.com/'))).toBe(true);
  expect(docs[0]).not.toHaveProperty('publishedAt');expect(docs[0]).not.toHaveProperty('propertyId');
 });
 it('deduplicates document links and refuses changed or off-host catalogs',()=>{
  expect(parseBitontoPlanCatalog(html+html)).toHaveLength(22);
  expect(()=>parseBitontoPlanCatalog('<main>No documents</main>')).toThrow('structure/count');
  expect(()=>parseBitontoPlanCatalog(html.replace('municipium-images-production.s3-eu-west-1.amazonaws.com','unapproved.test'))).toThrow('host');
 });
 it('records a source failure and never ingests a catalog from a denied page',async()=>{
  const update=vi.fn().mockReturnValue({eq:vi.fn().mockResolvedValue({error:null})});
  const db={from:vi.fn().mockReturnValue({insert:()=>({select:()=>({single:async()=>({data:{id:'run'},error:null})})}),update})};
  const fetcher=vi.fn().mockResolvedValue(new Response('Denied',{status:403}));
  await expect(importBitontoPlanCatalog(db as never,fetcher)).rejects.toThrow('403');
  expect(update).toHaveBeenCalledWith(expect.objectContaining({status:'FAILED'}));
  expect(db.from.mock.calls.every(c=>c[0]==='building_data_import_runs')).toBe(true);
 });
});
describe('Access and territory semantics',()=>{
 it('allows an ordinary listing with a contact captcha footer and still refuses real challenge pages',()=>{
  expect(hasPublicAccessChallenge('<title>Appartamento Bitonto</title><main>Prezzo €155.000</main><footer>reCAPTCHA</footer><script src="recaptcha/api.js"></script>')).toBe(false);
  expect(hasPublicAccessChallenge('<title>Attention Required! | Cloudflare</title>')).toBe(true);
  expect(hasPublicAccessChallenge('<main>Verify you are human</main>')).toBe(true);
  expect(hasPublicAccessChallenge('<script src="/cdn-cgi/challenge-platform/cf-chl-test"></script>')).toBe(true);
 });
 it('never turns the live-observed Studi Santi 403 into a complete empty inventory',async()=>{
  const http=new HttpClient({retries:0});vi.spyOn(http,'get').mockResolvedValue({ok:false,status:403,body:'<title>Attention Required! | Cloudflare</title>',url:'https://www.studisantiimmobiliare.it/sitemap.xml',headers:new Headers()});
  const r=await new StudiSantiAdapter(http).fetchInventory();expect(r.healthState).toBe('FAILED');expect(r.complete).toBe(false);expect(r.items).toHaveLength(0);expect(r.diagnostics.reasons).toContain('http_status:403');
 });
 it('keeps sold, exit, unknown and active categories distinct, without score overriding sold evidence',()=>{
  const row={state:'ACTIVE',exit_classification:'SOLD_CONFIRMED',opportunity_score:100};
  expect(territoryCategory(row)).toBe('sold');expect(territoryCategory({...row,exit_classification:'MISSING_UNCONFIRMED'})).toBe('exit');
  expect(territoryCategory({...row,state:'UNKNOWN',exit_classification:'UNKNOWN'})).toBe('unknown');
  expect(territoryCategory({...row,exit_classification:'ACTIVE',opportunity_score:0})).toBe('active');
 });
});
