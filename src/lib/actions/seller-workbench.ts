'use server';
import { requireUser } from '@/lib/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseServiceClient } from '@/lib/supabase/service';
import { readNewsCandidates } from '@/lib/property-lifecycle/buildings/news-read-model';
import { reviewSchema } from '@/lib/seller-intake/model';
import { attachSourceSchema,linkPropertySchema } from '@/lib/seller-intake/provenance';
import { revalidatePath } from 'next/cache';
import { setFlash } from '@/lib/flash';
export async function updateSellerCase(input: unknown): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!user) return { error: 'Accedi per gestire le richieste.' };
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data, db = await getSupabaseServerClient();
  const { error } = await db.rpc('review_seller_case', {
    p_id: v.id, p_revision: v.revision, p_status: v.status,
    p_action: v.nextAction, p_at: v.nextActionAt, p_note: v.note,
  });
  if (error) return { error: 'Esito non salvato. Ricarica: la scheda potrebbe essere cambiata. Una verifica documentale non può diventare un contatto commerciale.' };
  await setFlash({ tone: 'success', message: 'Esito e prossimo passo salvati.' });
  revalidatePath('/richieste'); return {};
}
export async function planNewsVerification(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!user) return { error: 'Accedi per pianificare una verifica.' };
  if (!/^[a-f\d-]{36}$/i.test(id)) return { error: 'Notizia non valida.' };
  try {
    const db = await getSupabaseServerClient();
    const feedback = await db.from('public_record_news_feedback').select('status,source_signature').eq('candidate_id', id).eq('user_id', user.id).maybeSingle();
    if (feedback.error || feedback.data?.status !== 'INTERESTING') return { error: 'Segna prima la notizia come interessante.' };
    const c = (await readNewsCandidates(getSupabaseServiceClient(), Date.now())).find(c => c.id === id && c.utility !== 'ARCHIVE_ONLY');
    if (!c) return { error: 'La notizia non è più nella coda operativa.' };
    if (feedback.data.source_signature !== c.signature) return { error: 'Le prove sono cambiate. Rileggi e valuta di nuovo la notizia prima di pianificare.' };
    const result = await db.rpc('plan_seller_verification', {
      p_external: `news:${id}`, p_signature: c.signature, p_title: c.title,
      p_context: { candidateId: id, sourceUrl: c.anchor.record_source_url, unknown: c.unknown },
    });
    if (result.error) throw result.error;
    revalidatePath('/richieste'); return {};
  } catch { return { error: 'Verifica non pianificata. Riprova dopo aver controllato il database.' }; }
}

export async function attachSellerSource(input:unknown):Promise<{error?:string}> {
  const user=await requireUser();if(!user)return {error:'Accedi per collegare una fonte.'};
  const parsed=attachSourceSchema.safeParse(input);if(!parsed.success)return {error:'Provenienza non valida.'};
  const db=await getSupabaseServerClient();
  const result=await db.rpc('attach_seller_case_source',{p_case:parsed.data.caseId,p_reference:parsed.data.reference});
  if(result.error)return {error:'Fonte non collegata. Una prova diversa richiede una nuova verifica.'};
  revalidatePath('/richieste');return {};
}

export async function linkSellerProperty(input:unknown):Promise<{error?:string}> {
  const user=await requireUser();if(!user)return {error:'Accedi per collegare un immobile.'};
  const parsed=linkPropertySchema.safeParse(input);if(!parsed.success)return {error:'Collegamento non valido.'};
  const db=await getSupabaseServerClient();
  const result=await db.rpc('link_seller_case_property',{p_case:parsed.data.caseId,p_property:parsed.data.propertyId,p_note:parsed.data.note});
  if(result.error)return {error:'Collegamento non salvato. Verifica la pratica e il riferimento.'};
  revalidatePath('/richieste');return {};
}
