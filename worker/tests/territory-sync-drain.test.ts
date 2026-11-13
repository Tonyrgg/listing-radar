import {it,expect,vi} from 'vitest';
import {synchronizeUntilAcknowledged} from '../src/territory/sync-barrier.js';
it('waits for the newer checkpoint after an older in-flight exchange succeeds',async()=>{
 let pending=true,count=0;const exchange=vi.fn(async()=>{if(++count===2)pending=false;});
 const result=await synchronizeUntilAcknowledged(exchange,async()=>({pending,revision:count}),()=>null,{delay:async()=>{}});
 expect(exchange).toHaveBeenCalledTimes(2);expect(result.pending).toBe(false);
});
it('waits while another local operation holds the synchronizer instead of spinning eight times and failing',async()=>{
 let count=0;const exchange=vi.fn(async()=>{count++;});
 await synchronizeUntilAcknowledged(exchange,async()=>({pending:count<12}),()=>null,{delay:async()=>{}});
 expect(count).toBe(12);
});
it('retains the safety barrier for actual connection failures',async()=>{
 await expect(synchronizeUntilAcknowledged(async()=>{},async()=>({pending:true}),()=> 'Connection lost')).rejects.toThrow('Connection lost');
});
