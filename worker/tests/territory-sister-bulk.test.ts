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
  const bulk=new SisterBulk(app,store,()=>{},0);
  for(const s of streets)await bulk.put({streetId:s.id,search:{searchText:s.name,resultName:s.sisterName}});
  return {dir,streets,store,app,bulk};
}
it('adds a whole selection once, preserves existing searches and does not start a run',async()=>{
 const{bulk,store,app}=await fixture();
 await bulk.remove('2');
 await store.change(s=>{s.memories['2']!.sisterSearch={searchText:'GIOTT',resultName:'VIA GIOTTO'};s.streets.push({...s.streets[0]!,id:'outside',outsideUrbanArea:true});s.memories.outside={note:'',attention:false,updatedAt:new Date().toISOString()};});
 const before=bulk.list().entries[0];
 expect(await bulk.putMany(['1','2','2','outside'])).toEqual({added:1,alreadyQueued:1,excluded:['outside']});
 expect(bulk.list().entries.find(e=>e.streetId==='1')).toEqual(before);
 expect(bulk.list().entries.find(e=>e.streetId==='2')).toMatchObject({searchText:'GIOTT',resultName:'VIA GIOTTO',status:'ready'});
 expect(app.hasActiveRun).toBe(false);expect(store.read().runs).toHaveLength(0);
});
it('derives a visible provisional search from the official street name when none is saved',async()=>{
 const{bulk,store}=await fixture();await bulk.remove('2');await store.change(s=>{delete s.memories['2']!.sisterSearch;});
 await bulk.putMany(['2']);expect(bulk.list().entries.find(e=>e.streetId==='2')).toMatchObject({searchText:'GIOTTO',resultName:'VIA GIOTTO'});
});
it('can prepare a completed zone again while retaining all earlier acquisition runs',async()=>{
 const{bulk,store}=await fixture();bulk.start(async()=>{});await bulk.waitForIdle();const runs=store.read().runs;
 expect(await bulk.putMany(['1','2'])).toMatchObject({added:2,alreadyQueued:0});
 expect(store.read().runs).toEqual(runs);expect(bulk.list().entries.every(e=>e.status==='ready'&&!e.runId)).toBe(true);
});
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

it('recovers a stale running acquisition from another workstation with the same checkpoint',async()=>{
 const {bulk,store,app}=await fixture();
 await store.change(s=>{s.runs.push({id:'interrupted',streetId:'1',operation:'scan',origin:'simulation',state:'running',startedAt:new Date().toISOString(),endedAt:null,handled:0,total:null,itemKeys:[],error:null,checkpoint:{next:0},deviceId:'other-device'});s.memories['1']!.sisterQueue!.runId='interrupted';s.memories['1']!.sisterQueue!.status='paused';});
 const barrier=vi.fn(async()=>{});bulk.start(barrier);await bulk.waitForIdle();
 expect(barrier).toHaveBeenCalledTimes(4);expect(store.read().runs.filter(r=>r.streetId==='1').map(r=>r.id)).toEqual(['interrupted']);
 expect(bulk.list().entries.every(e=>e.status==='completed')).toBe(true);expect(app.hasActiveRun).toBe(false);
});
it('does not recover another workstation run until the online barrier succeeds',async()=>{
 const{bulk,store}=await fixture();await store.change(s=>{s.runs.push({id:'stale',streetId:'1',operation:'scan',origin:'simulation',state:'running',startedAt:'2026-11-15',endedAt:null,handled:0,total:null,itemKeys:[],error:null});s.memories['1']!.sisterQueue!.runId='stale';});
 bulk.start(async()=>{throw Error('Un altro PC sta lavorando');});await bulk.waitForIdle();expect(store.read().runs[0]!.state).toBe('running');expect(store.read().runs).toHaveLength(1);
});
it('retries a transient navigation failure automatically on the same run and checkpoint',async()=>{
 const{store}=await fixture();const provider=new SimulationProvider(store,0),original=provider.scan.bind(provider);let calls=0;
 provider.scan=async(...args)=>{if(++calls===1){await args[4]({next:2});throw Error('Timeout while navigating');}if(calls===2)expect(args[2]).toEqual({next:2});return original(...args);};
 const app=new TerritoryApplication(store,provider),bulk=new SisterBulk(app,store,()=>{},0);
 bulk.start(async()=>{});await bulk.waitForIdle();expect(calls).toBe(3);expect(store.read().runs).toHaveLength(2);expect(bulk.list().entries.every(e=>e.status==='completed')).toBe(true);
});
it('recovers a temporary sync interruption without requiring a manual restart',async()=>{
 const{store}=await fixture();const provider=new SimulationProvider(store,0),original=provider.scan.bind(provider);let calls=0;
 const app=new TerritoryApplication(store,provider),bulk=new SisterBulk(app,store,()=>{},0);
 provider.scan=async(...args)=>{if(++calls===1){await args[4]({next:2});app.pause('Salvataggio online non confermato (rete)');return false;}return original(...args);};
 bulk.start(async()=>{});await bulk.waitForIdle();expect(calls).toBe(3);expect(store.read().runs).toHaveLength(2);expect(bulk.list().entries.every(e=>e.status==='completed')).toBe(true);
});
it('limits retries and exposes the actual failure while preserving the queue',async()=>{
 const{store}=await fixture();const provider=new SimulationProvider(store,0),scan=vi.fn(async()=>{throw Error('Timeout connessione Sister');});provider.scan=scan;
 const bulk=new SisterBulk(new TerritoryApplication(store,provider),store,()=>{},0);bulk.start(async()=>{});await bulk.waitForIdle();
 expect(scan).toHaveBeenCalledTimes(3);expect(store.read().runs).toHaveLength(1);expect(bulk.list().entries.map(e=>e.status)).toEqual(['paused','ready']);expect(bulk.list().entries[0]!.error).toContain('Timeout');
});
it('does not retry a login failure or an explicit operator pause',async()=>{
 const{store}=await fixture();const provider=new SimulationProvider(store,0),scan=vi.fn(async():Promise<boolean>=>{throw Error('Sessione SISTER scaduta: accedi nuovamente');});provider.scan=scan;
 const app=new TerritoryApplication(store,provider),bulk=new SisterBulk(app,store,()=>{},0);bulk.start(async()=>{});await bulk.waitForIdle();expect(scan).toHaveBeenCalledOnce();
 scan.mockImplementation(async()=>{app.pause();return false;});bulk.start(async()=>{});await bulk.waitForIdle();expect(scan).toHaveBeenCalledTimes(2);expect(bulk.list().entries[1]!.status).toBe('ready');
});
it('keeps a completed street completed when its final online acknowledgement is retried',async()=>{
 const{bulk,store}=await fixture();let barriers=0;bulk.start(async()=>{if(++barriers===2)throw Error('Salvataggio online non confermato');});await bulk.waitForIdle();
 expect(store.read().runs).toHaveLength(2);expect(bulk.list().entries.every(e=>e.status==='completed'&&!e.error)).toBe(true);
});

it('preserves the navigation failure reported inside a paused scan checkpoint',async()=>{
 const{store}=await fixture();const provider=new SimulationProvider(store,0),original=provider.scan.bind(provider);let calls=0;
 provider.scan=async(...args)=>{if(++calls===1){await args[4]({next:2,results:[{outcome:'failed',warnings:['Navigation timeout 20000ms']} ]});return false;}return original(...args);};
 const bulk=new SisterBulk(new TerritoryApplication(store,provider),store,()=>{},0);bulk.start(async()=>{});await bulk.waitForIdle();
 expect(calls).toBe(3);expect(store.read().runs).toHaveLength(2);expect(bulk.list().entries.every(e=>e.status==='completed')).toBe(true);
});

function finishedWithAnomalies(){return {status:'completed',lastError:null,updatedAt:'2026-11-15T16:38:41Z',currentVariantIndex:1,results:[{outcome:'found',recordLedger:Array.from({length:6},(_,i)=>({index:i+1,key:`BITONTO|1|2|${i+1}`,label:`Riga ${i+1}`,status:'completed_with_anomalies',anomaly:'Intestatario non interpretabile',completedAt:'2026-11-15T16:38:41Z',ownerNames:[]}))}]};}
it('finishes a traversed street with row anomalies and continues to the next street',async()=>{
 const{store}=await fixture();const provider=new SimulationProvider(store,0),original=provider.scan.bind(provider);let calls=0;
 provider.scan=async(...args)=>{if(++calls===1){await args[4](finishedWithAnomalies());return false;}return original(...args);};
 const bulk=new SisterBulk(new TerritoryApplication(store,provider),store,()=>{},0);bulk.start(async()=>{});await bulk.waitForIdle();
 expect(calls).toBe(2);expect(bulk.list().entries.map(e=>e.status)).toEqual(['completed','completed']);expect(bulk.list().entries[0]!.anomalies).toBe(6);
 expect(Object.values(store.read().quarantine!).filter(q=>!q.resolvedAt&&q.runId===store.read().runs.find(r=>r.streetId==='1')!.id)).toHaveLength(6);
});
it('recovers the observed false paused state with 401 saved properties and six anomalies without rescanning',async()=>{
 const{store}=await fixture();await store.change(s=>{s.runs.push({id:'saved-run',streetId:'1',operation:'scan',origin:'simulation',state:'paused',handled:401,total:null,itemKeys:[],startedAt:'2026-11-15T12:00:00Z',endedAt:null,error:'Lettura SISTER interrotta',checkpoint:finishedWithAnomalies()});Object.assign(s.memories['1']!.sisterQueue!,{runId:'saved-run',status:'paused'});});
 const provider=new SimulationProvider(store,0),scan=vi.spyOn(provider,'scan'),bulk=new SisterBulk(new TerritoryApplication(store,provider),store,()=>{},0);
 bulk.start(async()=>{});await bulk.waitForIdle();expect(scan).toHaveBeenCalledOnce();expect(scan.mock.calls[0]![0].id).toBe('2');
 expect(store.read().runs[0]).toMatchObject({id:'saved-run',handled:401,state:'completed'});expect(bulk.list().entries.every(e=>e.status==='completed')).toBe(true);
 expect(Object.values(store.read().quarantine!).filter(q=>!q.resolvedAt&&q.runId===store.read().runs.find(r=>r.streetId==='1')!.id)).toHaveLength(6);
});
