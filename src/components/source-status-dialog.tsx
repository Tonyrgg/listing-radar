"use client";
import {useRef,useState,useId} from 'react';
import {Activity,RefreshCw,X} from 'lucide-react';
import Link from 'next/link';
import {buttonClass} from './ui/primitives';
import type {SourcesSummary} from '@/lib/sources-health';
type Status={checkedAt:string;archive:{status:'unavailable'|'error'|'pending'|'ready';refreshedAt:string|null};agencies:SourcesSummary;privates:{available:boolean;rows:{source:string;checked_at:string;state:string;discovered_count:number;failed_count:number}[]}};
const portals:Record<string,string>={idealista:'Idealista',immobiliare:'Immobiliare.it',casa:'Casa.it',subito:'Subito',casadaprivato:'CasaDaPrivato'};
function date(value:string|null){return value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('it-IT',{timeZone:'Europe/Rome',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Non disponibile';}
export function SourceStatusDialog(){
 const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null),generation=useRef(0),titleId=useId();
 const [data,setData]=useState<Status|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 async function reload(){const current=++generation.current;setLoading(true);setError('');try{const r=await fetch('/api/source-status',{cache:'no-store'});if(!r.ok)throw Error(r.status===401?'Accedi nuovamente per consultare le letture.':'Stato delle letture non disponibile. Riprova.');const next=await r.json();if(current===generation.current)setData(next);}catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'Lettura non disponibile');}finally{if(current===generation.current)setLoading(false);}}
 const issues=[...(data?.agencies.broken??[]),...(data?.agencies.partial??[])];
 return <><button ref={opener} type="button" className={buttonClass('secondary',{compact:true})} onClick={()=>{dialog.current?.showModal();void reload();}}><Activity size={16} aria-hidden="true"/>Stato delle letture</button>
 <dialog ref={dialog} className="lr-reading-dialog" aria-labelledby={titleId} onClose={()=>{generation.current++;setLoading(false);opener.current?.focus();}} onClick={e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close();}}>
  <header><div><h2 id={titleId}>Stato delle letture</h2><p>Copertura delle fonti e aggiornamento dell’archivio</p></div><button type="button" aria-label="Chiudi stato delle letture" className={buttonClass('quiet',{compact:true,icon:true})} onClick={()=>dialog.current?.close()}><X size={20}/></button></header>
  <div className="lr-reading-content" aria-busy={loading}>
   {error?<p role="alert" className="lr-reading-error">{error}{data?' Le informazioni sotto appartengono all’ultimo controllo riuscito.':''}</p>:null}
   {loading&&!data?<p role="status">Caricamento dello stato delle letture…</p>:null}
   {data?<>
    <section aria-label="Aggiornamento archivio"><h3>Archivio</h3><dl className="lr-reading-facts"><div><dt>Ultima elaborazione</dt><dd>{date(data.archive.refreshedAt)}</dd></div><div><dt>Stato</dt><dd><span className="lr-reading-status" data-state={data.archive.status}>{({ready:'Aggiornato',pending:'Nuovi dati in elaborazione',error:'Aggiornamento da riprovare',unavailable:'Stato non disponibile'})[data.archive.status]}</span></dd></div></dl></section>
    <section aria-label="Letture agenzie"><div className="lr-reading-section-heading"><h3>Agenzie</h3><span>{data.agencies.available?`${data.agencies.healthy} regolari · ${issues.length} da verificare`:'Stato non disponibile'}</span></div>
    {issues.length?<div className="lr-reading-table"><table><caption className="sr-only">Fonti agenzia da verificare</caption><thead><tr><th>Fonte</th><th>Ultima lettura</th><th className="lr-numeric">Immobili in archivio</th></tr></thead><tbody>{issues.map(row=><tr key={row.name}><th scope="row">{row.name}</th><td>{row.note??'Lettura da verificare'}</td><td className="lr-numeric">{row.read}</td></tr>)}</tbody></table></div>:data.agencies.available?<p>{data.agencies.total?'Nessuna anomalia rilevata nelle letture delle agenzie.':'Nessuna fonte agenzia abilitata.'}</p>:<p>Non è stato possibile verificare le letture delle agenzie.</p>}
    </section>
    <section aria-label="Letture portali privati"><h3>Portali privati</h3>{!data.privates.available?<p>Stato dei portali temporaneamente non disponibile.</p>:<div className="lr-reading-table"><table><caption className="sr-only">Stato delle letture dei portali privati</caption><thead><tr><th>Portale</th><th>Stato</th><th>Ultimo controllo</th><th className="lr-numeric">URL raccolti</th></tr></thead><tbody>{Object.entries(portals).map(([key,label])=>{const row=data.privates.rows.find(r=>r.source===key),stale=row&&Date.parse(data.checkedAt)-Date.parse(row.checked_at)>2*3600000;return <tr key={key}><th scope="row">{label}</th><td><span className="lr-reading-status" data-state={!row||stale?'pending':row.state==='DEGRADED'?'error':'ready'}>{!row?'Non verificato':stale?'Controllo non recente':row.state==='DEGRADED'?'Parziale o bloccato':'Lettura effettuata'}</span></td><td>{date(row?.checked_at??null)}</td><td className="lr-numeric">{row?.discovered_count??'—'}</td></tr>;})}</tbody></table></div>}</section>
    <aside className="lr-reading-note">Una lettura bloccata conserva i dati precedenti e non dimostra la scomparsa di un annuncio. Gli URL raccolti non certificano la copertura completa. La data pubblica dell’annuncio è distinta dall’inizio del monitoraggio.</aside>
   </>:null}
  </div>
  <footer><span>{data?`Controllato il ${date(data.checkedAt)}`:''}</span><Link href="/fonti" onClick={()=>dialog.current?.close()}>Apri tutte le fonti</Link><button type="button" disabled={loading} className={buttonClass('secondary',{compact:true})} onClick={()=>void reload()}><RefreshCw size={14} aria-hidden="true"/>{loading?'Aggiornamento…':'Aggiorna'}</button></footer>
 </dialog></>;
}
