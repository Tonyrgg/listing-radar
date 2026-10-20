'use server';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {requireUser} from '@/lib/auth';
import {getSupabaseServerClient} from '@/lib/supabase/server';
export async function decideStreet(form:FormData){
 await requireUser();const db=await getSupabaseServerClient();
 const result=await db.rpc('review_public_record_street',{p_record:String(form.get('record')),p_index:Number(form.get('index')),p_hash:String(form.get('hash')),p_decision:String(form.get('decision')),p_street:String(form.get('street')??'')||null});
 if(result.error)redirect('/fonti/corrispondenze?esito=errore');
 revalidatePath('/fonti/corrispondenze');revalidatePath('/map');redirect('/fonti/corrispondenze?esito=salvato');
}
