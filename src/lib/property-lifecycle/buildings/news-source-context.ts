import type { NewsSourceContext } from './news-triage';
import {judicialArchiveOnly} from './public-record-policy';
/** Bounded literal source qualification, not a human judgement and not a new fact. */
export function newsSourceContext(text: string, url: string, hash: string, observedAt: string): NewsSourceContext | undefined {
    if(judicialArchiveOnly(text))return {disposition:'JUDICIAL_ARCHIVE_ONLY',claim:'Procedura giudiziaria esclusa dal trattamento',url,hash,observedAt,field:'albo.subject'};
    const accounting = text.match(/accertamento\s+in\s+entrata|liquidazione|impegno\s+di\s+spesa/i);
    const awarded = text.match(/approvazione\s+delle\s+risultanze\s+di\s+gara\s+e\s+aggiudicazione\s+definitiva|aggiudicazione\s+definitiva/i);
    const indirect = text.match(/prescrizioni\s+alla\s+circolazione/i);
    const match = accounting ?? awarded ?? indirect;
    if (!match)
        return;
    const addressClaim = text.match(/sito\s+in\s+([^,]{2,140})/i)?.[1] ?? text.match(/^((?:VIALE|VIA|PIAZZA)\b.{2,160}?)\s+-\s+/i)?.[1];
    return { disposition: accounting ? 'ACCOUNTING_ONLY' : awarded ? 'ALREADY_AWARDED' : 'INDIRECT_WORKSITE', claim: match[0], url, hash, observedAt, field: 'albo.subject', ...(addressClaim ? { addressClaim } : {}) };
}
