import {expect,it,vi} from 'vitest';
import {LifecycleJobQueue} from '@/lib/property-lifecycle/jobs/queue';
it('reuses the same pending scan across UI and scheduler requests',async()=>{
 const rows=new Map<string,Record<string,unknown>>(); const filters:unknown[][]=[];
 const lookup={eq:(...args:unknown[])=>{filters.push(args);return lookup;},in:()=>lookup,single:async()=>({data:[...rows.values()][0],error:null})};
 const insert=vi.fn((row:Record<string,unknown>)=>({select:()=>({single:async()=>{
   const key=String(row.dedupe_key);if(rows.has(key))return{data:null,error:{code:'23505',message:'duplicate'}};
   const stored={...row,id:'existing-job',status:'QUEUED'};rows.set(key,stored);return{data:stored,error:null};
 }})}));
 const db={from:()=>({insert,select:()=>lookup})}; const queue=new LifecycleJobQueue(db as never);
 const first=await queue.enqueue({jobType:'SYNC_AGENCY',agencyId:'agency-1',dedupeKey:'scheduler:today:slug'});
 const second=await queue.enqueue({jobType:'SYNC_AGENCY',agencyId:'agency-1',dedupeKey:'ui:SYNC_AGENCY:slug'});
 expect(first.id).toBe(second.id);expect(rows.size).toBe(1);
 expect(filters).toContainEqual(['dedupe_key','SYNC_AGENCY:agency:agency-1']);
 // A completed scan no longer occupies the partial-unique-index slot.
 rows.clear();await queue.enqueue({jobType:'SYNC_AGENCY',agencyId:'agency-1',dedupeKey:'scheduler:next-slot'});
 expect(rows.size).toBe(1);
});
