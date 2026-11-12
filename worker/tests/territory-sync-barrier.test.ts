import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {TerritoryStore} from '../src/territory/store.js';
import {TerritoryApplication} from '../src/territory/application.js';
import {SimulationProvider} from '../src/territory/providers.js';
import type {Street} from '../src/territory/model.js';
it('stops before the next CRM item when the online acknowledgement fails, retaining the first success',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'territory-sync-barrier-'));
 try{
  const street:Street={id:'123',name:'Via di prova',sisterName:'VIA DI PROVA',locality:'Bitonto',geometry:null,geometryEvidence:null,needsReview:false};
  const store=await TerritoryStore.open(directory,[street]);const provider=new SimulationProvider(store,0);
  const prepare=new TerritoryApplication(store,provider);
  await prepare.start(street.id,'scan');await prepare.waitForIdle();
  let barriers=0;
  const app=new TerritoryApplication(store,provider,()=>{},0,async()=>{barriers++;if(barriers===2)throw Error('Salvataggio online non confermato');});
  const keys=app.detail(street.id).units.slice(0,2).map(u=>u.key);
  await app.start(street.id,'apply',keys);await app.waitForIdle();
  expect(barriers).toBe(2);
  const state=store.read(),run=state.runs.at(-1)!;
  expect(run.state).toBe('stopped');expect(run.error).toMatch(/online non confermato/);
  expect(run.imports?.[keys[0]!]?.crmId).toBeTruthy();expect(run.imports?.[keys[1]!]).toBeUndefined();
 }finally{await rm(directory,{recursive:true,force:true});}
});
