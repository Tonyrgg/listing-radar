import Link from 'next/link';
import {NewsNotice} from './workspace-updates';
import { Meta, buttonClass } from './ui/primitives';
import { filterFactNews, readFactNews, type FactNews } from '@/lib/property-lifecycle/buildings/facts-read-model';
import { getSupabaseServiceClient } from '@/lib/supabase/service';
import { classifyNews, NEWS_POLICY } from '@/lib/property-lifecycle/buildings/news-triage';
import { readNewsCandidates } from '@/lib/property-lifecycle/buildings/news-read-model';
import { NewsCardContent, historyCandidate } from './news-card';
export function PropertyNewsList({ rows }: {
    rows: FactNews[];
}) { return <div className="lr-news-list">{rows.map(r => <article key={r.event_id} id={`evento-${r.event_id}`} className="lr-news-entry" data-category={classifyNews(r).group}><NewsCardContent candidate={historyCandidate(r)}/></article>)}</div>; }
export async function PropertyNews({ params, now }: {
    params: Record<string, string | string[] | undefined>;
    now: number;
}) {
    const v = (k: string) => typeof params[k] === 'string' ? params[k] as string : '', archive = v('periodo') === 'all' || !!v('evento_id'), page = Math.max(1, Math.floor(Number(v('pagina')) || 1));
    if (archive) {
        const all = await readFactNews(getSupabaseServiceClient(), now).catch(() => null), filtered = (all ? filterFactNews(all, { period: 'all', building: v('edificio'), query: v('q') }, now) : []).filter(r => !v('evento_id') || r.event_id === v('evento_id'));
        return <section className="lr-news-workspace space-y-5"><h2 className="text-[length:var(--lr-text-section)] font-[650]">Archivio delle notizie</h2><p>Storia amministrativa e contesto. La data di importazione non rende recente un atto.</p><Link href="?vista=notizie" className={buttonClass('secondary')}>Torna alle notizie 2026</Link><Meta>{all ? `${filtered.length} fatti e combinazioni` : 'Archivio temporaneamente non disponibile'}</Meta><PropertyNewsList rows={filtered.slice((page - 1) * 20, page * 20)}/><Pagination page={page} count={filtered.length} url={p => `?${new URLSearchParams({ vista: 'notizie', periodo: 'all', pagina: String(p), q: v('q'), edificio: v('edificio') })}`}/></section>;
    }
    const candidates=await readNewsCandidates(getSupabaseServiceClient(),now).catch(()=>null);
    const filtered=(candidates??[]).filter(c=>c.utility!=="ARCHIVE_ONLY").filter(c=>(!v('q')||`${c.title} ${c.anchor.street??''} ${c.anchor.area_name??''}`.toLocaleLowerCase('it').includes(v('q').toLocaleLowerCase('it')))&&(!v('edificio')||c.anchor.building_id===v('edificio')));
    return <section className="lr-news-workspace"><p className="lr-news-intro">Tutte le notizie disponibili, con data e provenienza. <Link href="?vista=notizie&periodo=all">Archivio storico</Link></p>{!candidates?<p role="alert">Notizie temporaneamente non disponibili.</p>:<><Meta>{filtered.length} notizie</Meta><div className="lr-news-list">{filtered.map(c=><article key={c.id} className="lr-news-entry" data-category={c.group}><NewsNotice id={c.id}/><NewsCardContent candidate={c}/></article>)}</div>{!filtered.length?<p>Nessuna notizia disponibile.</p>:null}</>}</section>;
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
