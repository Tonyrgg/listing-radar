import {createClient} from '@supabase/supabase-js';
import {importHistoricalYear} from '../src/lib/property-lifecycle/buildings/history-importer';
import {AlboHttp} from '../src/lib/property-lifecycle/buildings/albo';
import {readRegistryStreets} from '../src/lib/property-lifecycle/buildings/albo-importer';
import {historicalInventory} from '../src/lib/property-lifecycle/buildings/historical-albo';
async function main(){
 const args=process.argv.slice(2),value=(k:string)=>args.find(a=>a.startsWith(k+'='))?.slice(k.length+1),year=Number(value('--year'));
 if(!year)throw Error('Explicit --year=2026..2021 required; no automatic multi-year crawl');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL!,key=process.env.SUPABASE_SERVICE_ROLE_KEY!;if(!url||!key)throw Error('Supabase configuration required');
 const db=createClient(url,key,{auth:{persistSession:false}});
 if(args.includes('--apply')){if(value('--confirm-project')!==new URL(url).hostname.split('.')[0])throw Error('Matching --confirm-project required');console.log(JSON.stringify(await importHistoricalYear(db,year,{refreshInventory:args.includes('--refresh-inventory'),acceptedManifest:value('--accept-manifest'),onProgress:p=>console.log(JSON.stringify(p))})));}
 else{const r=await historicalInventory(new AlboHttp(),year,await readRegistryStreets(db));console.log(JSON.stringify({dryRun:true,year,total:r.total,candidates:r.candidates.length,pages:r.pages,manifest:r.manifest}));}
}main().catch(e=>{console.error(e instanceof Error?e.message:'History failed');process.exitCode=1});
