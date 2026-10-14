/** Lossless bounded compaction, no external history export and no photo deletion. */
import { getSupabaseServiceClient } from "../src/lib/supabase/service";
async function main(){
  const db=getSupabaseServiceClient();
  const apply=process.argv.includes("--apply");
  const url=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const ref=url.hostname.endsWith(".supabase.co")?url.hostname.split(".")[0]:null;
  const confirm=process.argv.find(arg=>arg.startsWith("--confirm-project="))?.slice("--confirm-project=".length);
  const local=["localhost","127.0.0.1","::1"].includes(url.hostname);
  if(apply&&!local&&(!ref||confirm!==ref))throw new Error("Explicit project confirmation required");
  const skipInitial=apply&&process.argv.includes("--skip-initial-status");
  const status=skipInitial?null:await db.rpc("resource_compaction_status");if(status?.error)throw new Error(status.error.message);
  console.info(JSON.stringify({mode:apply?"apply":"dry-run",before:status?.data??null,initialStatusSkipped:skipInitial}));
  if(!apply)return;
  let last:string|null=null,publications=0,snapshots=0,fingerprints=0;
  while(true){
    let request=db.from("publications").select("id").order("id").limit(100);
    if(last)request=request.gt("id",last);
    const page=await request;if(page.error)throw new Error(page.error.message);
    const rows=page.data??[];if(!rows.length)break;
    for(const row of rows){
      for(const [rpc,limit] of [["compact_snapshot_payloads",1000],["compact_image_fingerprints",5000]] as const){
        while(true){
          const result=await db.rpc(rpc,{p_publication_id:row.id,p_limit:limit});
          if(result.error)throw new Error(result.error.message);
          const n=Number(result.data);if(!Number.isSafeInteger(n)||n<0||n>limit)throw new Error("Invalid batch acknowledgement");
          if(rpc==="compact_snapshot_payloads")snapshots+=n;else fingerprints+=n;
          if(n<limit)break;
        }
      }
      publications++;
      if(publications%25===0)console.info(JSON.stringify({publications,snapshots,fingerprints}));
    }
    last=rows.at(-1)!.id;
    if(rows.length<100)break;
  }
  const after=await db.rpc("resource_compaction_status");if(after.error)throw new Error(after.error.message);
  console.info(JSON.stringify({finished:true,publications,snapshots,fingerprints,after:after.data,physicalReclaimRequired:true}));
}
main().catch(()=>{console.error("Compaction stopped. Completed batches preserve all original rows through the logical views and can be resumed.");process.exitCode=1;});
