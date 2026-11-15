import {afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WorkerWorkAreas} from '../src/territory/work-areas.js';
const dirs:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
async function setup(cached=true){const dir=await mkdtemp(path.join(os.tmpdir(),'work-area-cache-'));dirs.push(dir);const data={fetchedAt:'2026-11-15T09:00:00.000Z',areas:[{id:'zone',name:'Zona salvata',color:'#9a8ad4',agentName:null,geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}}]};if(cached)await writeFile(path.join(dir,'work-areas.json'),JSON.stringify(data));return{dir,data};}
it('retains the authoritative polygon copy offline and identifies it as cached',async()=>{const{dir,data}=await setup();expect(await new WorkerWorkAreas(dir).read()).toEqual({...data,stale:true});});
it('shares simultaneous refreshes and keeps the last polygons when the server is unavailable',async()=>{const{dir,data}=await setup();const requests=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({message:'offline'}),{status:403,headers:{'content-type':'application/json'}}));const reader=new WorkerWorkAreas(dir,()=>({url:'http://127.0.0.1:54321',key:'test-key'}));const first=reader.read(true),second=reader.read(true);expect(first).toBe(second);expect(await first).toEqual({...data,stale:true});expect(requests).toHaveBeenCalledTimes(2);});
it('reports a first-load failure instead of inventing empty online zones',async()=>{const{dir}=await setup(false);vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({message:'offline'}),{status:403,headers:{'content-type':'application/json'}}));await expect(new WorkerWorkAreas(dir,()=>({url:'http://127.0.0.1:54321',key:'test-key'})).read()).rejects.toThrow('Zone online');});
