import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getSupabaseServiceClient} from '@/lib/supabase/service';
import {workspaceOwner,readWorkspacePreferences,latestWorkspaceSnapshot,noticeTabs} from '@/lib/workspace-state';
export const dynamic='force-dynamic';
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('favorite'),id:z.uuid(),active:z.boolean()}),
 z.object({action:z.literal('read'),tab:z.enum(noticeTabs),id:z.string().min(1).max(200).optional()}),
]);
export async function GET(){try{
 const owner=await workspaceOwner();if(!owner)return NextResponse.json({error:'Accesso richiesto'},{status:401});
 const [snapshot,prefs]=await Promise.all([latestWorkspaceSnapshot(),readWorkspacePreferences(owner)]),stored=new Map(prefs.map(r=>[r.key,r.value]));
 const notices:Record<string,Record<string,string>>={};
 for(const tab of noticeTabs){const baseline=stored.get(`workspace:${owner}:read:${tab}`) as Record<string,string>|undefined;notices[tab]={};for(const [id,hash]of Object.entries(snapshot[tab]??{})){const individual=stored.get(`workspace:${owner}:record:${tab}:${id}`);if(baseline?.[id]!==hash&&individual!==hash)notices[tab]![id]=baseline?.[id]||individual?'updated':'new';}}
 return NextResponse.json({notices,favorites:prefs.filter(r=>r.key.startsWith(`workspace:${owner}:favorite:`)&&r.value===true).map(r=>r.key.split(':').at(-1))},{headers:{'Cache-Control':'private, no-store'}});
}catch{return NextResponse.json({error:'Avvisi temporaneamente non disponibili'},{status:503});}}
export async function POST(request:Request){try{
 const owner=await workspaceOwner();if(!owner)return NextResponse.json({error:'Accesso richiesto'},{status:401});
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return NextResponse.json({error:'Origine non consentita'},{status:403});
 const data=input.parse(await request.json()),db=getSupabaseServiceClient();let key:string,value:unknown;
 if(data.action==='favorite'){key=`workspace:${owner}:favorite:${data.id}`;value=data.active;}
 else{const latest=(await latestWorkspaceSnapshot())[data.tab]??{};if(data.id){if(!latest[data.id])return NextResponse.json({error:'Record non disponibile'},{status:409});key=`workspace:${owner}:record:${data.tab}:${data.id}`;value=latest[data.id];}else{key=`workspace:${owner}:read:${data.tab}`;value=latest;}}
 const saved=await db.from('app_settings').upsert({key,value},{onConflict:'key'});if(saved.error)throw saved.error;
 return NextResponse.json({ok:true});
}catch{return NextResponse.json({error:'Salvataggio non confermato; riprova'},{status:400});}}
