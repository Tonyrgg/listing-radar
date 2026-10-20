import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseAlboDetail, safeAlboUrl } from './albo';
import { extractPropertyFacts } from './property-facts';
import { NEWS_POLICY, administrativeDate, type NewsCandidate, type NewsEnrichment } from './news-triage';
const hosts = new Set(['bitonto.trasparenza-valutazione-merito.it', 'municipium-images-production.s3-eu-west-1.amazonaws.com', 'www.comune.bitonto.ba.it']);
/** Only a URL already attached to this record may reach this reader. No redirects/discovery. */
export async function readKnownNewsPdf(id: string, url: string, date: string | null, fetcher: typeof fetch = fetch) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !hosts.has(u.hostname) || u.username || u.password)
        throw Error('Documento non consentito');
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!response.ok || !/application\/pdf/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel();
        throw Error('PDF non disponibile o firmato in formato non leggibile');
    }
    if (Number(response.headers.get('content-length')) > NEWS_POLICY.maxPdfBytes) {
        await response.body?.cancel();
        throw Error('PDF oltre il limite di lettura');
    }
    const reader = response.body?.getReader();
    if (!reader)
        throw Error('PDF vuoto');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const c = await reader.read();
            if (c.done)
                break;
            size += c.value.length;
            if (size > NEWS_POLICY.maxPdfBytes)
                throw Error('PDF oltre il limite di lettura');
            chunks.push(c.value);
        }
    }
    catch (e) {
        await reader.cancel();
        throw e;
    }
    finally {
        reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.subarray(0, 5).toString() !== '%PDF-')
        throw Error('Formato PDF non valido');
    const { getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes), { useWasm: false, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false });
    const hash = createHash('sha256').update(bytes).digest('hex'), at = new Date().toISOString();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([(async () => {
                const facts = [];
                for (let i = 1; i <= Math.min(pdf.numPages, NEWS_POLICY.maxPdfPages); i++) {
                    const page = await pdf.getPage(i), content = await page.getTextContent();
                    const text = content.items.map(v => 'str' in v ? v.str + ('hasEOL' in v && v.hasEOL ? '\n' : ' ') : '').join('').slice(0, 80000);
                    facts.push(...extractPropertyFacts(id, { text, field: 'pdf.text', sourceUrl: url, sourceHash: hash, observedAt: at, page: i }, date));
                    page.cleanup();
                }
                return { facts: facts.slice(0, 40), hash, pages: Math.min(pdf.numPages, NEWS_POLICY.maxPdfPages), truncated: pdf.numPages > NEWS_POLICY.maxPdfPages };
            })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Tempo di lettura PDF esaurito')), 12000); })]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
        await pdf.loadingTask.destroy();
    }
}
export async function deepenNews(db: SupabaseClient, c: NewsCandidate, fetcher: typeof fetch = fetch): Promise<NewsEnrichment> {
    const result: NewsEnrichment = { checkedAt: new Date().toISOString(), facts: [], history: c.context.map(r => ({ id: r.event_id, type: r.event_type, date: administrativeDate(r), url: r.evidence_location.source_url })).slice(0, 40), market: [], references: null, gaps: [], sources: [] };
    const record = await db.from('market_observer_public_records').select('source_key,source_record_key,source_url,document_urls,addresses,cadastral_references,territorial_references').eq('id', c.id).single();
    if (record.error)
        throw Error('Documento non disponibile');
    const r = record.data;
    result.references = { addresses: r.addresses, cadastral: r.cadastral_references, territorial: r.territorial_references };
    if (r.source_key === 'comune-bitonto-albo') {
        try {
            const url = safeAlboUrl(r.source_url), response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
            if (!response.ok)
                throw Error('HTTP');
            const html = await response.text();
            if (Buffer.byteLength(html) > 1500000)
                throw Error('SIZE');
            const detail = parseAlboDetail(html, r.source_record_key), hash = createHash('sha256').update(html).digest('hex');
            result.facts.push(...extractPropertyFacts(c.id, { text: detail.subject, field: 'albo.subject', sourceUrl: url, sourceHash: hash, observedAt: result.checkedAt, territorialScopeVerified: (r.territorial_references ?? []).length > 0 }, detail.documentDate ?? detail.actDate ?? administrativeDate(c.anchor)));
            result.sources.push({ url, status: 'Letto', hash });
        }
        catch {
            result.gaps.push('La scheda primaria non è stata riletta: restano le prove già archiviate.');
            result.sources.push({ url: r.source_url, status: 'Non disponibile' });
        }
    }
    // Existing attached URLs only, prefer unsigned PDF. Do not follow newly discovered links.
    const urls = (r.document_urls ?? []) as string[], pdf = urls.find(u => /downloadSigned=false/.test(u)) ?? urls.find(u => /\.pdf(?:\?|$)/i.test(u));
    if (pdf) {
        try {
            const parsed = await readKnownNewsPdf(c.id, pdf, administrativeDate(c.anchor), fetcher);
            result.facts.push(...parsed.facts);
            result.sources.push({ url: pdf, status: 'Letto', hash: parsed.hash, pages: parsed.pages });
            if (parsed.truncated)
                result.gaps.push('Lettura limitata alle prime 20 pagine.');
        }
        catch (e) {
            result.gaps.push(e instanceof Error ? e.message : 'PDF non leggibile');
            result.sources.push({ url: pdf, status: 'Da verificare manualmente' });
        }
    }
    else
        result.gaps.push('Nessun PDF leggibile già associato alla pratica.');
    for (const id of c.anchor.market?.propertyIds.slice(0, 10) ?? []) {
        const m = await db.from('market_observer_property_archive').select('property_id,agency_name,latest_asking_price,surface_sqm,rooms,state,exit_classification,sold_at').eq('property_id', id).maybeSingle();
        if (m.error) {
            result.gaps.push('Contesto di mercato temporaneamente non disponibile.');
            continue;
        }
        if (m.data)
            result.market.push({ propertyId: id, agency: m.data.agency_name, price: m.data.latest_asking_price, sqm: m.data.surface_sqm, rooms: m.data.rooms, floor: null, state: m.data.state, exit: m.data.exit_classification, sold: m.data.sold_at });
    }
    if (!c.anchor.building_id)
        result.gaps.push('Stabile non identificato con certezza: nessun annuncio attribuito alla pratica.');
    if (!result.facts.some(f => f.from_use && f.to_use) && c.facts.some(f => f.event_type === 'CAMBIO_DESTINAZIONE_USO'))
        result.gaps.push('Uso di partenza e di arrivo non dimostrati.');
    if (!result.facts.some(f => f.units_before !== null && f.units_after !== null))
        result.gaps.push('Numero di unità prima e dopo non dimostrato.');
    result.gaps.push('Superficie e piano dell’unità interessata non dimostrati; i dati di mercato sono solo contesto dello stabile.');
    return result;
}
