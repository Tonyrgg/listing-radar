import {describe,it,expect,vi,afterEach} from 'vitest';
import {TerritoryOperationLease,assertSynchronized} from '../src/territory/operation-lease.js';
afterEach(()=>vi.useRealTimers());
describe('single working workstation',()=>{
 it('requires a successful sync without pending changes or conflicts',()=>{expect(()=>assertSynchronized({},'Offline')).toThrow('Offline');expect(()=>assertSynchronized({pending:true},null)).toThrow();expect(()=>assertSynchronized({conflicts:[{}]},null)).toThrow();expect(()=>assertSynchronized({pending:false,conflicts:[]},null)).not.toThrow();});
 it('refuses a second workstation',async()=>{const db={rpc:vi.fn().mockResolvedValue({data:{acquired:false,reason:'Other PC'},error:null})};const lease=new TerritoryOperationLease(db as never,'w','o','d');await expect(lease.acquire(()=>{})).rejects.toThrow('Other PC');expect(lease.held).toBe(false);});
 it('pauses on heartbeat loss and retains the reservation until acknowledged release',async()=>{vi.useFakeTimers();const lost=vi.fn();const db={rpc:vi.fn().mockResolvedValueOnce({data:{acquired:true},error:null}).mockResolvedValueOnce({data:false,error:null}).mockResolvedValueOnce({data:false,error:null}).mockResolvedValueOnce({data:true,error:null})};const lease=new TerritoryOperationLease(db as never,'w','o','d');await lease.acquire(lost);await vi.advanceTimersByTimeAsync(20000);expect(lost).toHaveBeenCalledOnce();expect(lease.held).toBe(true);await expect(lease.release(1)).rejects.toThrow();await lease.release(2);expect(lease.held).toBe(false);});
});
