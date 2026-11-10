import {sameCrmRecordId} from '../core/crm-record-id.js';
import type {ActivityEvidence,CrmActivitySnapshot,CrmActivityHistory,ImportV2Checkpoint,SourceOwner,SourceProperty} from './model.js';

export const ACTIVITY_TIME_ZONE='Europe/Rome';
export function activityPrimaryOwner(owners:SourceOwner[]):SourceOwner{
  const result=owners.map((owner,index)=>({owner,index})).sort((a,b)=>(b.owner.sharePercentage??-1)-(a.owner.sharePercentage??-1)||a.index-b.index)[0]?.owner;
  if(!result)throw Error('Immobile senza intestatario principale');
  return result;
}
export function romeDay(now:Date):string{
  if(!Number.isFinite(now.getTime()))throw Error('Data attività non valida');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:ACTIVITY_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(name:string)=>parts.find(p=>p.type===name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function activityDay(row:Pick<CrmActivitySnapshot,'activityDate'|'createdAt'>):string|null{
  // CreatedDate is insertion time. ActivityDate is a due date and cannot prove
  // when the activity was inserted, even when it appears in the timeline.
  const value=row.createdAt;
  if(!value)return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value)){const date=new Date(`${value}T00:00:00Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;}
  if(!/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))return null;
  const date=new Date(value);return Number.isFinite(date.getTime())?romeDay(date):null;
}
export function activityStatus(value:string):'Da eseguire'|'Eseguito'|null{
  const status=value.trim().replace(/\s+/g,' ').toUpperCase();
  return ['DA ESEGUIRE','NOT STARTED'].includes(status)?'Da eseguire':['ESEGUITO','COMPLETED'].includes(status)?'Eseguito':null;
}
const samePropertyObject=(actual:string,expected:string)=>!/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(expected)||actual.slice(0,3)===expected.slice(0,3);

/** Positive coverage needs a persisted Task, an explicit relation and a real date.
 * Missing/incomplete history never proves permission to insert. */
export function activityCoverage(history:CrmActivityHistory,propertyId:string,clientId:string,now:Date):ActivityEvidence|null{
  const day=romeDay(now),month=day.slice(0,7);
  const usable=history.records.filter(r=>r.id&&r.propertyId&&activityStatus(r.status)&&activityDay(r));
  const property=usable.find(r=>sameCrmRecordId(r.propertyId!,propertyId)&&activityDay(r)!.slice(0,7)===month);
  const client=usable.find(r=>r.clientId&&sameCrmRecordId(r.clientId,clientId)&&samePropertyObject(r.propertyId!,propertyId)&&activityDay(r)===day);
  const row=property??client;if(!row)return null;
  return {outcome:'covered',activityId:row.id,coverage:{kind:property?'property_month':'client_day',
    propertyId:row.propertyId!,clientId:row.clientId,activityDay:activityDay(row)!,status:activityStatus(row.status)!,
    targetPropertyId:propertyId,targetClientId:clientId,checkedAt:now.toISOString()}};
}
export function validActivityCoverage(evidence:ActivityEvidence|null|undefined,propertyId:string):boolean{
  const proof=evidence?.coverage;
  if(evidence?.outcome!=='covered'||!evidence.activityId||!proof||!sameCrmRecordId(proof.targetPropertyId,propertyId)||!activityStatus(proof.status))return false;
  const date=new Date(proof.checkedAt);if(!Number.isFinite(date.getTime()))return false;
  const day=romeDay(date);
  if(activityDay({createdAt:proof.activityDay,activityDate:null})!==proof.activityDay)return false;
  return proof.kind==='property_month'?sameCrmRecordId(proof.propertyId,propertyId)&&proof.activityDay.slice(0,7)===day.slice(0,7)
    :Boolean(proof.clientId&&sameCrmRecordId(proof.clientId,proof.targetClientId)&&proof.propertyId&&samePropertyObject(proof.propertyId,propertyId)&&proof.activityDay===day);
}
export function verifiedActivityFacts(checkpoints:ImportV2Checkpoint[]):CrmActivitySnapshot[]{
  return checkpoints.flatMap(checkpoint=>{
    const e=checkpoint.activityEvidence;
    if(!e||!e.activityId)return [];
    if(e.outcome==='covered'&&checkpoint.crmPropertyId&&validActivityCoverage(e,checkpoint.crmPropertyId)){
      const p=e.coverage!;return [{id:e.activityId,propertyId:p.propertyId,clientId:p.clientId,activityDate:null,createdAt:p.activityDay,status:p.status,description:''}];
    }
    if(!['created','existing'].includes(e.outcome)||e.descriptionVerified!==true||e.statusVerified!==true||!e.propertyId||!e.clientId||!e.activityDay||!e.expectedStatus)return [];
    return [{id:e.activityId,propertyId:e.propertyId,clientId:e.clientId,activityDate:null,createdAt:e.activityDay,status:e.expectedStatus,description:''}];
  });
}

/** Count upper bounds from the queue only. CRM histories can reduce the total. */
export function planActivityCandidates(sources:SourceProperty[]){
  const groups=new Map<string,string[]>();let withoutActivity=0,uncertainIdentity=0;
  for(const source of sources){
    if(!source.activity.enabled){withoutActivity++;continue;}
    const primary=activityPrimaryOwner(source.owners),taxCode=primary.taxCode.trim().toUpperCase();
    if(!taxCode){uncertainIdentity++;continue;}
    const items=groups.get(taxCode)??[];items.push(source.sourcePropertyId);groups.set(taxCode,items);
  }
  const enabled=sources.length-withoutActivity;
  return {properties:sources.length,enabled,withoutActivity,candidateActivities:groups.size+uncertainIdentity,
    consolidated:enabled-groups.size-uncertainIdentity,uncertainIdentity};
}
