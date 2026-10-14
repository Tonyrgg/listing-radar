/** Derived intelligence only; immutable observations and original dates are never rewritten. */
import { getSupabaseServiceClient } from "../src/lib/supabase/service";
async function main() {
  const apply=process.argv.includes("--apply");
  const db=getSupabaseServiceClient();
  const url=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const local=["localhost","127.0.0.1","::1"].includes(url.hostname);
  const confirmed=process.argv.find(arg=>arg.startsWith("--confirm-project="))?.slice(18);
  const ref=url.hostname.endsWith(".supabase.co") ? url.hostname.split(".")[0] : null;
  if(apply && !local && (!ref || confirmed!==ref)) {
    throw new Error("Remote apply requires an explicit --confirm-project matching the configured project. Dry-run is the default.");
  }
  const asOf=new Date().toISOString();
  let lastId:string|null=null,scanned=0,processed=0;
  while(true) {
    let request=db.from("properties").select("id").neq("identity_status","MERGED").order("id").limit(100);
    if(lastId) request=request.gt("id",lastId);
    const {data,error}=await request;
    if(error) throw new Error(error.message);
    const ids=(data??[]).map(row=>row.id as string);
    if(!ids.length) break;
    scanned+=ids.length;
    if(apply) {
      const result=await db.rpc("recompute_market_observer_intelligence",{p_property_ids:ids,p_as_of:asOf});
      if(result.error) throw new Error(result.error.message);
      processed+=Number(result.data);
    }
    lastId=ids.at(-1)!;
    if(ids.length<100) break;
  }
  console.info(JSON.stringify({mode:apply?"apply":"dry-run",scanned,processed,asOf,sourceHistoryRewritten:false}));
}
main().catch(()=>{console.error("Backfill failed or target not confirmed. Completed batches are idempotent; source history is preserved.");process.exitCode=1;});
