import {afterEach,describe,expect,it,vi}from'vitest';
import {mkdtemp,rm}from'node:fs/promises';
import os from'node:os';import path from'node:path';
import {TerritoryStore}from'../src/territory/store.js';
import {TerritoryApplication}from'../src/territory/application.js';
import {SimulationProvider}from'../src/territory/providers.js';
import {runActivitySummary}from'../src/territory/activity-plan.js';
import {ImportV2Error}from'../src/import-v2/errors.js';
import type{Street}from'../src/territory/model.js';
import type{ActivityWriteGuard}from'../src/import-v2/activity-write-guard.js';
const street:Street={id:'one',name:'Via di prova',sisterName:'VIA DI PROVA',locality:'Bitonto',geometry:null,geometryEvidence:null,needsReview:false};
const dirs:string[]=[];
afterEach(async()=>{vi.useRealTimers();for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
async function setup(){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
 const dir=await mkdtemp(path.join(os.tmpdir(),'worker-calendar-'));dirs.push(dir);
 const store=await TerritoryStore.open(dir,[street]),provider=new SimulationProvider(store,0),app=new TerritoryApplication(store,provider);
 await app.start(street.id,'scan');await app.waitForIdle();
 const keys=app.detail(street.id).units.filter(u=>['1','2'].includes(u.source.cadastral.subaltern)).map(u=>u.key);
 return{store,app,provider,keys};
}
describe('activity-driven queue results',()=>{
 it('skips an unchanged person save while keeping every property and activity verification',async()=>{
  const{store,keys}=await setup();let saves=0;
  class CountWrites extends SimulationProvider{override async port(){const port=await super.port(),overwrite=port.overwritePerson.bind(port);port.overwritePerson=async(...args)=>{saves++;return overwrite(...args);};return port;}}
  const app=new TerritoryApplication(store,new CountWrites(store,0));await app.enqueue(keys);await app.startQueue(keys,{activityMode:'plain'});await app.waitForIdle();
  expect(saves).toBe(1);expect(Object.keys(store.read().runs.at(-1)!.imports??{})).toHaveLength(2);
 });
 it('updates new contact data even when no second activity is required for that client',async()=>{
  const{store,app,keys}=await setup();const source=app.unitDetail(keys[1]!).source;
  await app.correct(keys[1]!,{owners:source.owners.map(owner=>({...owner,contacts:{phones:['3331234567'],emails:[]}}))},'');
  await app.enqueue(keys);await app.startQueue(keys,{activityMode:'plain'});await app.waitForIdle();
  expect(Object.values(store.read().virtualPeople)[0]?.phones).toContain('3331234567');
  expect(Object.values(store.read().virtualActivities??{})).toHaveLength(1);
 });
 it('reserves the shared client before the write, marks submission after a durable checkpoint and confirms after CRM readback',async()=>{
  const{store,keys}=await setup();const events:string[]=[];
  const guard:ActivityWriteGuard={reserve:async()=>{events.push('reserve');return{granted:true,submitted:false,proof:null};},
   submitted:async()=>{expect(Object.values(store.read().checkpoints).some(cp=>cp.activityWrite?.submittedAt)).toBe(true);events.push('submitted');},
   confirm:async(_claim,proof)=>{expect(Object.values(store.read().virtualActivities??{})).toHaveLength(1);expect(proof.createdAt).toBe('2026-11-10');events.push('confirm');},release:async()=>{events.push('release');}};
  class Guarded extends SimulationProvider{activityWriteGuard=()=>guard;}
  const app=new TerritoryApplication(store,new Guarded(store,0));await app.enqueue(keys);await app.startQueue(keys,{activityMode:'plain'});await app.waitForIdle();
  expect(events).toEqual(['reserve','submitted','confirm']);expect(Object.values(store.read().virtualActivities??{})).toHaveLength(1);
 });
 it('does not create an activity claimed by another workstation',async()=>{
  const{store,keys}=await setup();
  const guard:ActivityWriteGuard={reserve:async()=>({granted:false,submitted:true,proof:null}),submitted:async()=>{throw Error('unexpected write');},confirm:async()=>{},release:async()=>{}};
  class Guarded extends SimulationProvider{activityWriteGuard=()=>guard;}
  const app=new TerritoryApplication(store,new Guarded(store,0));await app.enqueue(keys);await app.startQueue(keys,{activityMode:'plain'});await app.waitForIdle();
  expect(Object.values(store.read().virtualActivities??{})).toHaveLength(0);expect(Object.keys(store.read().runs.at(-1)!.imports??{})).toHaveLength(0);
 });
 it('uses a confirmed Task from another workstation as daily coverage without inserting another one',async()=>{
  const{store,keys}=await setup();
  const guard:ActivityWriteGuard={reserve:async()=>({granted:false,submitted:true,proof:{id:'00T000000000001AAA',propertyId:'remote-property',clientId:Object.values(store.read().virtualPeople)[0]!.id,
   description:'',status:'Eseguito',activityDate:null,createdAt:'2026-11-10'}}),submitted:async()=>{},confirm:async()=>{},release:async()=>{}};
  class Guarded extends SimulationProvider{activityWriteGuard=()=>guard;}
  const app=new TerritoryApplication(store,new Guarded(store,0));await app.enqueue([keys[0]!]);await app.startQueue([keys[0]!],{activityMode:'plain'});await app.waitForIdle();
  expect(Object.values(store.read().virtualActivities??{})).toHaveLength(0);expect(runActivitySummary(store.read(),store.read().runs.at(-1)!)).toMatchObject({coveredClient:1,created:0});
 });
 it('updates both properties and their owners but inserts only one activity for their client',async()=>{
  const{store,app,keys}=await setup();await app.enqueue(keys);
  expect(app.previewQueueActivities(keys,{activityMode:'plain'})).toMatchObject({properties:2,candidateActivities:1,consolidated:1});
  await app.startQueue(keys,{activityMode:'plain'});await app.waitForIdle();
  const state=store.read(),run=state.runs.at(-1)!;
  expect(run.imports&&Object.keys(run.imports)).toHaveLength(2);
  expect(Object.values(state.virtualActivities??{})).toHaveLength(1);
  expect(runActivitySummary(state,run)).toMatchObject({created:1,coveredClient:1,coveredProperty:0,unconfirmed:0});
  expect(keys.every(key=>Boolean(state.units[key]!.crmId))).toBe(true);
  expect(Object.keys(state.importQueue??{})).toHaveLength(0);
 });
 it('still verifies all co-owner links when an activity is covered',async()=>{
  const{store,app,keys}=await setup();const unit=app.unitDetail(keys[1]!);
  await app.correct(keys[1]!,{owners:[...unit.source.owners,{...unit.source.owners[0]!,sourcePersonId:'second-owner',taxCode:'VRDLCU82B02A893X',fullName:'Verdi Luca',sharePercentage:30}]},'');
  await app.enqueue(keys);await app.startQueue(keys,{activityMode:'plain',includeCoOwners:true});await app.waitForIdle();
  const state=store.read();expect(state.virtualCrm[state.units[keys[1]!]!.crmId!]!.owners).toHaveLength(2);
  expect(Object.values(state.virtualActivities??{})).toHaveLength(1);
 });
 it('covers an activity earlier this month but creates a new one after the month changes',async()=>{
  const{store,app,keys}=await setup();const key=keys[0]!;
  await app.enqueue([key]);await app.startQueue([key],{activityMode:'plain'});await app.waitForIdle();
  vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
  await app.enqueue([key]);await app.startQueue([key],{activityMode:'plain'});await app.waitForIdle();
  expect(runActivitySummary(store.read(),store.read().runs.at(-1)!)).toMatchObject({created:0,coveredProperty:1});
  expect(Object.values(store.read().virtualActivities??{})).toHaveLength(1);
  vi.setSystemTime(new Date('2026-12-01T10:00:00Z'));
  await app.enqueue([key]);await app.startQueue([key],{activityMode:'plain'});await app.waitForIdle();
  expect(Object.values(store.read().virtualActivities??{})).toHaveLength(2);
 });
 it('defers an incomplete CRM activity read once without creating or counting a success',async()=>{
  const{store,keys}=await setup();let reads=0;
  class PartialHistory extends SimulationProvider{override async port(){const port=await super.port();port.readActivityHistory=async()=>{reads++;return{records:[],propertyComplete:false,clientComplete:true,checkedAt:new Date().toISOString()};};return port;}}
  const app=new TerritoryApplication(store,new PartialHistory(store,0));await app.enqueue([keys[0]!]);await app.startQueue([keys[0]!],{activityMode:'plain'});await app.waitForIdle();
  expect(reads).toBe(1);expect(Object.keys(store.read().runs.at(-1)!.imports??{})).toHaveLength(0);
  expect(Object.values(store.read().virtualActivities??{})).toHaveLength(0);expect(Object.keys(store.read().importQueue??{})).toHaveLength(1);
 });
 it('blocks another property of the client after an uncertain save, even when CRM temporarily hides it',async()=>{
  const{store,keys}=await setup();
  class LostResponse extends SimulationProvider{override async port(){const port=await super.port();port.readActivityHistory=async()=>({records:[],propertyComplete:true,clientComplete:true,checkedAt:new Date().toISOString()});
    port.ensureActivity=async(_id,_plan,request)=>{if(request){request.state={...request.state,submittedAt:new Date().toISOString()};await request.persist(request.state);}throw new ImportV2Error('Salvataggio da verificare','verification_failed');};return port;}}
  const app=new TerritoryApplication(store,new LostResponse(store,0));await app.enqueue(keys);await app.startQueue(keys,{activityMode:'plain'});await app.waitForIdle();
  const checkpoints=Object.values(store.read().checkpoints);expect(checkpoints.filter(cp=>cp.activityWrite?.submittedAt)).toHaveLength(1);
  expect(Object.keys(store.read().runs.at(-1)!.imports??{})).toHaveLength(0);
 });
});
