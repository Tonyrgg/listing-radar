import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {normalizeAdMaioraDetail,AdMaioraAdapter} from '@/lib/property-lifecycle/adapters/admaiora';
import {AD_MAIORA_PORTAL_CATALOG,compactAdMaioraRest,enrichAdMaioraListing,matchAdMaioraPortal,parseAdMaioraPortalCatalog,type PortalCard} from '@/lib/property-lifecycle/adapters/admaiora-enrichment';
import type {HttpClient} from '@/lib/http/client';
const url='https://www.admaioraimmobiliare.it/immobile/elegante-trivani-ristrutturato-in-vendita-a-bitonto-zona-centro/';
const html=readFileSync('tests/fixtures/property-lifecycle/admaiora-active-detail.html','utf8');
const response=(body:string,status=200)=>({body,status,ok:status===200,url,headers:new Headers()});
function listing(){const n=normalizeAdMaioraDetail({item:{sourceKey:'17425',externalId:'17425',url,summary:{}},response:response(html),observedAt:'2026-11-16T12:00:00.000Z'});n.location.streetName='Via Vitale Giordano';n.commercial.description='Soluzione semi indipendente finemente ristrutturata ingresso riservato luminosissimo terrazzo abitabile pavimentazione moderna impianti nuovi soppalco studio deposito';return n;}
function rest(){return compactAdMaioraRest({id:17425,link:url,date_gmt:'2026-07-29T09:38:41',modified_gmt:'2026-08-04T17:17:51',property_meta:{REAL_HOMES_property_address:'Bitonto, Via Vitale Giordano',REAL_HOMES_property_price:'170000',REAL_HOMES_property_size:'70',REAL_HOMES_property_bedrooms:'3',REAL_HOMES_property_bathrooms:'2',REAL_HOMES_property_private_note:'NEVER STORE',inspiry_property_owner_name:'NEVER STORE'}},'17425',url)!;}
function card():PortalCard{return {url:'https://www.idealista.it/immobile/123456/',address:'Trilocale in Via Vitale Giordano, 29, Bitonto',price:170000,surface:70,rooms:3,description:listing().commercial.description!,floor:'1º piano senza ascensore'};}
describe('Ad Maiora double check',()=>{
 it('rejects mismatched WordPress identity and excludes owner/private fields',()=>{
  expect(compactAdMaioraRest({id:1,link:url},'17425',url)).toBeNull();
  expect(JSON.stringify(rest())).not.toContain('NEVER STORE');
 });
 it('ignores source pins for every detail and crosschecks dates and contradictory facts',()=>{
  const n=listing();n.location.latitude=41.1;n.location.longitude=16.6;
  enrichAdMaioraListing(n,rest(),null,[],{wordpress:'verified_identity'});
  expect(n.location.latitude).toBeNull();expect(n.location.longitude).toBeNull();
  expect(n.commercial.bathrooms).toBe(1);
  expect(n.commercial.features.adMaioraCrossCheck).toMatchObject({conflicts:[{field:'bathrooms',html:1,wordpress:2}],publisherPinIgnored:true});
  expect(n.source.portalPublishedAt).toBe('2026-07-29T09:38:41.000Z');
  expect(n.source.portalModifiedAt).toBe('2026-08-04T17:17:51.000Z');
 });
 it('fills civic only from a unique matched publication, preserving uncertainty and source URL',()=>{
  const n=listing();expect(matchAdMaioraPortal(n,[card(),{...card(),url:'https://www.idealista.it/immobile/999/'}])).toBeNull();
  expect(matchAdMaioraPortal(n,[{...card(),price:1000}])).toBeNull();
  enrichAdMaioraListing(n,rest(),null,[card()],{});
  expect(n.location.streetNumber).toBe('29');expect(n.location.latitude).toBeNull();
  expect(n.provenance.adMaioraDoubleCheck).toMatchObject({portalUrl:card().url});
 });
 it('does not turn media titles or modification date into civic or publication date',()=>{
  const n=listing(),r=rest();r.dateGmt='invalid';
  enrichAdMaioraListing(n,r,{title:'FOTO VIA VITALE GIORDANO - 13'},[],{});
  expect(n.location.streetNumber).toBeNull();expect(n.source.portalPublishedAt).not.toBe(n.source.portalModifiedAt);
 });
 it('never loses the HTML civic when WordPress only repeats the street',()=>{
  const n=listing();n.location.streetNumber='29';
  enrichAdMaioraListing(n,rest(),null,[],{});expect(n.location.streetNumber).toBe('29');
  const r=rest();(r.fields as Record<string,unknown>).address='Bitonto, Via Vitale Giordano 30';
  enrichAdMaioraListing(n,r,null,[],{});expect(n.location.streetNumber).toBe('29');
  expect(n.commercial.features.adMaioraCrossCheck).toMatchObject({conflicts:expect.arrayContaining([expect.objectContaining({field:'streetNumber',html:'29',wordpress:'30'})])});
 });
 it('parses only agency catalog listing cards and rejects captcha pages',()=>{
  const catalog='<h1>Ad Maiora Immobiliare</h1><article class="item"><a class="item-link" href="/immobile/123456/">Trilocale in Via Vitale Giordano, 29, Bitonto</a><span class="item-price">170.000 €</span><span class="item-detail">70 m²</span><span class="item-detail">3 locali</span><div class="item-description">Descrizione</div></article>';
  expect(parseAdMaioraPortalCatalog(catalog)[0]).toMatchObject({price:170000,surface:70,rooms:3});
  expect(parseAdMaioraPortalCatalog(catalog+'captcha')).toEqual([]);
 });
 it('keeps HTML observation usable on secondary API/portal failure',async()=>{
  const http={get:vi.fn(async(target:string)=>target===url?response(html):response('blocked',403))} as unknown as HttpClient;
  const adapter=new AdMaioraAdapter(http),n=await adapter.normalize(await adapter.fetchDetail({sourceKey:'17425',externalId:'17425',url,summary:{}}));
  expect(n.commercial.priceAmount).toBe(170000);expect(n.location.latitude).toBeNull();
  expect(n.provenance.adMaioraDoubleCheck).toMatchObject({wordpress:'http_403',portal:'unavailable_or_blocked_403'});
 });
 it('reads later catalog pages once per run and deduplicates publication identities',async()=>{
  const next=AD_MAIORA_PORTAL_CATALOG+'pagina-2.htm';
  const article='<article class="item"><a class="item-link" href="/immobile/123456/">Via Vitale Giordano 29, Bitonto</a></article>';
  const http={get:vi.fn(async(target:string)=>target===url?response(html):target===AD_MAIORA_PORTAL_CATALOG?response('<h1>Ad Maiora</h1>'+article+`<a rel="next" href="${next}">Avanti</a>`):target===next?response('<h1>Ad Maiora</h1>'+article):response('not available',403))} as unknown as HttpClient;
  const adapter=new AdMaioraAdapter(http),item={sourceKey:'17425',externalId:'17425',url,summary:{}};
  const document=await adapter.fetchDetail(item);await adapter.fetchDetail(item);
  expect((document.item.summary.adMaioraSupplement as {portalCards:unknown[]}).portalCards).toHaveLength(1);
  expect((http.get as ReturnType<typeof vi.fn>).mock.calls.filter(call=>[next,AD_MAIORA_PORTAL_CATALOG].includes(call[0]))).toHaveLength(2);
 });
 it('does not make a new content version merely because the observation time changes',()=>{
  const item={sourceKey:'17425',externalId:'17425',url,summary:{}};
  const a=normalizeAdMaioraDetail({item,response:response(html),observedAt:'2026-11-16T12:00:00.000Z'});
  const b=normalizeAdMaioraDetail({item,response:response(html),observedAt:'2026-11-16T13:00:00.000Z'});
  expect(a.contentHash).toBe(b.contentHash);
 });
});
