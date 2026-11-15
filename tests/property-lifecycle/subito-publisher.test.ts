import { expect, it } from "vitest";
import { subitoRecords, subitoCapture, StudiSantiSubitoPublisher } from "@/lib/property-lifecycle/adapters/subito-publisher";
import { HttpClient } from "@/lib/http/client";
const url="https://www.subito.it/appartamenti/casa-bari-123.htm";
const ad={body:"Casa in vendita. RIFERIMENTO: V000827",subject:"Casa Bitonto",urn:"id:ad:1:list:123",urls:{default:url},type:{key:"s"},category:{value:"Appartamenti"},advertiser:{company:true,shopId:"60083",phone:"9999999"},date:"2026-11-10",geo:{town:{value:"Bitonto"},map:{latitude:"41.11",longitude:"16.69",showPin:false}},features:{"/price":{values:[{key:"100000"}]},"/size":{values:[{key:"80"}]}},images:[]};
it("reads Next JSON and RSC data without executing scripts and retains only listing records",()=>{
 const old=`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{items:[ad]}}})}</script>`;
 const rsc=`<script>self.__next_f.push(${JSON.stringify([1,"a:"+JSON.stringify(["$","component",null,{ad}])+"\n"])})</script>`;
 expect(subitoRecords(old)).toEqual([ad]);expect(subitoRecords(rsc)).toEqual([ad]);
 const body="CLASSE ENERGETICA\nè un testo su più righe";
 const refAd={...ad,body:"$a"};
 const textFrame="a:T"+Buffer.byteLength(body).toString(16)+","+body;
 const dataFrame="b:"+JSON.stringify({ad:refAd})+"\n";
 const split=`<script>self.__next_f.push(${JSON.stringify([1,textFrame+dataFrame.slice(0,20)])});self.__next_f.push(${JSON.stringify([1,dataFrame.slice(20)])});</script>`;
 expect(subitoRecords(split)[0].body).toBe(body);
 expect(subitoRecords('<script>globalThis.shouldNeverRun=true</script>')).toEqual([]);
});
it("verifies publisher and sale identity, keeps approximate location and ignores bump date for market start",()=>{
 const publisher=new StudiSantiSubitoPublisher(new HttpClient());
 const document={item:{externalId:"123",sourceKey:"subito.it:123",url,summary:{primaryUrl:"https://studisantiimmobiliare.it/sitemap.xml"}},response:{url,body:`<script id="__NEXT_DATA__">${JSON.stringify({ad})}</script>`,status:200,ok:true,headers:new Headers()},observedAt:"2026-11-15T12:00:00Z"};
 const result=publisher.normalize(document);
 expect(result.source.agencyReference).toBe("V000827");
 expect(result.commercial.priceAmount).toBe(100000);expect(result.commercial.surfaceSqm).toBe(80);
 expect(result.marketStart.method).toBe("CRAWLER_FIRST_SEEN");expect(result.provenance.absenceAuthoritative).toBe(false);
 expect(result.location.precision).not.toBe("EXACT_COORDINATES");expect(JSON.stringify(result)).not.toContain("9999999");
 expect(()=>publisher.normalize({...document,response:{...document.response,body:document.response.body.replace('"60083"','"another"')}})).toThrow("identity");
 expect(subitoCapture({...ad,advertiser:{company:false}}).sellerType).toBe("private");
 expect(publisher.normalize({...document,response:{...document.response,body:document.response.body.replace('"key":"s"','"key":"u"')}}).source.transactionType).toBe("RENT");
});
