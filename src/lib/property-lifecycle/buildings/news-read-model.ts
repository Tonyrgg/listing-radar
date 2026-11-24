import type { SupabaseClient } from '@supabase/supabase-js';
import { readFactNews } from './facts-read-model';
import { buildNewsCandidates, type NewsFact, type NewsSourceContext } from './news-triage';

async function readSourceContexts(db: SupabaseClient) {
    const contexts = await db.from('public_record_territorial_resolutions').select('record_id,context:semantic_projection->newsContext').not('semantic_projection->newsContext', 'is', null);
    if (contexts.error) throw Error(contexts.error.message);
    return Object.fromEntries((contexts.data ?? []).map(r => [r.record_id, r.context as unknown as NewsSourceContext]));
}

export async function readNewsCandidates(db: SupabaseClient, now: number) {
    const [facts, contexts] = await Promise.all([readFactNews(db, now), readSourceContexts(db)]);
    return buildNewsCandidates(facts, now, contexts);
}

async function readMapFacts(db: SupabaseClient) {
    const facts: NewsFact[] = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 20000; offset += pageSize) {
        const result = await db.from('worker_document_map_facts')
            .select('event_id,record_id,event_type,event_date,building_id,street_id,street,civic,fact,evidence_location,classification_version')
            .order('event_id').range(offset, offset + pageSize - 1);
        if (result.error) throw result.error;
        facts.push(...result.data as NewsFact[]);
        if (result.data.length < pageSize) return facts;
    }
    throw Error('Limite di lettura delle notizie sulla mappa superato');
}

export async function readWorkerNewsCandidates(db: SupabaseClient, now: number) {
    const [facts, contexts] = await Promise.all([readMapFacts(db), readSourceContexts(db)]);
    return buildNewsCandidates(facts, now, contexts);
}
