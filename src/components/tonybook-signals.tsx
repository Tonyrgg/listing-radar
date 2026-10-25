import Link from 'next/link';
import {selectTonyBookVerification} from '@/lib/actions/tonybook';
import {buttonClass,Chip,Meta} from './ui/primitives';
import type {SourceReference} from '@/lib/seller-intake/provenance';
export interface TonySignal{id:string;state:'ACTIVE'|'REJECTED'|'UNKNOWN';signature:string;reference:SourceReference;fact:string;unknowns:string}
export function TonyBookSignals({signals,page,total}:{signals:TonySignal[];page:number;total:number}){
 return <main className="mx-auto max-w-[72ch] space-y-6"><header className="space-y-3"><h1 className="text-[length:var(--lr-text-page)] font-semibold">Segnali TonyBook</h1><p>Seleziona una verifica documentale. Il fatto dichiarato e il ruolo dell’autore restano da verificare; questa scelta non avvia un contatto.</p><Link href="/richieste" className={buttonClass('secondary')}>Torna a richieste e verifiche</Link></header>
 {!signals.length&&<p>Nessun segnale in questa pagina. Il registro si alimenta con importazioni esplicite, senza letture automatiche di Facebook.</p>}
 {signals.map(s=><article key={s.id} className="space-y-3 border-t border-[var(--lr-line)] py-5 break-words"><Chip>{s.state==='ACTIVE'?'Da approfondire':s.state==='REJECTED'?'Scartato':'Stato da verificare'}</Chip><h2 className="text-[length:var(--lr-text-section)]">{s.id}</h2><p>{s.fact}</p><p>{s.unknowns}</p><Meta>Osservazione: {new Intl.DateTimeFormat('it-IT',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(s.reference.observedAt))} · {s.reference.publishedAt?'data originale '+new Intl.DateTimeFormat('it-IT',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(s.reference.publishedAt)):'data originale non verificata'}</Meta>
 {s.reference.sourceUrl&&<a className="underline" href={s.reference.sourceUrl} target="_blank" rel="noreferrer">Apri la fonte</a>}
 {s.state==='ACTIVE'&&<form action={selectTonyBookVerification}><input type="hidden" name="id" value={s.id}/><input type="hidden" name="signature" value={s.signature}/><input type="hidden" name="confirmed" value="yes"/><button className={buttonClass('primary')}>Pianifica una verifica</button></form>}</article>)}
 <nav aria-label="Pagine dei segnali" className="flex flex-wrap gap-3">{page>1&&<Link href={'?page='+(page-1)} className={buttonClass('secondary')}>Precedenti</Link>}{page*50<total&&<Link href={'?page='+(page+1)} className={buttonClass('secondary')}>Successivi</Link>}</nav>
 </main>;
}
