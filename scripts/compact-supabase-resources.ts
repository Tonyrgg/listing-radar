/** Lossless bounded compaction, no external history export and no photo deletion. */
import { getSupabaseServiceClient } from "../src/lib/supabase/service";
async function main(){
  const apply=process.argv.includes("--apply");
  if(apply&&!process.argv.includes("--confirmed-maintenance-window"))
    throw new Error("Verify disk headroom, stop Lifecycle jobs, and explicitly confirm the maintenance window before applying");
  const db=getSupabaseServiceClient();
  const url=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const ref=url.hostname.endsWith(".supabase.co")?url.hostname.split(".")[0]:null;
  const confirm=process.argv.find(arg=>arg.startsWith("--confirm-project="))?.slice("--confirm-project=".length);
  const local=["localhost","127.0.0.1","::1"].includes(url.hostname);
  if(apply&&!local&&(!ref||confirm!==ref))throw new Error("Explicit project confirmation required");
  if(apply){
    const jobs=await db.from("lifecycle_jobs").select("id").eq("status","RUNNING").limit(1);
    if(jobs.error)throw new Error(jobs.error.message);
    if(jobs.data?.length)throw new Error("Lifecycle work is still running");
    const ready=await db.rpc("lifecycle_identity_fingerprint_bundles",{p_property_ids:[]});
    if(ready.error)throw new Error("Apply and verify migrations 0018 and 0019 before resuming compaction");
  }
  const skipInitial=apply&&process.argv.includes("--skip-initial-status");
  const status=skipInitial?null:await db.rpc("resource_compaction_status");if(status?.error)throw new Error(status.error.message);
  console.info(JSON.stringify({mode:apply?"apply":"dry-run",before:status?.data??null,initialStatusSkipped:skipInitial}));
  if(!apply)return;
  const cursor=process.argv.find(arg=>arg.startsWith("--after-publication="))?.slice("--after-publication=".length);
  if(cursor&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor))
    throw new Error("Invalid publication cursor");
  let last:string|null=cursor??null,publications=0,snapshots=0,fingerprints=0,batches=0;
  while(true){
    let request=db.from("publications").select("id").order("id").limit(100);
    if(last)request=request.gt("id",last);
    const page=await request;if(page.error)throw new Error(page.error.message);
    const rows=page.data??[];if(!rows.length)break;
    for(const row of rows){
      for(const [rpc,limit] of [["compact_snapshot_payloads",250],["compact_image_fingerprints",1000]] as const){
        while(true){
          if(batches>=100){
            console.info(JSON.stringify({finished:false,reason:"batch_budget_reached",batches,publications,snapshots,fingerprints,resumeAfter:last,
              next:"Inspect disk, CPU and WAL before starting another maintenance window"}));
            return;
          }
          const active=await db.from("lifecycle_jobs").select("id").eq("status","RUNNING").limit(1);
          if(active.error)throw new Error(active.error.message);
          if(active.data?.length)throw new Error("Lifecycle work started: stop maintenance");
          const result=await db.rpc(rpc,{p_publication_id:row.id,p_limit:limit});
          if(result.error)throw new Error(result.error.message);
          const n=Number(result.data);if(!Number.isSafeInteger(n)||n<0||n>limit)throw new Error("Invalid batch acknowledgement");
          batches++;
          if(rpc==="compact_snapshot_payloads")snapshots+=n;else fingerprints+=n;
          if(n>0)await new Promise(resolve=>setTimeout(resolve,500));
          if(n<limit)break;
        }
      }
      publications++;
      last=row.id;
      if(publications%25===0)console.info(JSON.stringify({publications,snapshots,fingerprints}));
    }
    if(rows.length<100)break;
  }
  const after=await db.rpc("resource_compaction_status");if(after.error)throw new Error(after.error.message);
  console.info(JSON.stringify({finished:true,publications,snapshots,fingerprints,after:after.data,physicalReclaimRequired:true}));
}
main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:"Compaction failed");console.error("Compaction stopped. Completed batches preserve all original rows through the logical views. Verify disk headroom before resuming.");process.exitCode=1;});
