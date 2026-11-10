import {describe,it,expect} from 'vitest';
import {activityCoverage,activityDay,planActivityCandidates,romeDay,validActivityCoverage} from '../src/import-v2/activity-policy.js';
import {activityTaskFragments,mergeTaskFragment,savedActivityIds,taskSnapshot} from '../src/import-v2/activity-records.js';
import type {CrmActivitySnapshot,CrmActivityHistory} from '../src/import-v2/model.js';
import {simulationSource} from '../src/territory/providers.js';
import type {Street} from '../src/territory/model.js';
const property='a0V000000000001AAA',otherProperty='a0V000000000002AAA',client='001000000000001AAA';
const task:CrmActivitySnapshot={id:'00T000000000001AAA',propertyId:property,clientId:client,status:'Eseguito',description:'Descrizione diversa dal nuovo lavoro',activityDate:'2026-11-03',createdAt:'2026-11-03T09:00:00Z'};
const now=new Date('2026-11-10T12:00:00Z');
const history=(records:CrmActivitySnapshot[]):CrmActivityHistory=>({records,propertyComplete:true,clientComplete:true,checkedAt:now.toISOString()});
describe('calendar rules for property and customer activities',()=>{
 it.each(['Eseguito','Da eseguire','Completed','Not Started'])('accepts any current-month activity with status %s on the exact property',status=>{
   const proof=activityCoverage(history([{...task,status}]),property,client,now);
   expect(proof).toMatchObject({outcome:'covered',activityId:task.id,coverage:{kind:'property_month'}});
   expect(validActivityCoverage(proof,property)).toBe(true);
 });
 it('uses calendar months, not a rolling thirty-day interval',()=>{
   expect(activityCoverage(history([{...task,activityDate:'2026-11-30',createdAt:'2026-10-31T10:00:00Z'}]),property,client,new Date('2026-11-01T10:00:00Z'))).toBeNull();
 });
 it('allows one customer activity on another property in the same local day',()=>{
   const proof=activityCoverage(history([{...task,propertyId:otherProperty,activityDate:'2026-12-10',createdAt:'2026-11-10T10:00:00Z'}]),property,client,now);
   expect(proof?.coverage?.kind).toBe('client_day');expect(validActivityCoverage(proof,property)).toBe(true);
 });
 it.each([
   {...task,propertyId:otherProperty,createdAt:'2026-11-09T10:00:00Z'},
   {...task,propertyId:otherProperty,clientId:'001000000000002AAA',createdAt:'2026-11-10T10:00:00Z'},
   {...task,propertyId:client,createdAt:'2026-11-10T10:00:00Z'},
   {...task,propertyId:property,status:'Cancelled'},
   {...task,propertyId:null,activityDate:'2026-11-10'},
 ])('does not apply a different day, client, object, cancelled activity or missing property',row=>{
   expect(activityCoverage(history([row]),property,client,now)).toBeNull();
 });
 it('converts timestamps using Rome including local midnight and daylight saving',()=>{
   expect(romeDay(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
   expect(activityDay({...task,activityDate:null,createdAt:'2026-07-09T22:30:00Z'})).toBe('2026-07-10');
   expect(activityDay({...task,activityDate:'2026-11-10',createdAt:'2026-10-01T10:00:00Z'})).toBe('2026-10-01');
   expect(activityDay({...task,createdAt:null})).toBeNull();
 });
 it.each(['2026-13-01','2026-02-31','10/11/2026','2026-11-10T12:00:00'])('does not guess malformed or timezone-free dates %s',date=>{
   expect(activityDay({...task,createdAt:date})).toBeNull();
 });
 it('uses positive proof from partial history but never interprets missing rows as an existing activity',()=>{
   expect(activityCoverage({...history([task]),propertyComplete:false,clientComplete:false},property,client,now)?.outcome).toBe('covered');
   expect(activityCoverage({...history([]),propertyComplete:false},property,client,now)).toBeNull();
 });
 it('rejects stale or wrong-property coverage proof',()=>{
   const proof=activityCoverage(history([task]),property,client,now)!;
   expect(validActivityCoverage(proof,otherProperty)).toBe(false);
   proof.coverage!.checkedAt='2026-12-01T10:00:00Z';expect(validActivityCoverage(proof,property)).toBe(false);
 });
 it('consolidates three properties of the same principal into one activity without dropping properties',()=>{
   const street={id:'one',name:'VIA PROVA',sisterName:'VIA PROVA',locality:'Bitonto',geometry:null,geometryEvidence:null,needsReview:false}as Street;
   const sources=[1,2,3].map(n=>{const source=simulationSource(street,n,'job');source.activity.enabled=true;return source;});
   expect(planActivityCandidates(sources)).toMatchObject({properties:3,candidateActivities:1,consolidated:2});
   sources[1]!.owners[0]!.sharePercentage=40;
   sources[1]!.owners.push({...sources[1]!.owners[0]!,sourcePersonId:'other',taxCode:'VRDLCU82B02A893X',sharePercentage:60});
   expect(planActivityCandidates(sources).candidateActivities).toBe(2);
 });
});
describe('persisted CRM Task fields',()=>{
 it('combines complementary fields only for the same Task ID and reads UI API values',()=>{
   const fragments=activityTaskFragments(JSON.stringify([{Id:task.id,WhatId:property,Description:'Non vende'},
     {id:task.id,apiName:'Task',fields:{AccountId:{value:client},Status:{value:'Completed',displayValue:'Eseguito'},ActivityDate:{value:'2026-11-10'},CreatedDate:{value:'2026-11-10T10:00:00Z'}}}]));
   const map=new Map();fragments.forEach(f=>mergeTaskFragment(map,f));
   expect(taskSnapshot(map.get(task.id.slice(0,15)))).toMatchObject({propertyId:property,clientId:client,status:'Completed',activityDate:'2026-11-10'});
 });
 it('uses the actual metadata label for a custom Cliente field and never OwnerId',()=>{
   const body={objectInfo:{fields:{Customer__c:{apiName:'Customer__c',label:'Cliente'}}},record:{Id:task.id,WhatId:property,Customer__c:client,OwnerId:'005000000000001AAA',Status:'Eseguito',ActivityDate:'2026-11-10'}};
   expect(activityTaskFragments(JSON.stringify(body))[0]?.clientId).toBe(client);
   delete (body.record as Record<string,unknown>).Customer__c;
   expect(activityTaskFragments(JSON.stringify(body))[0]?.clientId).toBeUndefined();
 });
 it('does not combine unrelated Tasks or contradictory relations',()=>{
   const map=new Map();
   for(const f of activityTaskFragments(JSON.stringify([{Id:task.id,WhatId:property},{Id:task.id,WhatId:otherProperty,AccountId:client,Status:'Eseguito',ActivityDate:'2026-11-10'}])))mergeTaskFragment(map,f);
   expect(taskSnapshot(map.get(task.id.slice(0,15)))).toBeNull();
 });
 it('captures a successful save ID as a candidate and ignores error/menu payloads',()=>{
   expect(savedActivityIds(JSON.stringify({actions:[{state:'SUCCESS',returnValue:task.id}]}))).toEqual([task.id]);
   expect(savedActivityIds(JSON.stringify({actions:[{state:'ERROR',returnValue:task.id}]}))).toEqual([]);
   expect(savedActivityIds(JSON.stringify({Id:task.id,menu:'Task'}))).toEqual([]);
 });
});
