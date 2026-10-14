/** Only recoverable listing previews. Source links, fingerprints and history are untouched. */
import {createHash} from "node:crypto";
import sharp from "sharp";
import {getSupabaseServiceClient} from "../src/lib/supabase/service";
const bucket="property-lifecycle-visuals";
const ownedPath=/^[0-9a-f-]{36}\/(?:preview-640-)?[0-9a-f]{64}\.webp$/i;
type Property={id:string;representative_image_paths:string[]};
async function main(){
  const db=getSupabaseServiceClient(),storage=db.storage.from(bucket);
  const apply=process.argv.includes("--apply");
  const host=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname;
  const ref=host.endsWith(".supabase.co")?host.split(".")[0]:null;
  const confirm=process.argv.find(arg=>arg.startsWith("--confirm-project="))?.slice("--confirm-project=".length);
  if(apply&&!(["localhost","127.0.0.1"].includes(host))&&(!ref||ref!==confirm))throw new Error("Project confirmation required");
  const running=await db.from("lifecycle_jobs").select("id").eq("status","RUNNING").limit(1);
  if(running.error||running.data?.length)throw new Error("Wait for lifecycle jobs to finish");
  const properties:Property[]=[];
  for(let from=0;;from+=100){
    const page=await db.from("properties").select("id,representative_image_paths").order("id").range(from,from+99);
    if(page.error)throw new Error(page.error.message);
    properties.push(...(page.data??[]));if((page.data?.length??0)<100)break;
  }
  console.info(JSON.stringify({mode:apply?"apply":"dry-run",properties:properties.length,withPhoto:properties.filter(p=>p.representative_image_paths.length).length,referencedPhotos:properties.reduce((n,p)=>n+p.representative_image_paths.length,0),bucket,target:"one WebP preview, max 640x480"}));
  if(!apply)return;
  let done=0,bytesBefore=0,bytesAfter=0,deleted=0,missing=0,conflicts=0;
  for(const property of properties){
    const old=property.representative_image_paths;
    const original=old.find(p=>ownedPath.test(p)&&p.startsWith(`${property.id}/`));
    if(!original)continue;
    let path=original,sourceBytes=0,compactBytes=0;
    // Re-running maintenance must not repeatedly re-encode an already compact photo.
    if(!original.startsWith(`${property.id}/preview-640-`)){
      const download=await storage.download(original);
      if(download.error||!download.data){missing++;continue;}
      const source=Buffer.from(await download.data.arrayBuffer());
      const compact=await sharp(source).rotate().resize(640,480,{fit:"inside",withoutEnlargement:true}).webp({quality:65}).toBuffer();
      const hash=createHash("sha256").update(compact).digest("hex");path=`${property.id}/preview-640-${hash}.webp`;
      const uploaded=await storage.upload(path,compact,{contentType:"image/webp",cacheControl:"31536000",upsert:false});
      if(uploaded.error&&!/already exists|duplicate/i.test(uploaded.error.message))throw new Error("Preview upload not confirmed");
      sourceBytes=source.length;compactBytes=compact.length;
    }
    const arrayLiteral=`{${old.map(p=>JSON.stringify(p)).join(",")}}`;
    const update=await db.from("properties").update({representative_image_paths:[path]}).eq("id",property.id)
      .eq("representative_image_paths",arrayLiteral).select("id");
    if(update.error)throw new Error("Preview reference update not confirmed");
    if(!update.data?.length){conflicts++;continue;}
    // Only remove files in this property's folder after its new reference is durable.
    // A fresh job must not race a storage sweep.
    const job=await db.from("lifecycle_jobs").select("id").eq("status","RUNNING").limit(1);
    if(job.error||job.data?.length)throw new Error("A lifecycle job started; references remain valid, cleanup paused");
    const listing=await storage.list(property.id,{limit:1000,sortBy:{column:"name",order:"asc"}});
    if(listing.error)throw new Error("Storage listing failed");
    const remove=(listing.data??[]).map(file=>`${property.id}/${file.name}`).filter(file=>file!==path&&ownedPath.test(file));
    if(remove.length){const result=await storage.remove(remove);if(result.error)throw new Error("Storage cleanup not confirmed");deleted+=remove.length;}
    done++;bytesBefore+=sourceBytes;bytesAfter+=compactBytes;
    if(done%25===0)console.info(JSON.stringify({done,deleted,bytesBefore,bytesAfter,missing,conflicts}));
  }
  console.info(JSON.stringify({finished:true,done,deleted,bytesBefore,bytesAfter,missing,conflicts}));
}
main().catch(()=>{console.error("Preview compaction stopped. Saved references remain valid; source links and all history are preserved.");process.exitCode=1;});
