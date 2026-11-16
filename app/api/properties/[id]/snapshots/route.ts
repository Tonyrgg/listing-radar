import {NextResponse} from 'next/server';
import {z} from 'zod';
import {workspaceOwner} from '@/lib/workspace-state';
import {getSupabaseServiceClient} from '@/lib/supabase/service';
import {readSavedSnapshots} from '@/lib/property-lifecycle/read-models/saved-snapshots';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 if(!await workspaceOwner())return NextResponse.json({error:'Accesso richiesto'},{status:401});
 const {id}=await params;if(!z.uuid().safeParse(id).success)return NextResponse.json({error:'Identificativo non valido'},{status:400});
 try{return NextResponse.json({publications:await readSavedSnapshots(getSupabaseServiceClient(),id)},{headers:{'Cache-Control':'private, no-store'}});}
 catch{return NextResponse.json({error:'Schede salvate temporaneamente non disponibili. Riprova.'},{status:503});}
}
