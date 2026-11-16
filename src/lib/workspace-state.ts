import 'server-only';
import {createHash} from 'node:crypto';
import {unstable_cache} from 'next/cache';
import {requireUser} from '@/lib/auth';
import {getSupabaseServiceClient} from '@/lib/supabase/service';
import {readNewsCandidates} from '@/lib/property-lifecycle/buildings/news-read-model';
export const noticeTabs=['mercato','opportunita','privati','usciti','notizie'] as const;
export type NoticeTab=typeof noticeTabs[number];
export type NoticeSnapshot=Record<string,Record<string,string>>;
export function recordFingerprint(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,20);}
export async function workspaceOwner(){const user=await requireUser();return user?.id??null;}
export async function readWorkspacePreferences(owner:string|null){
 if(!owner)return [];
 const result=await getSupabaseServiceClient().from('app_settings').select('key,value').like('key',`workspace:${owner}:%`).limit(10000);
 if(result.error)throw new Error('Preferenze temporaneamente non disponibili');return result.data as {key:string;value:unknown}[];
}
export async function readFavoriteIds(){const owner=await workspaceOwner(),rows=await readWorkspacePreferences(owner);return rows.filter(r=>r.key.startsWith(`workspace:${owner}:favorite:`)&&r.value===true).map(r=>r.key.split(':').at(-1)!);}
export const latestWorkspaceSnapshot=unstable_cache(async()=>{
 const db=getSupabaseServiceClient(),snapshot:NoticeSnapshot=Object.fromEntries(noticeTabs.map(tab=>[tab,{}]));
 for(let offset=0;offset<20000;offset+=1000){
  const r=await db.from('radar_property_live_archive').select('property_id,address,latest_asking_price,exit_classification,sale_status,agency_role,private_seller_type,opportunity_score,drop_count,agency_id,row_id,earliest_market_evidence_at,surface_sqm,rooms,property_type,latitude,longitude,street_number').order('property_id').order('row_id').range(offset,offset+999);if(r.error)throw new Error('Notifiche archivio non disponibili');
  for(const row of r.data??[]){
   const hash=recordFingerprint(row),id=row.property_id,closed=['SOLD_CONFIRMED','SOLD_PROBABLE'].includes(row.exit_classification);
   snapshot.mercato![id]=hash;
   if(row.opportunity_score>0&&!closed&&row.sale_status!=='SOLD_CONFIRMED'&&row.agency_role!=='OUR_AGENCY')snapshot.opportunita![id]=hash;
   if(row.private_seller_type&&!closed&&row.sale_status!=='SOLD_CONFIRMED'&&row.agency_role!=='OUR_AGENCY')snapshot.privati![id]=hash;
   if(['SOLD_CONFIRMED','SOLD_PROBABLE','WITHDRAWN','RELISTED','AGENCY_CHANGED','UNKNOWN_EXIT','MISSING_UNCONFIRMED'].includes(row.exit_classification))snapshot.usciti![id]=hash;
  }
  if((r.data?.length??0)<1000)break;
  if(offset===19000)throw new Error('Notifiche: archivio oltre il limite di lettura');
 }
 for(const c of await readNewsCandidates(db,Date.now()))if(c.utility!=="ARCHIVE_ONLY")snapshot.notizie![c.id]=recordFingerprint(c.signature);
 return snapshot;
},['workspace-notifications-v1'],{revalidate:60,tags:['lifecycle']});
