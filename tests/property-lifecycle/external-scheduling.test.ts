import type {SupabaseClient} from '@supabase/supabase-js';
import {describe,expect,it,vi} from 'vitest';
import type {LifecycleJobQueue} from '@/lib/property-lifecycle/jobs/queue';
import {enqueueDueKnownMarketVerifiers} from '@/lib/property-lifecycle/external/scheduling';

function database(enabled:boolean,pages:Array<Array<{id:string;agency_id:string}>>=[[]],error:string|null=null){
 const filters:Array<{table:string;method:string;args:unknown[]}>=[];
 let page=0;
 const db={from:(table:string)=>{
  const query:Record<string,unknown>={};
  for(const method of ['select','eq','or','order','limit','gt','single'])query[method]=(...args:unknown[])=>{
   filters.push({table,method,args});return query;
  };
  query.then=(ok:(value:unknown)=>unknown,fail:(error:unknown)=>unknown)=>Promise.resolve(table==='market_observer_sources'
   ?{data:{enabled},error:null}:{data:pages[page++]??[],error:error?{message:error}:null}).then(ok,fail);
  return query;
 }} as unknown as SupabaseClient;
 const enqueue=vi.fn().mockResolvedValue({id:'job'});
 return {db,filters,enqueue,queue:{enqueue} as unknown as LifecycleJobQueue};
}
describe('Known RE/MAX verifier scheduling',()=>{
 it('never reads publications or queues jobs for a disabled source',async()=>{
  const fake=database(false);
  expect(await enqueueDueKnownMarketVerifiers(fake.db,new Date(),fake.queue)).toEqual({requested:0,disabled:true});
  expect(fake.enqueue).not.toHaveBeenCalled();
  expect(fake.filters.every(x=>x.table==='market_observer_sources')).toBe(true);
 });
 it('reads only due known publications, pages by identity and queues verifiers with active-job deduplication',async()=>{
  const first=Array.from({length:500},(_,i)=>({id:`publication-${i}`,agency_id:'agency'}));
  const fake=database(true,[first,[{id:'last-publication',agency_id:'agency'}]]);
  expect(await enqueueDueKnownMarketVerifiers(fake.db,new Date('2026-10-19T17:00:00Z'),fake.queue)).toEqual({requested:501,disabled:false});
  expect(fake.filters).toContainEqual({table:'publications',method:'eq',args:['external_source_key','REMAX']});
  expect(fake.filters).toContainEqual({table:'publications',method:'or',args:['external_detail_at.is.null,external_detail_at.lte.2026-10-18T17:00:00.000Z']});
  expect(fake.filters).toContainEqual({table:'publications',method:'gt',args:['id','publication-499']});
  expect(fake.enqueue).toHaveBeenCalledTimes(501);
  expect(fake.enqueue.mock.calls.at(-1)?.[0]).toMatchObject({jobType:'VERIFY_MARKET_PUBLICATION',
   payload:{source:'REMAX',publicationId:'last-publication'},dedupeKey:'known-market-verifier:REMAX:last-publication'});
 });
 it('does not refetch recent publications or ignore a failed database read',async()=>{
  const recent=database(true);
  expect(await enqueueDueKnownMarketVerifiers(recent.db,new Date(),recent.queue)).toEqual({requested:0,disabled:false});
  expect(recent.enqueue).not.toHaveBeenCalled();
  const failed=database(true,[],'read failed');
  await expect(enqueueDueKnownMarketVerifiers(failed.db,new Date(),failed.queue)).rejects.toThrow('read failed');
  expect(failed.enqueue).not.toHaveBeenCalled();
 });
});
