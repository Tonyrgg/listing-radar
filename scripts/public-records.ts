import { createClient } from "@supabase/supabase-js";
import { importAlboRecords } from "../src/lib/property-lifecycle/buildings/albo-importer";
import { syncPublicRecordSources } from "../src/lib/property-lifecycle/buildings/sync";
import { inspectPublicPdf } from "../src/lib/property-lifecycle/buildings/document-fetch";
async function main(){
 const args=process.argv.slice(2),value=(key:string)=>args.find(a=>a.startsWith(key+"="))?.slice(key.length+1);
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error("Supabase configuration required");
 const db=createClient(url,key,{auth:{persistSession:false}});
 if(args.includes("--sync")){
  const project=new URL(url).hostname.split(".")[0];if(value("--confirm-project")!==project)throw Error("Explicit matching --confirm-project required for ingestion");
  console.log(JSON.stringify(await syncPublicRecordSources(db)));return;
 }
 const recordId=value("--inspect-document");
 if(recordId){
  const r=await db.from("market_observer_public_records").select("document_url,document_urls").eq("id",recordId).single();if(r.error)throw Error(r.error.message);
  const urls=Array.isArray(r.data.document_urls)&&r.data.document_urls.length?r.data.document_urls:[r.data.document_url];
  const selected=urls[Number(value("--document-index")??0)];if(typeof selected!=="string")throw Error("No known public document at that index");
  console.log(JSON.stringify(await inspectPublicPdf(selected)));return;
 }
 const r=await importAlboRecords(db,{dryRun:true});
 console.log(JSON.stringify({dryRun:true,pages:r.pages,inventory:r.inventory,eligible:r.eligible,detailFetches:r.detailFetches,skipped:r.skipped}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
