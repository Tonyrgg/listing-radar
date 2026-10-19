import type { SupabaseClient } from '@supabase/supabase-js';
import { LifecycleJobQueue } from '../jobs/queue';
import { EXTERNAL_POLICY } from './policy';

/** Controlled rollout: only already persisted RE/MAX URLs. No discovery or missing. */
export async function enqueueDueKnownMarketVerifiers(db: SupabaseClient, now = new Date(),
  queue = new LifecycleJobQueue(db)): Promise<{ requested: number; disabled: boolean }> {
  const config = await db.from('market_observer_sources').select('enabled').eq('source_key', 'REMAX').single();
  if (config.error) throw new Error(config.error.message);
  if (!config.data.enabled) return { requested: 0, disabled: true };
  const cutoff = new Date(now.getTime() - EXTERNAL_POLICY.knownVerifierIntervalHours * 3_600_000).toISOString();
  let cursor: string | undefined;
  let requested = 0;
  for (;;) {
    let query = db.from('publications').select('id,agency_id').eq('external_source_key', 'REMAX')
      .or(`external_detail_at.is.null,external_detail_at.lte.${cutoff}`).order('id').limit(500);
    if (cursor) query = query.gt('id', cursor);
    const page = await query;
    if (page.error) throw new Error(page.error.message);
    const publications = page.data ?? [];
    for (const publication of publications) {
      await queue.enqueue({ jobType: 'VERIFY_MARKET_PUBLICATION', agencyId: publication.agency_id,
        payload: { source: 'REMAX', publicationId: publication.id, trigger: 'KNOWN_URL_PERIODIC_VERIFICATION' },
        priority: 50, runAfter: new Date(now.getTime() - 60_000).toISOString(),
        dedupeKey: `known-market-verifier:REMAX:${publication.id}` });
      requested++;
    }
    if (publications.length < 500) break;
    cursor = publications[publications.length - 1].id;
  }
  return { requested, disabled: false };
}
