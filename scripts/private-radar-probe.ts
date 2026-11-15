import { PRIVATE_PORTALS, readPrivateInventory, discoverPrivateUrls, capturePrivateDetail, privateObservationFromCapture } from "../src/lib/property-lifecycle/private-radar/collector";
import { closeSourceBrowser } from "../src/lib/http/browser-fallback";
async function main(){
 try{
  for(const source of Object.keys(PRIVATE_PORTALS) as (keyof typeof PRIVATE_PORTALS)[]){
   const started=Date.now();
   try{
    const response=await readPrivateInventory(PRIVATE_PORTALS[source].url);
    const inventory=response.ok?discoverPrivateUrls(response.body,response.url,source):{urls:[],next:null,records:0};
    console.info(JSON.stringify({source,status:response.status,discovered:inventory.urls.length,hasNext:!!inventory.next,elapsedMs:Date.now()-started}));
    if(response.ok && inventory.urls.length && process.argv.includes("--sample")){
     for(const url of inventory.urls.slice(0,5)){
      const capture=await capturePrivateDetail(url,source),now=new Date().toISOString();
      const normalized=privateObservationFromCapture(source,url,"11111111-1111-4111-8111-111111111111",capture,now,now);
      console.info(JSON.stringify({source,sampleVerified:!!normalized,seller:normalized?.seller_type??"excluded",pricePresent:normalized?.price!=null,addressPresent:!!normalized?.address_raw,images:normalized?.image_urls?.length??0}));
      if(normalized)break;
     }
    }
   }catch{console.info(JSON.stringify({source,readable:false,elapsedMs:Date.now()-started}));}
  }
 }finally{await closeSourceBrowser();}
}
main().catch(()=>{process.exitCode=1;});
