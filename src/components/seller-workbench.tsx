import Link from 'next/link';
import type { SellerCase } from '@/lib/seller-intake/repository';
import { ACTIONS, CASE_STATUSES } from '@/lib/seller-intake/model';
import { SellerCaseReview } from './seller-case-review';
import { buttonClass, Chip, Meta } from './ui/primitives';
import { deliveryStatusLabel } from '@/lib/seller-intake/delivery-status';
import type { SellerCasePage } from '@/lib/seller-intake/repository';
import {MODULE_LABELS} from '@/lib/seller-intake/provenance';
export interface SellerMetrics {received:number;verifications:number;contacted:number;appointments:number;appointmentsHeld?:number;valuations:number;mandates:number;bySource?:{source:string;campaignId:string|null;received:number;contacted:number;appointments:number;appointmentsHeld:number;valuations:number;mandates:number}[]}
const labels: Record<string,string> = {
  considering_sale:'Valuta una vendita', understand_value:'Vuole capire il valore', already_on_market:'Già sul mercato',
  owner:'Proprietario / comproprietario dichiarato', on_behalf:'Agisce per conto del proprietario',
  apartment:'Appartamento', independent:'Casa indipendente', villa:'Villa', other:'Altro',
  within_3_months:'Entro 3 mesi', '3_6_months':'3–6 mesi', later:'Più avanti', undecided:'Tempi non decisi',
  morning:'Mattina', afternoon:'Pomeriggio', evening:'Sera', Bitonto_other:'Altra zona del Comune di Bitonto',
};
const date = (v: string) => new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'medium',timeStyle:'short'}).format(new Date(v));
const sourceDate=(v:string)=>v.length===10?new Intl.DateTimeFormat('it-IT',{timeZone:'UTC',dateStyle:'medium'}).format(new Date(v)):date(v);
export function SellerWorkbench({items,metrics,closed=false,pagination}:{items:SellerCase[];metrics:SellerMetrics;closed?:boolean;pagination?:Omit<SellerCasePage,'items'>}) {
  return <main className="mx-auto max-w-[72ch] space-y-6">
    <header className="space-y-3"><h1 className="text-[length:var(--lr-text-page)] font-semibold">Richieste e verifiche</h1>
      <p>Le richieste di telefonata e le verifiche documentali hanno percorsi distinti. Una notizia interessante non identifica un venditore.</p>
      <p className="text-[var(--lr-ink-2)]">Ingresso esterno in collaudo locale. Notifiche e WhatsApp non collegati: nessun messaggio viene inviato.</p>
      <p>Esiti registrati — richieste: {metrics.received}; contatti avvenuti: {metrics.contacted}; appuntamenti fissati: {metrics.appointments}; appuntamenti svolti: {metrics.appointmentsHeld??0}; valutazioni svolte: {metrics.valuations}; incarichi: {metrics.mandates}. Verifiche documentali separate: {metrics.verifications}.</p>
      {!!metrics.bySource?.length&&<details><summary className="min-h-11 cursor-pointer py-3">Esiti per provenienza ricevuta</summary>{metrics.bySource.map(s=><p key={`${s.source}:${s.campaignId??''}`}>{s.source==='meta_form'?'Modulo Meta':s.source==='local_test'?'Collaudo locale':'Fonte non verificata'} · {s.campaignId?`campagna ${s.campaignId}`:'campagna non identificata'}: {s.received} richieste, {s.appointmentsHeld} appuntamenti svolti, {s.mandates} incarichi.</p>)}</details>}
      <nav aria-label="Stato delle pratiche" className="flex flex-wrap gap-2"><Link className={buttonClass(closed?'secondary':'primary')} href="/richieste">Aperte</Link><Link className={buttonClass(closed?'primary':'secondary')} href="/richieste?closed=1">Chiuse</Link><Link className={buttonClass('quiet')} href="/intelligence">Torna a Intelligence</Link><Link className={buttonClass('quiet')} href="/richieste/segnali">Segnali TonyBook</Link></nav>
    </header>
    {!items.length && <p>Nessuna pratica {closed ? 'chiusa' : 'aperta'}. Puoi pianificare una verifica da una notizia segnata interessante. Le richieste di prova entrano dall’ingresso locale protetto.</p>}
    {items.map(item => <article key={`${item.id}:${item.revision}`} id={`pratica-${item.id}`} className="space-y-4 border-t border-[var(--lr-line)] py-6 break-words">
      <div className="flex flex-wrap gap-2"><Chip>{item.kind==='INBOUND'?'Richiesta ricevuta':'Verifica documentale'}</Chip><Chip>{CASE_STATUSES[item.status]}</Chip></div>
      <h2 className="text-[length:var(--lr-text-section)]">{item.title}</h2>
      <Meta>Ricevuta il {date(item.created_at)}{item.next_action_at ? ` · ${ACTIONS[item.next_action]}: ${date(item.next_action_at)}` : ' · Nessun prossimo passo'}</Meta>
      {item.kind==='INBOUND' ? <div className="space-y-2">
        <p>{item.submission.name} · {item.submission.phone}{item.submission.email ? ` · ${item.submission.email}` : ''}</p>
        <p>Recapito e ruolo dichiarati, ancora da verificare. Telefonata richiesta; nessuna iscrizione marketing.</p>
        <p>{Object.values(item.submission.answers ?? {}).map(v=>labels[v]??v).join(' · ')}</p>
        <p>Scelta WhatsApp iniziale: {item.submission.whatsappOptIn ? 'richiesto' : 'non autorizzato'}. Le eventuali revoche restano nello storico delle consegne.</p>
      </div> : <div className="space-y-2">{item.submission.fact&&<p>{item.submission.fact}</p>}<p>{item.submission.unknown}</p>{item.submission.sourceUrl && /^https:\/\//.test(item.submission.sourceUrl) && <a href={item.submission.sourceUrl} className="underline" rel="noreferrer" target="_blank">Leggi la fonte</a>}</div>}
      {item.seller_delivery_outbox.length>0 && <p className="text-[var(--lr-ink-2)]">Consegne: {item.seller_delivery_outbox.map(o=>`${o.channel==='WHATSAPP'?'WhatsApp':'Notifica operatore'} ${o.status==='SENT'&&o.provider==='MOCK'?'simulata e confermata':deliveryStatusLabel(o.status)}`).join(' · ')}.</p>}
      {(item.seller_case_sources??[]).map(s=><p key={`${s.reference.module}:${s.reference.sourceType}:${s.reference.sourceId}`}>Fonte: {MODULE_LABELS[s.reference.module]} · osservata il {sourceDate(s.reference.observedAt)} · {s.reference.publishedAt?`pubblicata il ${sourceDate(s.reference.publishedAt)}`:'data originale non verificata'}{s.reference.sourceUrl&&<>{' · '}<a className="underline" href={s.reference.sourceUrl} rel="noreferrer" target="_blank">Apri la prova</a></>}</p>)}
      {(item.seller_case_property_links??[]).map(link=><p key={link.property_id}><Link href={`/casa/${link.property_id}`} className="underline">Immobile collegato esplicitamente</Link> · {link.note}</p>)}
      <details><summary className="min-h-11 cursor-pointer py-3">Registra un esito</summary><SellerCaseReview item={item}/></details>
      <details><summary className="min-h-11 cursor-pointer py-3">Storico e provenienza</summary><ol className="space-y-3">{[...item.seller_case_history].sort((a,b)=>b.revision-a.revision).map(h=><li key={h.revision}><Meta>{date(h.created_at)}</Meta><p>{h.note}</p></li>)}</ol>{item.kind==='INBOUND' && <p>Modulo {item.submission.formVersion}; informativa dichiarata {item.submission.privacyVersion}; fonte {item.submission.attribution?.source}. Identificativi campagna conservati solo se ricevuti.</p>}</details>
    </article>)}
    {pagination && <nav aria-label="Pagine delle pratiche" className="flex flex-wrap items-center gap-3">
      <p>Pagina {pagination.page} di {Math.max(1,Math.ceil(pagination.total/pagination.pageSize))} · {pagination.total} pratiche</p>
      {pagination.page>1 && <Link className={buttonClass('secondary')} href={`/richieste?${closed?'closed=1&':''}page=${pagination.page-1}`}>Precedenti</Link>}
      {pagination.hasNext && <Link className={buttonClass('secondary')} href={`/richieste?${closed?'closed=1&':''}page=${pagination.page+1}`}>Successive</Link>}
    </nav>}
  </main>;
}
