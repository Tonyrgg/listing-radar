import {previousReceipt,versionHash,updateRecap,type UpdateRecap} from '@/lib/workspace-update-model';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getSupabaseServiceClient} from '@/lib/supabase/service';
import {workspaceOwner,readWorkspacePreferences,latestWorkspaceSnapshot,noticeTabs} from '@/lib/workspace-state';
export const dynamic='force-dynamic';
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('read-property'),id:z.uuid(),tab:z.enum(['mercato','opportunita','privati','usciti']),expectedHash:z.string().max(100).optional()}),
 z.object({action:z.literal('favorite'),id:z.uuid(),active:z.boolean()}),
 z.object({action:z.literal('read'),tab:z.enum(noticeTabs),id:z.string().min(1).max(200).optional()}),
]);
export async function GET(){try{
 const owner=await workspaceOwner();if(!owner)return NextResponse.json({error:'Accesso richiesto'},{status:401});
 const [snapshot,prefs]=await Promise.all([latestWorkspaceSnapshot(),readWorkspacePreferences(owner)]);
 const receipts=new Map(prefs.map(r=>[r.key,r]));
 const notices:Record<string,Record<string,string>>={},updates:Record<string,Record<string,UpdateRecap>>={};
 for(const tab of noticeTabs){notices[tab]={};updates[tab]={};for(const [id,version]of Object.entries(snapshot[tab]??{})){
  const previous=previousReceipt(receipts,`workspace:${owner}`,tab,id);
  if(versionHash(previous)!==versionHash(version)){notices[tab]![id]=previous?'updated':'new';if(previous&&tab!=='notizie')updates[tab]![id]=updateRecap(previous,version);}
 }}
 return NextResponse.json({notices,updates,favorites:prefs.filter(r=>r.key.startsWith(`workspace:${owner}:favorite:`)&&r.value===true).map(r=>r.key.split(':').at(-1))},{headers:{'Cache-Control':'private, no-store'}});
}catch{return NextResponse.json({error:'Avvisi temporaneamente non disponibili'},{status:503});}}
export async function POST(request:Request){try{
 const owner=await workspaceOwner();if(!owner)return NextResponse.json({error:'Accesso richiesto'},{status:401});
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return NextResponse.json({error:'Origine non consentita'},{status:403});
 const data=input.parse(await request.json()),db=getSupabaseServiceClient();let key:string,value:unknown;
 if(data.action==='read-property'){
  const snapshot=await latestWorkspaceSnapshot(),current=snapshot[data.tab]?.[data.id];
  if(!current)return NextResponse.json({error:'Record non disponibile'},{status:409});
  if(data.expectedHash&&versionHash(current)!==data.expectedHash)return NextResponse.json({error:'Sono disponibili nuove modifiche; aggiorna il riepilogo prima di confermare'},{status:409});
  const rows=noticeTabs.filter(tab=>tab!=='notizie'&&snapshot[tab]?.[data.id]).map(tab=>({key:`workspace:${owner}:record:${tab}:${data.id}`,value:snapshot[tab]![data.id]}));
  const saved=await db.from('app_settings').upsert(rows,{onConflict:'key'});if(saved.error)throw saved.error;
  return NextResponse.json({ok:true});
 }

 if(data.action==='favorite'){key=`workspace:${owner}:favorite:${data.id}`;value=data.active;}
 else{const latest=(await latestWorkspaceSnapshot())[data.tab]??{};if(data.id){if(!latest[data.id])return NextResponse.json({error:'Record non disponibile'},{status:409});key=`workspace:${owner}:record:${data.tab}:${data.id}`;value=latest[data.id];}else{key=`workspace:${owner}:read:${data.tab}`;value=latest;}}
 const saved=await db.from('app_settings').upsert({key,value},{onConflict:'key'});if(saved.error)throw saved.error;
 return NextResponse.json({ok:true});
}catch{return NextResponse.json({error:'Salvataggio non confermato; riprova'},{status:400});}}
