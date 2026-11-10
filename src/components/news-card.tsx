import Link from 'next/link';
import { Split, Merge, House, Construction, Check, Store, Map, Banknote, Search, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDate, formatShouty, formatCurrency } from '@/lib/formatting';
import { administrativeDate, classifyNews, newsTitle, NEWS_POLICY, type NewsCandidate, type NewsFeedback } from '@/lib/property-lifecycle/buildings/news-triage';
import type { FactNews } from '@/lib/property-lifecycle/buildings/facts-read-model';
import { Meta } from './ui/primitives';
export function NewsCardContent({ candidate: c, feedback, actions }: {
    candidate: NewsCandidate;
    feedback?: NewsFeedback;
    actions?: ReactNode;
}) {
    const r = c.anchor, Icon = c.group === 'units' ? (r.event_type === 'FUSIONE' ? Merge : Split) : c.group === 'construction' ? Construction : c.group === 'completion' ? Check : c.group === 'commercial' ? Store : c.group === 'land' ? Map : c.group === 'direct' ? Banknote : r.event_type === 'CAMBIO_DESTINAZIONE_USO' ? House : Search;
    const status = feedback?.status;
    const address = r.street && r.civic ? `${r.street} ${r.civic}` : c.sourceContext?.addressClaim || r.street || r.area_name || 'Localizzazione da verificare';
    const locationDescription = r.building_id ? `Collegamento allo stabile${r.street ? `: ${formatShouty(address)}` : ''}. Non identifica la singola unit\u00e0.` : c.sourceContext?.addressClaim ? `Indirizzo citato nella fonte: ${formatShouty(c.sourceContext.addressClaim)}. Corrispondenza da confermare.` : r.street || r.area_name ? `Area indicata: ${formatShouty(address)}. Civico e immobile da verificare.` : 'La fonte non indica un luogo collegabile con certezza.';
    return <details className="lr-news-disclosure">
  <summary className="lr-news-summary"><span className="lr-news-icon"><Icon aria-hidden="true" size={18}/></span><div className="lr-news-summary-title"><span className="lr-news-kicker">{c.utility==="ARCHIVE_ONLY"?"Documento storico · ":"Notizia documentale · "}{({units:'Unità immobiliari',land:'Terreni e urbanistica',commercial:'Locali e attività',construction:'Interventi edilizi',completion:'Conclusione lavori',direct:'Patrimonio'} as Record<string,string>)[c.group]??'Trasformazione immobiliare'}</span><h3>{c.title}</h3><p>{situationDescription(c)}</p></div><div className="lr-news-summary-place"><strong>{formatShouty(address)}</strong><time>{formatDate(administrativeDate(r))}</time><span>{r.evidence_location.field==='pdf.text'?'PDF primario':'Scheda del registro'}</span></div><ChevronDown className="lr-news-disclosure-arrow" size={16} aria-hidden="true"/></summary>
  <div className="lr-news-expanded">
  <div className="lr-news-reading-grid">
   <div className="lr-news-reading-main">
    <section><h4>Cosa sappiamo</h4><p>{situationDescription(c)}</p><blockquote><span>Estratto della fonte</span>«{r.evidence_text}»</blockquote>{r.fact.units_before!==null||r.fact.units_after!==null?<p>Unità dichiarate: {r.fact.units_before??"non noto"} → {r.fact.units_after??"non noto"}.</p>:null}</section>
    <section><h4>Perché può interessarti</h4><p>{/già aggiudicat/i.test(c.title)?"Aiuta a ricostruire un passaggio patrimoniale già avviato. Va consultata come storia del bene, senza presumere un’offerta ancora attiva.":c.why}</p></section>
    <section className="lr-news-next-check"><h4>Cosa non sappiamo</h4><p>{/già aggiudicat/i.test(c.title)?"Restano da verificare l’immobile esatto, il completamento del trasferimento e lo stato attuale del bene. Il collegamento allo stabile non identifica la singola unità.":c.unknown}</p></section>
   </div>
   <aside className="lr-news-reference" aria-label="Riferimenti della situazione">
    <h4>Documento da consultare</h4><SourceLink row={r}/>
    <dl><div><dt>Pratica</dt><dd>{r.practice_number||"Numero non dichiarato"}</dd></div><div><dt>Stato della lettura</dt><dd>{status&&status!=="NEW"?({INTERESTING:"Interessante",DEEPENING:"Da approfondire",ENRICHED:"Approfondimento disponibile",NOT_USEFUL:"Scartata",ARCHIVED:"Archiviata"})[status]:c.utility==="ARCHIVE_ONLY"?"Contesto storico":c.utility==="REVIEW"?"Da chiarire":"Da valutare"}</dd></div></dl>
    <p>{locationDescription}</p>
    <p><strong>Mercato conosciuto</strong><br/>{r.building_id?(r.active_properties?r.active_properties+" immobili attivi nello stabile":"Nessun immobile attivo conosciuto nello stabile"):"Stabile non associato con certezza"}{r.building_id&&r.historical_properties?" · "+r.historical_properties+" immobili storici":""}</p>
    {feedback&&feedback.source_signature!==c.signature?<p>Prove aggiornate dopo la tua valutazione.</p>:null}
   </aside>
  </div>
  {actions?<div className="lr-news-actions">{actions}</div>:null}
  {feedback?.enrichment?<details className="lr-news-details"><summary>Risultati dell’approfondimento</summary>{feedback?.enrichment ? <div className="space-y-3"><h4 className="font-semibold">Approfondimento · {formatDate(feedback.enrichment.checkedAt)}</h4>{feedback.enrichment.facts.map(f => <p key={f.id}>La prova dichiara «{f.evidence_text}»{f.units_after !== null ? ` · ${f.units_before ?? '?'} → ${f.units_after} unità` : ''}{f.from_use && f.to_use ? ' · usi di partenza e arrivo presenti nella prova' : ''}.</p>)}{feedback.enrichment.attributes?.map((a, i) => <p key={`${a.field}:${a.page}:${i}`}>{a.label}: «{a.claim}». Riferimento del documento, unità non certificata.</p>)}{feedback.enrichment.market.map(m => <p key={m.propertyId}><Link href={`/casa/${m.propertyId}`} className="underline">Immobile nello stesso stabile</Link> · {m.agency ?? 'agenzia non nota'} · ultimo richiesto {formatCurrency(m.price)}{m.sqm ? ` · ${m.sqm} m²` : ''}{m.rooms ? ` · ${m.rooms} locali` : ''} · {m.sold ? 'vendita dichiarata' : m.exit === 'SOLD_CONFIRMED' ? 'vendita confermata' : m.state === 'ACTIVE' ? 'attivo' : 'stato da verificare'}</p>)}{feedback.enrichment.references?.addresses?.map((a, i) => <p key={i}>Indirizzo dichiarato: {a.displayName ?? [a.streetName, a.streetNumber].filter(Boolean).join(" ")}</p>)}{feedback.enrichment.references?.cadastral?.map((a, i) => <p key={i}>Catasto dichiarato: foglio {a.sheet ?? "?"}, particella {a.parcel ?? "?"}, sub {a.subaltern ?? "?"}. Corrispondenza all’unità non certificata.</p>)}<ul className="list-disc space-y-1 pl-5">{feedback.enrichment.gaps.map(g => <li key={g}>{g}</li>)}</ul><Meta>Approfondimento delle prove disponibili; nessuna intenzione di vendita dimostrata.</Meta></div> : null}</details>:null}
  <details className="lr-news-details"><summary className="min-h-11 cursor-pointer py-3 font-medium">Prove e provenienza</summary><ul className="space-y-4 break-words pb-3">{c.sourceContext ? <li><blockquote>«{c.sourceContext.claim}»</blockquote><a href={c.sourceContext.url} target="_blank" rel="noreferrer" className="underline">Voce del registro, non documento primario</a><Meta>Verificata {formatDate(c.sourceContext.observedAt)}{c.sourceContext.row ? ` · riga ${c.sourceContext.row}` : ""}{c.sourceContext.addressClaim ? " · indirizzo dichiarato, corrispondenza non certificata" : ""}</Meta></li> : null}{[...c.facts, ...c.context].map(f => <li key={f.event_id}><p>{newsTitle(f)} · {formatDate(administrativeDate(f))}{f.record_id !== c.id ? ' · contesto precedente' : ''}</p><blockquote>«{f.evidence_text}»</blockquote><SourceLink row={f}/><Meta>{f.evidence_location.field}{f.evidence_location.page ? ` · pagina ${f.evidence_location.page}` : ''}{f.evidence_location.row ? ` · riga ${f.evidence_location.row}` : ''} · osservato {formatDate(f.observed_at)}</Meta></li>)}{feedback?.enrichment?.facts.map(f => <li key={f.id}><blockquote>«{f.evidence_text}»</blockquote><a href={f.evidence_location.source_url} target="_blank" rel="noreferrer" className="underline">Prova approfondita</a><Meta>{f.evidence_location.field}{f.evidence_location.page ? ` · pagina ${f.evidence_location.page}` : ""} · osservato {formatDate(f.observed_at)}</Meta></li>)}{feedback?.enrichment?.attributes?.map((a, i) => <li key={`attribute:${i}`}><blockquote>«{a.claim}»</blockquote><a href={a.url} target="_blank" rel="noreferrer" className="underline">{a.label} · fonte</a><Meta>{a.field}{a.page ? ` · pagina ${a.page}` : ""}</Meta></li>)}{feedback?.enrichment?.sources.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="underline">Documento approfondito</a> · {s.status}{s.pages ? ` · ${s.pages} pagine lette` : ''}</li>)}{r.building_id ? <li><Link href={`/map?edificio=${r.building_id}#edificio`} className="underline">Apri il contesto dello stabile</Link></li> : null}</ul></details>
  <details className="lr-news-details"><summary className="min-h-11 cursor-pointer py-3 text-[var(--lr-ink-2)]">Dettagli tecnici</summary><dl className="space-y-2 break-words pb-3"><div><dt>Classificazione</dt><dd>{r.event_type} · {c.utility} · {c.reason}</dd></div><div><dt>Policy</dt><dd>{NEWS_POLICY.version} · {r.classification_version}</dd></div><div><dt>Territorio / certezza della regola</dt><dd>{r.territorial_level} · {Math.round(Number(r.confidence) * 100)}% (non probabilità di vendita)</dd></div><div><dt>Hash della fonte</dt><dd className="break-all">{r.evidence_location.source_hash}</dd></div><div><dt>Valutazione</dt><dd>{feedback?.decision ?? 'NEW'}{feedback?.reason ? ` · ${feedback.reason}` : ''}</dd></div></dl></details>
 </div></details>;
}
function SourceLink({ row: r }: {
    row: FactNews;
}) {
    const primaryDocument = r.evidence_location.field === 'pdf.text';
    const protocolType = r.event_type === 'FRAZIONAMENTO' ? 'FRAZIONAMENTO' : r.event_type === 'FUSIONE' ? 'FUSIONE_ACCOPPIAMENTO' : r.event_type === 'CAMBIO_DESTINAZIONE_USO' ? 'CAMBIO_DESTINAZIONE_USO' : /BUILDABILITY|URBANISTIC|LOTTIZZAZIONE|PIANO_ATTUATIVO|EDIFICATORIO/.test(r.event_type) ? 'land' : 'utili';
    return <div className="flex flex-wrap gap-x-4 gap-y-2">
        <a href={r.evidence_location.source_url} target="_blank" rel="noreferrer" className="underline">{primaryDocument ? 'Documento primario \u00b7 PDF' : 'Scheda del registro \u00b7 non \u00e8 il documento primario'}</a>
        {!primaryDocument ? <Link href={`/fonti/pratiche?${new URLSearchParams({ tipo: protocolType, ...(r.practice_number ? { pratica: r.practice_number } : {}) })}`} className="underline">Cerca l’atto nella coda documenti</Link> : null}
    </div>;
}
function situationDescription(c: NewsCandidate) {
    const fact = c.anchor.fact;
    if(/già aggiudicat/i.test(c.title))return "L’aggiudicazione risulta già approvata. La disponibilità attuale del bene non è dimostrata: occorre verificare l’atto e il suo esito.";
    if (c.anchor.event_type === 'BUILDABILITY_CHANGED' && fact.from_use && fact.to_use) {
        const state = (value: string) => value === 'NON_BUILDABLE' ? 'non edificabile' : value === 'BUILDABLE' ? 'edificabile' : 'da verificare';
        return `La pratica segnala un passaggio del terreno da ${state(fact.from_use)} a ${state(fact.to_use)}. \u00c8 una dichiarazione da controllare nell\u2019atto e nella pianificazione vigente.`;
    }
    if (c.anchor.event_type === 'CAMBIO_DESTINAZIONE_USO' && fact.from_use && fact.to_use) {
        const labelUse = (value: string) => ({ OFFICE: 'ufficio', RESIDENTIAL: 'abitazione', COMMERCIAL: 'locale commerciale', WAREHOUSE: 'deposito' }[value] ?? value.toLowerCase());
        return `La pratica descrive il passaggio da ${labelUse(fact.from_use)} a ${labelUse(fact.to_use)}. La richiesta o il titolo non dimostrano da soli che il cambio sia stato completato.`;
    }
    if (c.anchor.event_type === 'FRAZIONAMENTO') return 'La pratica menziona una divisione dell\u2019immobile in pi\u00f9 unit\u00e0. Numero, indirizzo e autonomia delle unit\u00e0 vanno verificati nel documento.';
    if (c.anchor.event_type === 'FUSIONE') return 'La pratica menziona l\u2019unione di unit\u00e0 immobiliari. Numero, indirizzo e stato dell\u2019intervento vanno verificati nel documento.';
    if (c.anchor.event_type === 'CESSAZIONE_ATTIVITA') return '\u00c8 stata dichiarata la cessazione di un\u2019attivit\u00e0. Non prova che il locale sia libero o in vendita.';
    if (c.anchor.event_type === 'TRASFERIMENTO_ATTIVITA') return 'La pratica segnala il trasferimento di un\u2019attivit\u00e0. Occorre verificare quale locale riguarda e se \u00e8 rimasto disponibile.';
    if (c.anchor.event_type === 'ALIENAZIONE' || c.anchor.event_type === 'DISMISSIONE') return 'L\u2019atto riguarda una possibile vendita o dismissione patrimoniale. Bene ed esito vanno verificati nel documento.';
    return `La pratica comunale riporta: \u00ab${c.anchor.evidence_text}\u00bb. ${c.utility === 'REVIEW' ? 'Il significato immobiliare e il luogo restano da verificare.' : 'La descrizione riassume quanto dichiarato, senza attestare esecuzione o disponibilit\u00e0 alla vendita.'}`;
}

export function historyCandidate(r: FactNews): NewsCandidate { return { id: r.record_id, anchor: r, facts: [r], context: [], utility: 'ARCHIVE_ONLY', reason: 'HISTORICAL_CONTEXT', group: classifyNews(r).group, priority: 0, title: newsTitle(r), why: 'Questa dichiarazione aiuta a ricostruire la storia amministrativa dello stabile.', unknown: 'La futura vendita non è dimostrata. Il collegamento territoriale non identifica la singola unità.', signature: r.event_id }; }
