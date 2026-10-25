import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {inboundSchema,type InboundSubmission} from './model';
const providerId=z.string().regex(/^[0-9]{1,32}$/);
export interface MetaNotice {pageId:string;formId:string;leadId:string;adId?:string;externalId:string}
export function verifyMetaFixtureSignature(raw:Uint8Array,header:string|null,secret:string):boolean{
 if(secret.length<32||raw.byteLength>128*1024||!header||!/^sha256=[a-f0-9]{64}$/i.test(header))return false;
 const expected=createHmac('sha256',secret).update(raw).digest(),actual=Buffer.from(header.slice(7),'hex');
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
/** Signed notification parsing only. This does not fetch Graph or persist a lead. */
export function parseMetaFixtureNotices(raw:Uint8Array,header:string|null,secret:string):MetaNotice[]{
 if(!verifyMetaFixtureSignature(raw,header,secret))throw Error('META_SIGNATURE_INVALID');
 try{
  const event=z.object({object:z.literal('page'),entry:z.array(z.object({
   id:providerId,changes:z.array(z.object({field:z.string(),value:z.unknown()}).passthrough()).max(1000),
  }).passthrough()).max(1000)}).passthrough().parse(JSON.parse(Buffer.from(raw).toString('utf8')));
  const notices=new Map<string,MetaNotice>();
  for(const entry of event.entry)for(const change of entry.changes){
   if(change.field!=='leadgen')continue;
   const value=z.object({page_id:providerId,form_id:providerId,leadgen_id:providerId,ad_id:providerId.optional()}).passthrough().parse(change.value);
   if(value.page_id!==entry.id)throw Error('PAGE_MISMATCH');
   const notice={pageId:value.page_id,formId:value.form_id,leadId:value.leadgen_id,...(value.ad_id?{adId:value.ad_id}:{}),externalId:'meta_'+value.page_id+'_'+value.form_id+'_'+value.leadgen_id};
   const prior=notices.get(notice.externalId);
   if(prior&&JSON.stringify(prior)!==JSON.stringify(notice))throw Error('CONFLICTING_NOTICE');
   notices.set(notice.externalId,notice);
  }
  return [...notices.values()];
 }catch{throw Error('META_NOTIFICATION_INVALID');}
}
type Target='name'|'phone'|'email'|'situation'|'role'|'locality'|'propertyType'|'timing'|'preferredTime'|'callbackRequested'|'whatsappOptIn';
export interface MetaFixtureMapping{
 mode:'fixture_only';formId:string;privacyVersion:string;
 fields:Partial<Record<Target,{name:string;choices?:Record<string,string|boolean>}>>;
}
/** The field names/choices below are supplied by a fixture contract, never guessed from labels. */
export function mapMetaFixtureLead(notice:MetaNotice,input:unknown,mapping:MetaFixtureMapping):InboundSubmission{
 try{
  if(mapping.mode!=='fixture_only')throw Error('FIXTURE_ONLY');
  const lead=z.object({id:providerId,form_id:providerId,ad_id:providerId.optional(),adset_id:providerId.optional(),campaign_id:providerId.optional(),
   field_data:z.array(z.object({name:z.string().min(1).max(100),values:z.array(z.string().max(2000)).length(1)}).strict()).max(40),
  }).passthrough().parse(input);
  if(lead.id!==notice.leadId||lead.form_id!==notice.formId||mapping.formId!==notice.formId
   ||(lead.ad_id&&notice.adId&&lead.ad_id!==notice.adId))throw Error('IDENTITY_MISMATCH');
  const names=Object.values(mapping.fields).map(v=>v.name);
  if(new Set(names).size!==names.length||new Set(lead.field_data.map(f=>f.name)).size!==lead.field_data.length)throw Error('AMBIGUOUS_FIELDS');
  const fields=new Map(lead.field_data.map(f=>[f.name,f.values[0]]));
  const read=(target:Target,required=true):string|boolean|undefined=>{
   const spec=mapping.fields[target],value=spec?fields.get(spec.name):undefined;
   if(!spec||value===undefined){if(required)throw Error('REQUIRED_FIELD_MISSING');return undefined;}
   if(spec.choices){if(!Object.hasOwn(spec.choices,value))throw Error('UNKNOWN_CHOICE');return spec.choices[value];}
   if(['situation','role','locality','propertyType','timing','callbackRequested','whatsappOptIn'].includes(target))throw Error('CHOICE_MAP_REQUIRED');
   return value;
  };
  return inboundSchema.parse({
   externalId:notice.externalId,formVersion:'seller_v1',name:read('name'),phone:read('phone'),email:read('email',false),
   answers:{situation:read('situation'),role:read('role'),locality:read('locality'),propertyType:read('propertyType'),timing:read('timing'),preferredTime:read('preferredTime',false)},
   callbackRequested:read('callbackRequested'),whatsappOptIn:read('whatsappOptIn',false)??false,privacyVersion:mapping.privacyVersion,
   attribution:{source:'meta_form',formId:lead.form_id,...(lead.ad_id||notice.adId?{adId:lead.ad_id??notice.adId}:{}),
    ...(lead.adset_id?{adsetId:lead.adset_id}:{}),...(lead.campaign_id?{campaignId:lead.campaign_id}:{})},
  });
 }catch{throw Error('META_FIXTURE_MAPPING_INVALID');}
}
