import {describe,it,expect,vi} from 'vitest';
import {runLifecycleWorkerOnce} from '@/lib/property-lifecycle/jobs/worker';
describe('deferred source evidence',()=>{
 it('defers a blocked post-exit job without reporting the scan as failed',async()=>{
 const error=new Error('POST_EXIT_FRESH_HEALTHY_SCAN_REQUIRED');
 const queue={claim:vi.fn().mockResolvedValue({id:'j',job_type:'POST_EXIT_CHECK',agency_id:'a',payload:{agencyListingId:'al'}}),fail:vi.fn().mockResolvedValue(undefined),complete:vi.fn(),renew:vi.fn()};
 const db={rpc:vi.fn().mockResolvedValue({data:null,error:{message:error.message}})};
 await expect(runLifecycleWorkerOnce('w',{db:db as never,queue:queue as never})).resolves.toBe(true);
 expect(queue.fail).toHaveBeenCalled();expect(queue.complete).not.toHaveBeenCalled();
 });
});
