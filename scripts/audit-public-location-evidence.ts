import {createPropertyLifecycleAdapter} from '../src/lib/property-lifecycle/adapters/registry';
import {mkdir,writeFile} from 'node:fs/promises';
async function main(){
const keys=['vistocasa','futura','puntocasa','studisanti','studiocasa','admaiora','garofalo','iconacasa','momento'];
const results=await Promise.all(keys.map(async key=>{try{const a=createPropertyLifecycleAdapter(key);const inventory=await a.fetchInventory();const item=inventory.items[0];if(!item)return{key,health:inventory.healthState,items:0};const doc=await a.fetchDetail(item);const n=await a.normalize(doc);return{key,health:inventory.healthState,items:inventory.items.length,sample:item.url,location:n.location,evidence:n.provenance.publicLocationEvidence,marketStart:n.marketStart};}catch(e){return{key,error:e instanceof Error?e.message:String(e)};}}));
await mkdir('.runtime/location-audit',{recursive:true});await writeFile('.runtime/location-audit/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(r=>({key:r.key,...('error'in r?{error:r.error}:{items:r.items,health:r.health,...('location'in r?{street:r.location?.streetName,civic:r.location?.streetNumber,hasPin:r.location?.latitude!=null,evidenceCount:Array.isArray(r.evidence)?r.evidence.length:0}: {})})})),null,2));

}
main().catch(e=>{console.error(e.message);process.exitCode=1});

