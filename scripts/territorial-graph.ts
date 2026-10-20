import {createClient} from '@supabase/supabase-js';
import {recomputeTerritorialGraph} from '../src/lib/property-lifecycle/buildings/graph-recompute';
async function main(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error('Supabase configuration required');
 const apply=process.argv.includes('--apply'),project=new URL(url).hostname.split('.')[0];if(apply&&!process.argv.includes(`--confirm-project=${project}`))throw Error('Explicit target confirmation required');
 console.log(JSON.stringify(await recomputeTerritorialGraph(createClient(url,key,{auth:{persistSession:false}}),apply)));
}main().catch(e=>{console.error(e.message);process.exitCode=1});
