import type { SupabaseClient } from '@supabase/supabase-js';
import { readFactNews } from './facts-read-model';
import { buildNewsCandidates, type NewsSourceContext } from './news-triage';
export async function readNewsCandidates(db: SupabaseClient, now: number) {
    const [facts, contexts] = await Promise.all([readFactNews(db, now), db.from('public_record_territorial_resolutions').select('record_id,context:semantic_projection->newsContext').not('semantic_projection->newsContext', 'is', null)]);
    if (contexts.error)
        throw Error(contexts.error.message);
    return buildNewsCandidates(facts, now, Object.fromEntries((contexts.data ?? []).map(r => [r.record_id, r.context as unknown as NewsSourceContext])));
}
