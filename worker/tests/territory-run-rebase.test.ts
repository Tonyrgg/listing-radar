import {expect,it} from 'vitest';
import {mergeTerritory,recordsState} from '../src/territory/sync-records.js';
import type {Run} from '../src/territory/model.js';
const seed=():Run=>({id:'r',streetId:'s',operation:'scan',origin:'live',state:'running',deviceId:'one',startedAt:'2026-11-15T10:00:00Z',endedAt:null,handled:401,total:null,itemKeys:[],error:null,checkpoint:{updatedAt:'2026-11-15T11:00:00Z',cursor:401}});
function fixture(){const base=recordsState(new Map());base.runs=[seed()];return{base,local:structuredClone(base),remote:structuredClone(base)};}
it('retains a local pause when the remote run is unchanged at the same handled count',()=>{
 const{base,local,remote}=fixture();local.runs[0]!.state='paused';local.runs[0]!.error='Rete';
 expect(mergeTerritory(base,local,remote,'server').runs[0]).toEqual(local.runs[0]);
});
it('retains a newer row checkpoint without requiring another property to complete',()=>{
 const{base,local,remote}=fixture();local.runs[0]!.checkpoint={updatedAt:'2026-11-15T11:01:00Z',cursor:402};
 expect(mergeTerritory(base,local,remote,'server').runs[0]!.checkpoint).toEqual(local.runs[0]!.checkpoint);
 expect(mergeTerritory(base,remote,local,'server').runs[0]!.checkpoint).toEqual(local.runs[0]!.checkpoint);
});
it('resumes a paused run on a different device without an older ended flag winning',()=>{
 const{base,local,remote}=fixture();Object.assign(base.runs[0]!,{state:'paused',endedAt:'2026-11-15T11:00:00Z'});remote.runs=structuredClone(base.runs);
 Object.assign(local.runs[0]!,{deviceId:'two',progressRevision:2,updatedAt:'2026-11-15T12:00:00Z'});
 expect(mergeTerritory(base,local,remote,'server').runs[0]!.state).toBe('running');
});
it('uses progress revision for genuinely concurrent copies while preserving import facts',()=>{
 const{base,local,remote}=fixture();Object.assign(local.runs[0]!,{progressRevision:3,state:'paused'});Object.assign(remote.runs[0]!,{progressRevision:2,waiting:'old'});
 expect(mergeTerritory(base,local,remote,'server').runs[0]!.state).toBe('paused');
});

it('never reopens a completed acquisition from a stale running copy',()=>{
 const{base,local,remote}=fixture();Object.assign(remote.runs[0]!,{state:'completed',endedAt:'2026-11-15T12:00:00Z'});base.runs=structuredClone(remote.runs);
 Object.assign(local.runs[0]!,{progressRevision:100,updatedAt:'2026-11-15T13:00:00Z'});
 expect(mergeTerritory(base,local,remote,'server').runs[0]!.state).toBe('completed');
});
