import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workspaceOwner,readWorkspacePreferences} from '@/lib/workspace-state';
import {previousReceiptEntry} from '@/lib/workspace-update-model';
import {getSupabaseServiceClient} from '@/lib/supabase/service';
import {readPropertyUpdateHistory} from '@/lib/property-lifecycle/read-models/update-history';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const owner=await workspaceOwner();if(!owner)return NextResponse.json({error:'Accesso richiesto'},{status:401});
 const {id}=await params,tab=new URL(request.url).searchParams.get('tab')??'mercato';if(!z.uuid().safeParse(id).success||!['mercato','opportunita','privati','usciti'].includes(tab))return NextResponse.json({error:'Richiesta non valida'},{status:400});
 try{const prefs=await readWorkspacePreferences(owner),receipt=previousReceiptEntry(prefs,`workspace:${owner}`,tab,id);const changes=receipt?.updated_at?await readPropertyUpdateHistory(getSupabaseServiceClient(),id,receipt.updated_at):[];return NextResponse.json({changes,since:receipt?.updated_at??null},{headers:{'Cache-Control':'private, no-store'}});}catch{return NextResponse.json({error:'Confronto storico temporaneamente non disponibile'},{status:503});}
}
