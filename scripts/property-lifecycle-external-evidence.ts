/** A selected historical claim enters existing evidence; it never creates or activates a publication. */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { historicalEvidence } from "../src/lib/property-lifecycle/external/adapters";
import { getSupabaseServiceClient } from "../src/lib/supabase/service";

const inputSchema = z.object({ propertyId:z.uuid(),publicationId:z.uuid().nullable().default(null),
  sourceUrl:z.url(),captureUrl:z.url(),observedAt:z.iso.datetime(),claimedDate:z.string(),rawClaim:z.string().min(1),
  kind:z.enum(["PUBLICATION_DATE","ASKING_PRICE"]).optional(),amount:z.number().int().positive().optional() });
async function main() {
const args=process.argv.slice(2),file=args.find(arg=>!arg.startsWith("--"));
if(!file) throw new Error("Usage: tsx scripts/property-lifecycle-external-evidence.ts selected-claim.json [--apply-local]");
const input=inputSchema.parse(JSON.parse(await readFile(file,"utf8")));
if(Date.parse(input.observedAt)>Date.now()) throw new Error("Historical capture time cannot be in the future");
const claim=historicalEvidence(input);
if(!args.includes("--apply-local")) {
  console.log(JSON.stringify({dryRun:true,propertyId:input.propertyId,publicationId:input.publicationId,claim},null,2));
} else {
  const url=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid");
  if(!["localhost","127.0.0.1","::1"].includes(url.hostname)) throw new Error("This import command only writes to local Supabase. No production import.");
  const db=getSupabaseServiceClient();
  const result=await db.rpc("market_external_claims_atomic",{p_property_id:input.propertyId,p_publication_id:input.publicationId,
    p_sync_run_id:null,p_source_key:"SEARCH_INDEX",p_claims:[claim],p_observed_at:input.observedAt});
  if(result.error) throw new Error(result.error.message);
  const refresh=await db.rpc("refresh_property_lifecycle_intelligence_atomic",{p_property_id:input.propertyId,p_as_of:new Date().toISOString()});
  if(refresh.error) throw new Error(refresh.error.message);
  console.log(JSON.stringify({insertedEvidenceIds:result.data,propertyId:input.propertyId}));
}
}
main().catch(error=>{ console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1; });
