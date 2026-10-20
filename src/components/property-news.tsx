import Link from 'next/link';
import { Meta, buttonClass, controlClass } from './ui/primitives';
import { formatDate } from '@/lib/formatting';
import { factLabel, filterFactNews, readFactNews, type FactNews } from '@/lib/property-lifecycle/buildings/facts-read-model';
import { getSupabaseServiceClient } from '@/lib/supabase/service';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { NEWS_POLICY, NEWS_TYPES, REJECTION_REASONS, filterNews, romeToday, type NewsFeedback } from '@/lib/property-lifecycle/buildings/news-triage';
import { readNewsCandidates } from '@/lib/property-lifecycle/buildings/news-read-model';
import { NewsCardContent, historyCandidate } from './news-card';
import { NewsTriageCard } from './news-triage-card';
export function PropertyNewsList({ rows }: {
    rows: FactNews[];
}) { return <div className="max-w-[72ch]">{rows.map(r => <article key={r.event_id} id={`evento-${r.event_id}`} className="space-y-4 border-b border-[var(--lr-line-quiet)] py-7"><NewsCardContent candidate={historyCandidate(r)}/></article>)}</div>; }
export async function PropertyNews({ params, now }: {
    params: Record<string, string | string[] | undefined>;
    now: number;
}) {
    const v = (k: string) => typeof params[k] === 'string' ? params[k] as string : '', archive = v('periodo') === 'all' || !!v('evento_id'), page = Math.max(1, Math.floor(Number(v('pagina')) || 1));
    if (archive) {
        const all = await readFactNews(getSupabaseServiceClient(), now).catch(() => null), filtered = (all ? filterFactNews(all, { period: 'all', building: v('edificio'), query: v('q') }, now) : []).filter(r => !v('evento_id') || r.event_id === v('evento_id'));
        return <section className="max-w-[72ch] space-y-5"><h2 className="text-[length:var(--lr-text-section)] font-[650]">Archivio delle notizie</h2><p>Storia amministrativa e contesto. La data di importazione non rende recente un atto.</p><Link href="?vista=notizie" className={buttonClass('secondary')}>Torna alle notizie 2026</Link><Meta>{all ? `${filtered.length} fatti e combinazioni` : 'Archivio temporaneamente non disponibile'}</Meta><PropertyNewsList rows={filtered.slice((page - 1) * 20, page * 20)}/><Pagination page={page} count={filtered.length} url={p => `?${new URLSearchParams({ vista: 'notizie', periodo: 'all', pagina: String(p), q: v('q'), edificio: v('edificio') })}`}/></section>;
    }
    const db = await getSupabaseServerClient();
    const [candidates, feedbackResult, statsResult] = await Promise.all([readNewsCandidates(getSupabaseServiceClient(), now).catch(() => null), db.from('public_record_news_feedback').select('*'), db.from('public_record_news_feedback_stats').select('*')]);
    const feedback = (feedbackResult.data ?? []) as NewsFeedback[], status = v('stato') || 'new', type = v('tipo') || 'all', filtered = filterNews(candidates ?? [], feedback, status, type, v('q'), v('edificio')), rows = filtered.slice((page - 1) * NEWS_POLICY.pageSize, page * NEWS_POLICY.pageSize), map = new Map(feedback.map(r => [r.candidate_id, r]));
    const url = (p: number) => `?${new URLSearchParams({ vista: 'notizie', stato: status, tipo: type, q: v('q'), edificio: v('edificio'), pagina: String(p) })}`;
    return <section className="max-w-[72ch] space-y-6"><div className="space-y-3"><h2 className="text-[length:var(--lr-text-section)] font-[650]">Notizie da valutare</h2><p>Dal 1 gennaio 2026 al {formatDate(romeToday(now))}. Il sistema suggerisce una situazione; sei tu a decidere se vale la pena approfondirla.</p><Link href="?vista=notizie&periodo=all" className="inline-flex min-h-11 items-center underline">Consulta l’archivio storico</Link></div>
 <form key={[status, type, v('q'), v('edificio')].join('|')} method="get" className="flex flex-col gap-3 border-y border-[var(--lr-line-quiet)] py-4 sm:flex-row sm:flex-wrap sm:items-end"><input name="vista" type="hidden" value="notizie"/>{v('edificio') ? <input name="edificio" type="hidden" value={v('edificio')}/> : null}<label className="flex min-w-0 flex-col gap-1">Valutazione<select name="stato" defaultValue={status} className={controlClass()}><option value="new">Da valutare</option><option value="interesting">Interessanti</option><option value="deepen">Da approfondire</option><option value="rejected">Scartate</option></select></label><label className="flex min-w-0 flex-col gap-1">Tipo<select name="tipo" defaultValue={type} className={controlClass()}>{Object.entries(NEWS_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label><label className="flex min-w-0 flex-col gap-1">Via / area<input name="q" defaultValue={v('q')} className={controlClass()}/></label><button className={buttonClass('secondary')}>Filtra notizie</button></form>
 {!candidates ? <p role="alert">Le prove non sono temporaneamente disponibili. Nessuna notizia è stata eliminata.</p> : feedbackResult.error ? <p role="alert">Le valutazioni non sono disponibili: ricarica prima di decidere.</p> : <><Meta>{filtered.length} {filtered.length === 1 ? 'situazione' : 'situazioni'} · prima gli atti più utili da verificare</Meta>{!rows.length ? <div className="space-y-3 py-6"><h3 className="font-semibold">Nessuna situazione con questi filtri</h3><p>Non riempiamo la coda con manutenzioni generiche o atti vecchi. Le notizie già valutate sono nei filtri dedicati; le prove precedenti restano nell’archivio.</p></div> : rows.map(c => <NewsTriageCard key={`${c.id}:${map.get(c.id)?.revision ?? 0}`} candidate={c} initialFeedback={map.get(c.id)}/>)}<Pagination page={page} count={filtered.length} url={url}/></>}
 <details className="border-t border-[var(--lr-line-quiet)] pt-2"><summary className="min-h-11 cursor-pointer py-3 font-medium">Le tue valutazioni per tipo</summary><p className="mb-3 text-[var(--lr-ink-2)]">Mostrate significa entrate nell’area visibile dello schermo. Interessanti e scartate descrivono l’ultima decisione; approfondite conta le situazioni approfondite almeno una volta.</p>{statsResult.error ? <p>Statistiche temporaneamente non disponibili.</p> : statsResult.data?.length ? <ul className="space-y-4">{statsResult.data.map(s => <li key={s.event_type}><strong>{factLabel(s.event_type)}</strong><p>{s.shown} mostrate · {s.interesting} interessanti · {s.deepened} approfondite · {s.rejected} scartate</p>{Object.entries(REJECTION_REASONS).filter(([key]) => (s.reasons as string[]).includes(key)).map(([key, label]) => <Meta key={key}>{label}: {(s.reasons as string[]).filter(r => r === key).length}</Meta>)}</li>)}</ul> : <p>Ancora nessuna valutazione. Le decisioni non generano contatti o lead.</p>}</details>
 </section>;
}
function Pagination({ page, count, url }: {
    page: number;
    count: number;
    url: (p: number) => string;
}) {
    if (count <= NEWS_POLICY.pageSize && page === 1)
        return null;
    return <nav aria-label="Pagine notizie" className="flex items-center justify-between gap-3">{page > 1 ? <Link href={url(page - 1)} className={buttonClass('secondary')}>Precedenti</Link> : <span />}<Meta>Pagina {page}</Meta>{count > page * NEWS_POLICY.pageSize ? <Link href={url(page + 1)} className={buttonClass('secondary')}>Successive</Link> : <span />}</nav>;
}
