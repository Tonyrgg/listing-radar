'use server';
import {requireUser} from '@/lib/auth';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {normalizeTonySignal,tonySelectionSchema} from '@/lib/tonybook/signals';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {setFlash} from '@/lib/flash';
export async function registerTonyBookSignal(input:unknown):Promise<{error?:string}>{
 const user=await requireUser();if(!user)return {error:'Accedi per registrare un segnale.'};
 try{
  const s=normalizeTonySignal(input),db=await getSupabaseServerClient();
  const r=await db.rpc('register_tonybook_signal',{p_id:s.id,p_state:s.state,p_reference:s.reference,p_fact:s.fact,p_unknowns:s.unknowns,p_signature:s.signature});
  if(r.error)return {error:'Segnale non salvato. Uno scarto non viene riaperto e una prova discordante richiede revisione.'};
  revalidatePath('/richieste/segnali');return {};
 }catch{return {error:'Segnale non valido. Conserva i dati ignoti e indica una data di osservazione verificata.'};}
}
export async function selectTonyBookVerification(form:FormData){
 const user=await requireUser();if(!user)return;
 const selection=tonySelectionSchema.safeParse({id:form.get('id'),signature:form.get('signature'),confirmed:form.get('confirmed')==='yes'});
 let error='Seleziona un segnale attivo e rileggi le prove.';
 if(selection.success){
  const s=selection.data,db=await getSupabaseServerClient();
  const result=await db.rpc('plan_tonybook_verification',{p_id:s.id,p_signature:s.signature,p_confirmed:s.confirmed});
  if(!result.error){revalidatePath('/richieste');await setFlash({tone:'success',message:'Verifica pianificata; nessun contatto creato.'});redirect('/richieste');}
  error='Verifica non pianificata: il segnale può essere cambiato o scartato. Rileggi la scheda.';
 }
 await setFlash({tone:'danger',message:error});redirect('/richieste/segnali');
}
