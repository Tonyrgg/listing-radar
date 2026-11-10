import {crmRecordIdentity} from '../core/crm-record-id.js';
import {romeDay} from './activity-policy.js';
import type {ActivityEvidence,CrmActivitySnapshot} from './model.js';

const locks=new Map<string,Promise<void>>();
const facts=new Map<string,{day:string;row:CrmActivitySnapshot}>();
/** Parallel tabs may update different properties of the same customer. Their
 * activity decision/write must run in order, including the final readback. */
export async function withClientActivityLock<T>(key:string,operation:()=>Promise<T>):Promise<T>{
  const previous=locks.get(key)??Promise.resolve();let release!:()=>void;
  const current=new Promise<void>(resolve=>{release=resolve;});locks.set(key,current);
  await previous;
  try{return await operation();}finally{release();if(locks.get(key)===current)locks.delete(key);}
}
export function rememberVerifiedActivity(evidence:ActivityEvidence,now:Date){
  if(!['created','existing'].includes(evidence.outcome)||!evidence.activityId||!evidence.propertyId||!evidence.clientId||!evidence.activityDay
    ||evidence.descriptionVerified!==true||evidence.statusVerified!==true||!evidence.expectedStatus||evidence.activityDay!==romeDay(now))return;
  facts.set(crmRecordIdentity(evidence.clientId),{day:evidence.activityDay,row:{id:evidence.activityId,propertyId:evidence.propertyId,clientId:evidence.clientId,
    activityDate:null,createdAt:evidence.activityDay,status:evidence.expectedStatus,description:''}});
  for(const[key,value]of facts)if(value.day!==romeDay(now))facts.delete(key);
}
export function verifiedClientActivities(clientId:string,now:Date):CrmActivitySnapshot[]{
  const fact=facts.get(crmRecordIdentity(clientId));return fact?.day===romeDay(now)?[structuredClone(fact.row)]:[];
}
