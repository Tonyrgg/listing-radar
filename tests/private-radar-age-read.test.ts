import {it,expect} from 'vitest';
import {readIntelligence} from '@/lib/property-lifecycle/read-models/intelligence';
const row={property_id:'p',row_id:'r',private_source:'subito',first_seen_at:'2026-11-15T00:00:00Z',earliest_market_evidence_at:'2026-11-08T00:00:00Z'};
function database(primaryError=false){
 const dates={in:()=>dates,eq:async()=>({data:null,error:{message:'Temporary date source failure'}})};
 const primary={order:()=>primary,range:async()=>({data:primaryError?null:[{...row}],error:primaryError?{message:'Primary archive failure'}:null})};
 return {from:(table:string)=>({select:()=>table==='private_publications'?dates:primary})} as never;
}
it('keeps the archive and its known age if optional date details are unavailable',async()=>{const result=await readIntelligence(database(),{view:'privati',page:1});expect(result.rows[0]).toMatchObject({property_id:'p',public_market_date:'2026-11-08T00:00:00Z',public_date_unavailable:true});});
it('does not turn a failed primary archive read into an empty success',async()=>{await expect(readIntelligence(database(true),{view:'privati',page:1})).rejects.toThrow('Primary archive failure');});
