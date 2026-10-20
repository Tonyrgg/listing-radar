import type { FactNews } from './facts-read-model';
export const NEWS_POLICY = Object.freeze({ version: 'news_triage_v1', start: '2026-01-01', pageSize: 20, maxPdfBytes: 8 * 1024 * 1024, maxPdfPages: 20 });
export const NEWS_TYPES: Record<string, string> = { all: 'Tutti i tipi', units: 'Nuove unità', transformation: 'Trasformazioni', completion: 'Lavori conclusi', construction: 'Nuove costruzioni', commercial: 'Locali commerciali', land: 'Terreni / urbanistica', direct: 'Vendita diretta' };
export const REJECTION_REASONS: Record<string, string> = { NOT_TOWARD_SALE: 'Non porta verso una vendita', TOO_GENERIC: 'Intervento troppo generico', COMMON_PART: 'Parte comune / non unità', IRRELEVANT_USE_CHANGE: 'Cambio d’uso irrilevante', TOO_IMPRECISE: 'Troppo poco preciso', ALREADY_KNOWN: 'Informazione già nota', OTHER: 'Altro' };
export type NewsDecision = 'INTERESTING' | 'DEEPEN' | 'NOT_USEFUL';
export type NewsStatus = 'NEW' | 'INTERESTING' | 'DEEPENING' | 'ENRICHED' | 'NOT_USEFUL' | 'ARCHIVED';
export type Utility = 'ARCHIVE_ONLY' | 'REVIEW' | 'NEWS_CANDIDATE';
export interface NewsEnrichment {
    checkedAt: string;
    facts: FactNews['fact'][];
    history: {
        id: string;
        type: string;
        date: string | null;
        url: string;
    }[];
    market: {
        propertyId: string;
        agency: string | null;
        price: number | null;
        sqm: number | null;
        rooms: number | null;
        floor: string | null;
        state: string | null;
        exit: string | null;
        sold: string | null;
    }[];
    references: {
        addresses?: {
            displayName?: string;
            streetName?: string;
            streetNumber?: string;
        }[];
        cadastral?: {
            sheet?: string;
            parcel?: string;
            subaltern?: string;
        }[];
        territorial?: unknown[];
    } | null;
    gaps: string[];
    sources: {
        url: string;
        status: string;
        hash?: string;
        pages?: number;
    }[];
}
export interface NewsFeedback {
    candidate_id: string;
    decision: NewsDecision | null;
    reason: string | null;
    status: NewsStatus;
    revision: number;
    enrichment: NewsEnrichment | null;
    source_signature: string;
    updated_at: string;
    event_type: string;
    first_shown_at: string | null;
    history?: {
        decision: NewsDecision;
    }[];
}
export interface NewsSourceContext {
    disposition: 'ACCOUNTING_ONLY' | 'ALREADY_AWARDED' | 'INDIRECT_WORKSITE' | 'LOCATION_CLAIM';
    addressClaim?: string;
    field?: string;
    row?: number;
    claim: string;
    url: string;
    hash: string;
    observedAt: string;
}
export interface NewsCandidate {
    id: string;
    anchor: FactNews;
    facts: FactNews[];
    context: FactNews[];
    utility: Utility;
    reason: string;
    group: string;
    priority: number;
    title: string;
    why: string;
    unknown: string;
    signature: string;
    sourceContext?: NewsSourceContext;
}
export function romeToday(now: number) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export const administrativeDate = (r: FactNews) => r.fact.document_date ?? r.event_date;
export function operationalFact(r: FactNews, now: number) { const d = administrativeDate(r); return !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && d >= NEWS_POLICY.start && d <= romeToday(now); }
const transformative = new Set(['FRAZIONAMENTO', 'FUSIONE', 'CAMBIO_DESTINAZIONE_USO', 'NUOVA_COSTRUZIONE', 'DEMOLIZIONE_RICOSTRUZIONE', 'AMPLIAMENTO', 'SOPRAELEVAZIONE', 'RISTRUTTURAZIONE_IMPORTANTE']);
export function classifyNews(row: FactNews, context: FactNews[] = []): {
    utility: Utility;
    reason: string;
    group: string;
    priority: number;
} {
    const t = row.event_type, f = row.fact;
    const out = (utility: Utility, reason: string, group = 'transformation', priority = 0) => ({ utility, reason, group, priority });
    if (['PARTIAL_ASSET', 'SUPPORTING_ADMINISTRATION', 'REGULARIZATION_REFERENCE'].includes(f.event_subtype ?? ''))
        return out('ARCHIVE_ONLY', 'COMMON_OR_ADMINISTRATIVE_REFERENCE');
    if (['ALIENAZIONE', 'ASTA', 'DISMISSIONE', 'CESSIONE'].includes(t))
        return out('NEWS_CANDIDATE', 'EXPLICIT_ASSET_MOVEMENT', 'direct', 100);
    if (t === 'CAMBIO_DESTINAZIONE_USO') {
        if (!f.from_use || !f.to_use)
            return out('REVIEW', 'UNKNOWN_FROM_TO', 'transformation', 65);
        if (f.from_use === f.to_use)
            return out('ARCHIVE_ONLY', 'NO_FUNCTIONAL_CHANGE');
        return ['RESIDENTIAL', 'COMMERCIAL'].includes(f.to_use) ? out('NEWS_CANDIDATE', 'EXPLICIT_USE_CONVERSION', 'transformation', 90) : out('REVIEW', 'COMMERCIAL_USEFULNESS_TO_VERIFY', 'transformation', 55);
    }
    if (['FRAZIONAMENTO', 'FUSIONE'].includes(t))
        return /unità|unita|immobili|appartament/i.test(f.evidence_text) || f.units_before !== null || f.units_after !== null ? out('NEWS_CANDIDATE', 'UNIT_REORGANIZATION', 'units', 90) : out('REVIEW', 'UNIT_EXTENT_TO_VERIFY', 'units', 65);
    if (['NUOVA_COSTRUZIONE', 'DEMOLIZIONE_RICOSTRUZIONE', 'SOPRAELEVAZIONE'].includes(t))
        return out('NEWS_CANDIDATE', 'NEW_BUILT_ASSET', 'construction', 85);
    if (t === 'AMPLIAMENTO')
        return out('REVIEW', 'EXTENT_TO_VERIFY', 'construction', 60);
    if (t === 'FINE_LAVORI' || t === 'SCA_AGIBILITA') {
        const prior = context.some(p => p.building_id && p.building_id === row.building_id && p.record_id !== row.record_id && administrativeDate(p) && administrativeDate(p)! <= administrativeDate(row)! && transformative.has(p.event_type) && !['PARTIAL_ASSET', 'REGULARIZATION_REFERENCE', 'SUPPORTING_ADMINISTRATION'].includes(p.event_subtype ?? ''));
        if (f.completion_reported_by && f.completion_reported_by < NEWS_POLICY.start)
            return out('ARCHIVE_ONLY', 'HISTORICAL_COMPLETION_REFERENCE', 'completion');
        return t === 'FINE_LAVORI' || prior ? out('NEWS_CANDIDATE', prior ? 'COMPLETION_AFTER_TRANSFORMATION' : 'EXPLICIT_COMPLETION', 'completion', 95) : out('ARCHIVE_ONLY', 'ISOLATED_AGIBILITY', 'completion');
    }
    if (['CESSAZIONE_ATTIVITA', 'TRASFERIMENTO_ATTIVITA'].includes(t))
        return out('NEWS_CANDIDATE', 'BUSINESS_PREMISES_TO_VERIFY', 'commercial', 80);
    if (['VARIANTE_URBANISTICA', 'CAMBIO_DESTINAZIONE_URBANISTICA', 'POTENZIALE_EDIFICATORIO_MODIFICATO', 'BUILDABILITY_CHANGED', 'NUOVA_LOTTIZZAZIONE', 'PIANO_ATTUATIVO'].includes(t))
        return out('REVIEW', 'PLANNING_EFFECT_TO_VERIFY', 'land', 70);
    if (t === 'RISTRUTTURAZIONE_IMPORTANTE')
        return out('REVIEW', 'MAJOR_WORKS_TO_VERIFY', 'transformation', 60);
    return out('ARCHIVE_ONLY', 'GENERIC_OR_ISOLATED_CONTEXT');
}
const titles: Record<string, string> = { FRAZIONAMENTO: 'Immobile diviso in più unità', FUSIONE: 'Unità riunite in un immobile', NUOVA_COSTRUZIONE: 'Nuovo fabbricato', DEMOLIZIONE_RICOSTRUZIONE: 'Fabbricato da ricostruire', SOPRAELEVAZIONE: 'Un nuovo piano da verificare', AMPLIAMENTO: 'Immobile in ampliamento', FINE_LAVORI: 'Lavori conclusi', SCA_AGIBILITA: 'Agibilità dopo una trasformazione', ALIENAZIONE: 'Alienazione di un immobile', DISMISSIONE: 'Patrimonio in dismissione', CESSAZIONE_ATTIVITA: 'Un’attività ha dichiarato la cessazione', TRASFERIMENTO_ATTIVITA: 'Possibile cambio del locale commerciale' };
export function newsTitle(r: FactNews) {
    if (r.event_type === 'CAMBIO_DESTINAZIONE_USO') {
        const uses: Record<string, string> = { WAREHOUSE: 'deposito', OFFICE: 'ufficio', RESIDENTIAL: 'abitazione', COMMERCIAL: 'locale commerciale' };
        return r.fact.from_use && r.fact.to_use ? `Da ${uses[r.fact.from_use] ?? 'uso precedente'} a ${uses[r.fact.to_use] ?? 'nuovo uso'}` : 'Cambio d’uso da chiarire';
    }
    return titles[r.event_type] ?? (/URBANISTIC|LOTTIZZAZIONE|ATTUATIVO|BUILDABILITY|EDIFICATORIO/.test(r.event_type) ? 'Trasformazione urbanistica dell’area' : r.event_type === 'SANATORIA' || r.event_type === 'CONDONO' ? 'Regolarizzazione amministrativa' : r.event_type.includes('MANUTENZIONE') ? 'Intervento di manutenzione' : 'Informazione amministrativa');
}
export function buildNewsCandidates(rows: FactNews[], now: number, sourceContexts: Record<string, NewsSourceContext> = {}) {
    const real = rows.filter(r => !r.combination), groups = new Map<string, FactNews[]>();
    for (const r of real.filter(r => operationalFact(r, now))) {
        const list = groups.get(r.record_id) ?? [];
        list.push(r);
        groups.set(r.record_id, list);
    }
    const result: NewsCandidate[] = [];
    for (const [id, facts] of groups) {
        const first = facts[0], context = first.building_id ? real.filter(r => r.building_id === first.building_id && r.record_id !== id && administrativeDate(r) && administrativeDate(r)! <= administrativeDate(first)!) : [];
        const ranked = facts.map(anchor => ({ anchor, ...classifyNews(anchor, context) })).sort((a, b) => b.priority - a.priority || a.anchor.event_id.localeCompare(b.anchor.event_id)), best = ranked[0];
        const { anchor, group } = best;
        const why = group === 'direct' ? 'L’atto riguarda un possibile movimento patrimoniale: condizioni e beni vanno verificati.' : group === 'units' ? 'Potrebbero esserci unità autonome da verificare, senza una vendita dimostrata.' : group === 'completion' ? 'La trasformazione potrebbe essere arrivata a una fase utilizzabile.' : group === 'commercial' ? 'Il locale potrebbe cambiare disponibilità: l’atto non dimostra una vendita.' : group === 'land' ? 'Il valore o la funzione dell’area potrebbero cambiare; serve leggere le condizioni.' : anchor.event_type === 'CAMBIO_DESTINAZIONE_USO' && !anchor.fact.from_use ? 'Occorre conoscere l’uso di partenza e quello di arrivo prima di valutarne l’utilità.' : 'La trasformazione può cambiare le possibilità d’uso dell’immobile.';
        const sourceContext = sourceContexts[id];
        let utility = best.utility, reason = best.reason, priority = best.priority;
        if (sourceContext?.disposition === 'ACCOUNTING_ONLY') {
            utility = 'ARCHIVE_ONLY';
            reason = 'ACCOUNTING_AFTER_SALE';
            priority = 0;
        }
        if (sourceContext?.disposition === 'ALREADY_AWARDED') {
            utility = 'REVIEW';
            reason = 'SALE_ALREADY_AWARDED';
            priority = 55;
        }
        if (sourceContext?.disposition === 'INDIRECT_WORKSITE') {
            utility = 'REVIEW';
            reason = 'WORKSITE_INDIRECT_EVIDENCE';
            priority = 60;
        }
        if (utility === 'NEWS_CANDIDATE' && group !== 'direct' && !anchor.building_id) {
            utility = 'REVIEW';
            reason = 'ASSET_LOCATION_TO_VERIFY';
            priority = Math.min(priority, 65);
        }
        result.push({ id, anchor, facts, context, utility, reason, group, priority, title: sourceContext?.disposition === 'ALREADY_AWARDED' ? 'Alienazione già aggiudicata' : sourceContext?.disposition === 'INDIRECT_WORKSITE' ? 'Un cantiere di ricostruzione da localizzare' : newsTitle(anchor), why: sourceContext?.disposition === 'ALREADY_AWARDED' ? 'L’aggiudicazione risulta già approvata: serve verificare l’esito, non presumere un bene ancora disponibile.' : sourceContext?.disposition === 'INDIRECT_WORKSITE' ? 'Un’ordinanza di circolazione richiama un cantiere; non dimostra titolo edilizio o unità disponibili.' : why, unknown: 'La futura vendita non è dimostrata. Il collegamento allo stabile non identifica la singola unità.', signature: facts.map(r => `${r.event_id}:${r.evidence_location.source_hash}`).sort().join('|') + (sourceContext ? `|${sourceContext.hash}:${sourceContext.disposition}` : ''), sourceContext });
    }
    return result.sort((a, b) => b.priority - a.priority || (administrativeDate(b.anchor) ?? '').localeCompare(administrativeDate(a.anchor) ?? '') || a.id.localeCompare(b.id));
}
export function filterNews(candidates: NewsCandidate[], feedback: NewsFeedback[], status = 'new', type = 'all', query = '', building = '') {
    const decisions = new Map(feedback.map(f => [f.candidate_id, f]));
    return candidates.filter(c => {
        if (c.utility === 'ARCHIVE_ONLY')
            return false;
        const f = decisions.get(c.id), s = f?.status ?? 'NEW';
        return (status === 'interesting' ? s === 'INTERESTING' : status === 'deepen' ? ['DEEPENING', 'ENRICHED'].includes(s) : status === 'rejected' ? s === 'NOT_USEFUL' : s === 'NEW') && (type === 'all' || c.group === type) && (!building || c.anchor.building_id === building) && `${c.anchor.street ?? ''} ${c.anchor.civic ?? ''} ${c.anchor.area_name ?? ''}`.toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it'));
    });
}
