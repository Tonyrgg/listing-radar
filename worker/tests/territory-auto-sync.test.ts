import {it,expect,vi,afterEach} from 'vitest';
import {TerritorySyncLoop} from '../src/territory/sync-loop.js';
afterEach(()=>vi.useRealTimers());
it('sends changes promptly and retries failed exchanges automatically',async()=>{
 vi.useFakeTimers();const exchange=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(undefined);
 const loop=new TerritorySyncLoop(exchange);
 loop.changed();await vi.advanceTimersByTimeAsync(100);expect(exchange).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(3000);expect(exchange).toHaveBeenCalledTimes(2);loop.stop();
});
it('automatically sends changes committed during an in-flight acknowledgement',async()=>{
 vi.useFakeTimers();let resolve!:()=>void;
 const exchange=vi.fn().mockImplementationOnce(()=>new Promise<void>(r=>{resolve=r;})).mockResolvedValue(undefined);
 const loop=new TerritorySyncLoop(exchange);loop.changed();await vi.advanceTimersByTimeAsync(100);
 loop.changed();resolve();await vi.advanceTimersByTimeAsync(100);
 expect(exchange).toHaveBeenCalledTimes(2);loop.stop();
});
