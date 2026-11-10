import type {CrmActivitySnapshot} from './model.js';
import {sameCrmRecordId} from '../core/crm-record-id.js';
import {activityDay,activityStatus} from './activity-policy.js';

type RecordValue=Record<string,unknown>;
const object=(value:unknown):value is RecordValue=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
export type TaskFragment=Partial<CrmActivitySnapshot>&{id:string;conflicted?:boolean};
function parse(body:string):unknown{try{return JSON.parse(body.replace(/^\s*(?:while\s*\(\s*1\s*\)\s*;|for\s*\(\s*;;\s*\)\s*;|\)\]\}',?\s*)/,''));}catch{return null;}}
function value(source:RecordValue,key:string):unknown{
  for(const fields of [source,source.fields])if(object(fields)){
    const found=Object.keys(fields).find(k=>k.toLowerCase()===key.toLowerCase());
    if(found!==undefined){const v=fields[found];return object(v)&&'value'in v?v.value:v;}
  }
  return undefined;
}
function stringField(source:RecordValue,key:string):string|null|undefined{
  const v=value(source,key);return v===null?null:typeof v==='string'?v:undefined;
}
/** Read fields only from persisted Tasks. Custom customer fields require their
 * actual metadata label; unrelated OwnerId/CreatedById are never customer IDs. */
export function activityTaskFragments(body:string,expectedClientId?:string):TaskFragment[]{
  const nodes:unknown[]=[parse(body)],records:TaskFragment[]=[];const labelledClientFields=new Set<string>();
  const walked:RecordValue[]=[];
  for(let visited=0;nodes.length&&visited<100_000;visited++){
    const node=nodes.pop();if(typeof node==='string'){if(/^\s*[\[{]/.test(node))nodes.push(parse(node));continue;}
    if(Array.isArray(node)){if(nodes.length+node.length>100_000)break;nodes.push(...node);continue;}
    if(!object(node))continue;
    walked.push(node);
    if(typeof node.apiName==='string'&&typeof node.label==='string'&&/^(Cliente|Soggetto)$/i.test(node.label))labelledClientFields.add(node.apiName);
    const children=Object.values(node);if(nodes.length+children.length>100_000)break;nodes.push(...children);
  }
  for(const node of walked){
    const id=stringField(node,'Id');if(!id||!/^00T[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(id))continue;
    const result:TaskFragment={id};
    for(const [field,key]of [['propertyId','WhatId'],['description','Description'],['status','Status'],['activityDate','ActivityDate'],['createdAt','CreatedDate']]as const){
      const v=stringField(node,key);if(v!==undefined){if(v!==null||!['description','status'].includes(field))(result as RecordValue)[field]=v;}
    }
    const explicit=[...labelledClientFields].map(key=>stringField(node,key)).filter((v):v is string|null=>v!==undefined);
    const account=stringField(node,'AccountId'),who=stringField(node,'WhoId');
    const native=[account,typeof who==='string'&&(!expectedClientId||sameCrmRecordId(who,expectedClientId)||expectedClientId.slice(0,3)!=='001')?who:undefined].filter((v):v is string=>typeof v==='string'&&Boolean(v));
    // Null standard fields do not establish absence of a custom Cliente field.
    const clients=labelledClientFields.size?explicit:native;
    const exact=clients.find(v=>v&&expectedClientId&&sameCrmRecordId(v,expectedClientId));
    const known=[...new Set(clients.filter((v):v is string=>Boolean(v)))];
    if(exact)result.clientId=exact;else if(known.length===1)result.clientId=known[0];else if(explicit.length&&known.length===0)result.clientId=null;
    records.push(result);
  }
  return records;
}
export function mergeTaskFragment(target:Map<string,TaskFragment>,incoming:TaskFragment){
  const key=incoming.id.slice(0,15),prior=target.get(key);
  if(!prior){target.set(key,{...incoming});return;}
  const next={...prior};
  for(const field of ['propertyId','clientId','description','status','activityDate','createdAt']as const){
    const v=incoming[field];if(v===undefined)continue;
    const old=next[field];
    const sameDay=field==='createdAt'&&typeof old==='string'&&typeof v==='string'&&activityDay({createdAt:old,activityDate:null})!==null&&activityDay({createdAt:old,activityDate:null})===activityDay({createdAt:v,activityDate:null});
    if(old!==undefined&&old!==v&&!sameDay&&!(typeof old==='string'&&typeof v==='string'&&(['propertyId','clientId'].includes(field)&&sameCrmRecordId(old,v)||field==='status'&&activityStatus(old)&&activityStatus(old)===activityStatus(v))))next.conflicted=true;
    if(sameDay&&typeof old==='string'&&old.includes('T'))continue;
    (next as RecordValue)[field]=v;
  }
  target.set(key,next);
}
export function taskSnapshot(row:TaskFragment,allowUnknownClient=false):CrmActivitySnapshot|null{
  if(row.conflicted||row.propertyId===undefined||!allowUnknownClient&&row.clientId===undefined||!row.status||!row.createdAt)return null;
  return {id:row.id,propertyId:row.propertyId,clientId:row.clientId??null,description:row.description??'',status:row.status,activityDate:row.activityDate??null,createdAt:row.createdAt};
}

/** Only successful save actions can supply a candidate Task ID. It still needs
 * an independent readback before the operation can complete. */
export function savedActivityIds(body:string):string[]{
  const parsed=parse(body);if(!object(parsed)||!Array.isArray(parsed.actions))return [];
  const ids=new Set<string>();
  for(const action of parsed.actions){
    if(!object(action)||action.state!=='SUCCESS')continue;
    const v=action.returnValue;
    if(typeof v==='string'&&/^00T[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(v))ids.add(v);
    else for(const row of activityTaskFragments(JSON.stringify(v)))ids.add(row.id);
  }
  return [...ids];
}
