import{load}from'cheerio';
import{HttpClient,type HttpResponse}from'@/lib/http/client';
import{rehashNormalizedListing}from'@/lib/property-lifecycle/contracts/normalized-listing';
import{TrovaCasaPortalAdapter,normalizeTrovaCasaDetail,type TrovaCasaAgencyProfile}from'./trovacasa';
import{structureFingerprint}from'./shared';
import type{InventoryResult,InventoryItem,SourceDocument}from'./types';
const categories=new Set(['case-in-vendita','immobili-commerciali-in-vendita','box-e-posti-auto-in-vendita','terreni-in-vendita']);
export class PublisherFallback{
 constructor(private profile:TrovaCasaAgencyProfile,private http:HttpClient){}
 async fetchInventory(primary:HttpResponse):Promise<InventoryResult>{
  const root='https://www.trovacasa.it'+this.profile.agencyPath+'/annunci';const response=await this.http.get(root);const $=load(response.body);
  const links=new Map<string,number>();
  $('a[href]').each((_,e)=>{const href=$(e).attr('href')!;try{const u=new URL(href,root),category=u.pathname.split('/').at(-1)!;if(u.origin==='https://www.trovacasa.it'&&u.pathname.startsWith(this.profile.agencyPath+'/')&&!u.search&&categories.has(category)){const count=Number($(e).text().match(/\((\d+)\)/)?.[1]);if(Number.isFinite(count)&&count>0)links.set(u.href,count);}}catch{}});
  const items:InventoryItem[]=[];let expected=0,pages=1,errors=0,duplicates=0;let complete=response.ok&&links.size>0;const reasons=[`http_status:${primary.status}`,`primary_http_status:${primary.status}`,'secondary_publisher_catalog','primary_absence_evaluation_disabled'];
  for(const [url,count]of links){const result=await new TrovaCasaPortalAdapter({...this.profile,inventoryUrl:url,publisherReportedTotal:count},this.http).fetchInventory();items.push(...result.items);expected+=count;duplicates+=result.diagnostics.duplicateCount;pages+=result.diagnostics.pagesVisited;errors+=result.diagnostics.parseErrorCount;complete&&=result.complete&&result.diagnostics.expectedCount!==null&&result.diagnostics.expectedCount+result.diagnostics.duplicateCount===count&&result.items.length+result.diagnostics.duplicateCount===count;reasons.push(...result.diagnostics.reasons);}
  const unique=new Map(items.map(i=>[i.sourceKey,i]));duplicates+=items.length-unique.size;reasons.push(`publisher_reported_raw_sale_records:${expected}`);expected-=duplicates;complete&&=unique.size===expected;
  const markers={publisherCatalog:response.ok,agencyIdentity:$('.agenziaAnnunci__card a[href]').length>0&&response.body.toLowerCase().includes(this.profile.agencyDisplayName.toLowerCase()),saleCategories:links.size>0,allSalePagesComplete:complete};complete&&=Object.values(markers).every(Boolean);
  // A partial secondary catalog can still provide positive observations. Keep
  // those sightings, but never use an incomplete count to infer absence. An
  // empty result remains a hard failure because it provides no usable data.
  const healthState=complete?'HEALTHY':unique.size>0&&markers.publisherCatalog&&markers.agencyIdentity&&markers.saleCategories?'DEGRADED':'FAILED';
  return{items:[...unique.values()].map(i=>({...i,sourceKey:'trovacasa.it:'+i.sourceKey,summary:{...i.summary,accessFallback:true,primaryUrl:primary.url,primaryStatus:primary.status}})),healthState,complete,absenceAuthoritative:false,structureFingerprint:structureFingerprint(markers),response,diagnostics:{expectedCount:expected||null,observedCount:unique.size,duplicateCount:duplicates,parseErrorCount:errors+(complete?0:1),pagesVisited:pages,expectedPages:pages,requiredMarkers:markers,reasons}};
 }
 async fetchDetail(item:InventoryItem):Promise<SourceDocument>{const response=await this.http.get(item.url);if(!response.ok)throw Error('Secondary publisher detail HTTP '+response.status);return{item,response,observedAt:new Date().toISOString()};}
 normalize(document:SourceDocument){const listing=normalizeTrovaCasaDetail(document,this.profile);return rehashNormalizedListing(listing,row=>({...row,provenance:{...row.provenance,accessFallback:true,primarySourceUrl:document.item.summary.primaryUrl,absenceAuthoritative:false}}));}
}
export function publisherFallback(key:'studiocasa'|'studisanti',http:HttpClient){
 const casa=key==='studiocasa',agencyPath=casa?'/agenzie-immobiliari/studio-casa-bitonto-tc-91918':'/agenzie-immobiliari/studi-santi-srl-bitonto-tc-81203';
 return new PublisherFallback({adapterKey:key,agencySlug:casa?'studio-casa-bitonto':'studi-santi-bitonto',agencyDisplayName:casa?'Studio Casa Bitonto':'Studi Santi srl',agencyId:casa?'91918':'81203',agencyPath,inventoryUrl:'https://www.trovacasa.it'+agencyPath+'/case-in-vendita'},http);
}
