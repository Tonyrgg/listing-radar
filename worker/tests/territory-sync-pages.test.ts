import {it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {TerritoryStore} from '../src/territory/store.js';
import {TerritorySync,type TerritorySyncConfig} from '../src/territory/sync.js';
const config:TerritorySyncConfig={url:'https://approved.supabase.co',key:'fixture',workspaceId:'00000000-0000-4000-8000-000000000001',ownerId:'00000000-0000-4000-8000-000000000002',profileKind:'live',environment:'online'};
async function fixture(run:(sync:TerritorySync,rpc:ReturnType<typeof vi.fn>,store:TerritoryStore)=>Promise<void>){
 const dir=await mkdtemp(path.join(os.tmpdir(),'territory-sync-pages-'));try{
 const store=await TerritoryStore.open(dir,[]);const rpc=vi.fn();const sync=new TerritorySync(store,dir,config,{rpc} as never,config.url);await run(sync,rpc,store);
 }finally{await rm(dir,{recursive:true,force:true});}
}
const internal=(s:TerritorySync)=>s as unknown as {readChanges:(args:Record<string,string>,since:number)=>Promise<{revision:number;changes:unknown[]}|null>};
it('assembles recovery pages from one fixed revision and passes its cursor',async()=>fixture(async(sync,rpc)=>{
 const cursor={collection:'units',key:'one'};
 rpc.mockResolvedValueOnce({data:{revision:8,changes:[{collection:'units',key:'one',value:{}}],next:cursor}}).mockResolvedValueOnce({data:{revision:8,changes:[{collection:'units',key:'two',value:{}}],next:null}});
 expect(await internal(sync).readChanges({},0)).toMatchObject({revision:8,changes:[{key:'one'},{key:'two'}]});
 expect(rpc.mock.calls[1]![1]).toMatchObject({p_since:0,p_after:cursor,p_until:8});
}));
it('discards partial recovery when another device commits between pages',async()=>fixture(async(sync,rpc)=>{
 rpc.mockResolvedValueOnce({data:{revision:8,changes:[{collection:'units',key:'one'}],next:{collection:'units',key:'one'}}}).mockResolvedValueOnce({error:{code:'40001'}});
 expect(await internal(sync).readChanges({},0)).toBeNull();
}));
it('does not replace local data if the last recovery page fails',async()=>fixture(async(sync,rpc,store)=>{
 const before=store.read();rpc.mockResolvedValueOnce({data:{revision:8,changes:[{collection:'meta',key:'version',value:1}],next:{collection:'meta',key:'version'}}}).mockResolvedValueOnce({error:{code:'57014'}});
 await expect(sync.reconcile()).rejects.toThrow(/57014/);expect(store.read()).toEqual(before);
}));
it('refuses a repeated cursor instead of looping or applying duplicate pages',async()=>fixture(async(sync,rpc)=>{
 rpc.mockResolvedValue({data:{revision:8,changes:[{collection:'units',key:'one'}],next:{collection:'units',key:'one'}}});
 await expect(internal(sync).readChanges({},0)).rejects.toThrow(/Cursore/);expect(rpc).toHaveBeenCalledTimes(2);
}));
