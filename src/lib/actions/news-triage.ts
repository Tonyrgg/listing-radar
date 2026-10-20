'use server';
import { requireUser } from '@/lib/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseServiceClient } from '@/lib/supabase/service';
import { readNewsCandidates } from '@/lib/property-lifecycle/buildings/news-read-model';
import { REJECTION_REASONS, type NewsDecision, type NewsFeedback } from '@/lib/property-lifecycle/buildings/news-triage';
import { deepenNews } from '@/lib/property-lifecycle/buildings/news-deepening';
async function candidate(id: string) {
    if (!/^[a-f\d-]{36}$/i.test(id))
        throw Error('Notizia non valida');
    const db = getSupabaseServiceClient();
    const c = (await readNewsCandidates(db, Date.now())).find(c => c.id === id && c.utility !== 'ARCHIVE_ONLY');
    if (!c)
        throw Error('La notizia non è più nella coda 2026');
    return c;
}
export async function observeNews(id: string) {
    const user = await requireUser();
    if (!user)
        return;
    const c = await candidate(id), db = await getSupabaseServerClient();
    const r = await db.rpc('observe_public_news', { p_id: id, p_event_type: c.anchor.event_type, p_signature: c.signature });
    if (r.error)
        throw Error('Esposizione non registrata');
}
export async function decideNews(id: string, decision: NewsDecision, reason: string | null, revision: number): Promise<{
    feedback?: NewsFeedback;
    error?: string;
}> {
    const user = await requireUser();
    if (!user)
        return { error: 'Accedi per valutare una notizia.' };
    if (!['INTERESTING', 'DEEPEN', 'NOT_USEFUL'].includes(decision) || reason && !REJECTION_REASONS[reason] || !Number.isInteger(revision))
        return { error: 'Decisione non valida.' };
    try {
        const c = await candidate(id), db = await getSupabaseServerClient();
        const r = await db.rpc('review_public_news', { p_id: id, p_decision: decision, p_reason: reason, p_revision: revision, p_event_type: c.anchor.event_type, p_signature: c.signature });
        if (r.error)
            throw Error(r.error.message);
        let feedback = (Array.isArray(r.data) ? r.data[0] : r.data) as NewsFeedback;
        if (decision === 'DEEPEN') {
            try {
                const enriched = await deepenNews(getSupabaseServiceClient(), c);
                const fresh = await candidate(id);
                if (fresh.signature !== c.signature)
                    throw Error('Le prove sono cambiate: ricarica prima di riprovare.');
                const end = await db.rpc('complete_public_news_deepening', { p_id: id, p_revision: feedback.revision, p_enrichment: enriched });
                if (end.error)
                    throw Error(end.error.message);
                feedback = (Array.isArray(end.data) ? end.data[0] : end.data) as NewsFeedback;
            }
            catch {
                return { feedback, error: 'Valutazione salvata. Approfondimento incompleto: puoi riprovare senza perdere la decisione.' };
            }
        }
        return { feedback };
    }
    catch {
        return { error: 'Valutazione non salvata: ricarica la pagina e riprova. Un’altra modifica potrebbe essere già presente.' };
    }
}
