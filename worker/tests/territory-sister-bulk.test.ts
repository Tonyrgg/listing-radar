import {afterEach, expect, it, vi} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TerritoryStore} from '../src/territory/store.js';
import {TerritoryApplication} from '../src/territory/application.js';
import {SimulationProvider} from '../src/territory/providers.js';
import {SisterBulk} from '../src/territory/sister-bulk.js';
import {syncRecords,recordsState} from '../src/territory/sync-records.js';
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function fixture(){
  const dir=await mkdtemp(path.join(os.tmpdir(),'sister-bulk-'));dirs.push(dir);
  const streets=['Gorizia','Giotto'].map((name,i)=>({id:String(i+1),name:`Via ${name}`,sisterName:`VIA ${name.toUpperCase()}`,locality:'Bitonto',geometry:null,geometryEvidence:null,needsReview:false}));
  const store=await TerritoryStore.open(dir,streets), app=new TerritoryApplication(store,new SimulationProvider(store,0));
  const bulk=new SisterBulk(app,store,()=>{});
  for(const s of streets)await bulk.put({streetId:s.id,search:{searchText:s.name,resultName:s.sisterName}});
  return {dir,streets,store,app,bulk};
}
it('executes streets sequentially, preserves acknowledged completions and syncs the queue',async()=>{
  const {bulk,store,app}=await fixture();
  const barrier=vi.fn(async()=>{});
  bulk.start(barrier);expect(app.hasActiveRun).toBe(true);
  await app.waitForIdle();
  expect(bulk.list().entries.map(e=>e.status)).toEqual(['completed','completed']);
  expect(store.read().runs).toHaveLength(2);
  expect(barrier).toHaveBeenCalledTimes(4);
  expect(()=>bulk.start(barrier)).toThrow();
  const remote=recordsState(syncRecords(store.read()));
  expect(remote.memories['1']!.sisterQueue?.status).toBe('completed');
  expect(app.hasActiveRun).toBe(false);
});
it('stops at a failed sync barrier without starting Sister or losing remaining streets',async()=>{
  const {bulk,store}=await fixture();
  bulk.start(async()=>{throw Error('Online non confermato');});await bulk.waitForIdle();
  expect(store.read().runs).toHaveLength(0);
  expect(bulk.list().entries.map(e=>e.status)).toEqual(['paused','ready']);
  bulk.start(async()=>{});await bulk.waitForIdle();
  expect(bulk.list().entries.every(e=>e.status==='completed')).toBe(true);
});
it('honours a pause between streets and resumes only unfinished work after reopening',async()=>{
  const {bulk,app,store,dir,streets}=await fixture();let calls=0;
  bulk.start(async()=>{if(++calls===2)app.pause();});await bulk.waitForIdle();
  expect(store.read().runs).toHaveLength(1);
  const reopened=await TerritoryStore.open(dir,streets);
  const next=new SisterBulk(new TerritoryApplication(reopened,new SimulationProvider(reopened,0)),reopened,()=>{});
  next.start(async()=>{});await next.waitForIdle();
  expect(reopened.read().runs).toHaveLength(2);
  expect(next.list().entries.every(e=>e.status==='completed')).toBe(true);
});
it('rejects ambiguous inputs and blocks edits while running',async()=>{
  const {bulk}=await fixture();
  await expect(bulk.put({streetId:'1',search:{searchText:'',resultName:'VIA GORIZIA'}})).rejects.toThrow();
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  bulk.start(()=>gate);
  await expect(bulk.remove('1')).rejects.toThrow();
  bulk.pause();release();await bulk.waitForIdle();
  expect(bulk.list().entries.every(e=>e.status==='ready')).toBe(true);
});
it('resumes the same checkpoint after a partial scan and rejects parallel manual runs',async()=>{
  const {bulk,store,app}=await fixture();
  const provider = new SimulationProvider(store,0);
  const original=provider.scan.bind(provider);let interrupt=true;
  provider.scan=async (...args)=>{if(interrupt){interrupt=false;await args[4]({next:3});return false;}return original(...args);};
  const resumableApp=new TerritoryApplication(store,provider), queue=new SisterBulk(resumableApp,store,()=>{});
  queue.start(async()=>{});await queue.waitForIdle();
  const runId=store.read().runs[0]!.id;
  expect(store.read().memories['1']!.sisterQueue!.runId).toBe(runId);
  expect(store.read().runs[0]!.state).toBe('paused');
  queue.start(async()=>{});
  await expect(resumableApp.start('2','scan')).rejects.toThrow();
  await queue.waitForIdle();
  expect(store.read().runs.filter(r=>r.streetId==='1').map(r=>r.id)).toEqual([runId]);
  expect(queue.list().entries.every(e=>e.status==='completed')).toBe(true);
});
