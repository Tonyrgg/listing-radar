"use client";
import {createContext,useContext,useEffect,useState,useCallback,useRef,type ReactNode} from 'react';
import {useRouter} from "next/navigation";
import Link from 'next/link';
import {Bell,Star,Check} from 'lucide-react';
import type {UpdateRecap} from '@/lib/workspace-update-model';
import {formatCurrency,formatDate,formatNumber} from '@/lib/formatting';
import {EXIT_LABELS} from '@/lib/property-lifecycle/read-models/intelligence';
type State={updates?:Record<string,Record<string,UpdateRecap>>;notices:Record<string,Record<string,string>>;favorites:string[]};
const Context=createContext<{state:State;save:(body:unknown)=>Promise<void>;error:string}|null>(null);
export function WorkspaceUpdates({children}:{children:ReactNode}){
 const router=useRouter(),requestSequence=useRef(0);
 const [state,setState]=useState<State>({notices:{},favorites:[]}),[error,setError]=useState('');
 const refresh=useCallback(async()=>{const sequence=++requestSequence.current;try{const r=await fetch('/api/workspace-state',{cache:'no-store'});if(sequence!==requestSequence.current)return;if(r.status===401){setError('Accedi nuovamente per aggiornare gli avvisi');return;}if(!r.ok)throw Error();const next=await r.json();if(sequence!==requestSequence.current)return;setState(next);setError('');}catch{if(sequence!==requestSequence.current)return;setError('Avvisi non aggiornati; riprova tra poco');}},[]);
 useEffect(()=>{const initial=setTimeout(()=>void refresh(),0);const timer=setInterval(()=>{if(!document.hidden)void refresh()},60000);const focus=()=>void refresh();window.addEventListener('focus',focus);return()=>{clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',focus)}},[refresh]);
 async function save(body:unknown){try{const r=await fetch('/api/workspace-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok){await refresh();setError(r.status===409?'Sono disponibili nuove modifiche: controlla il riepilogo e riprova.':'Modifica non salvata. Riprova.');return;}await refresh();if((body as {action:string}).action==="favorite")router.refresh();}catch{setError('Modifica non salvata. Riprova.');}}
 return <Context.Provider value={{state,save,error}}>{children}</Context.Provider>;
}
export function TabNotice({tab}:{tab:string}){const c=useContext(Context),n=Object.keys(c?.state.notices[tab]??{}).length;return n?<span className="lr-notice-count" title={`${n} record nuovi o aggiornati da leggere`}>{n}</span>:null;}
export function NotificationBell(){const c=useContext(Context);if(!c)return null;const labels:Record<string,string>={mercato:'Mercato',opportunita:'Opportunità',privati:'Privati',usciti:'Usciti e venduti',notizie:'Notizie'};const total=new Set(Object.entries(c.state.notices).flatMap(([tab,records])=>Object.keys(records).map(id=>(tab==='notizie'?'news:':'property:')+id))).size;return <details className="lr-notification-menu"><summary aria-label={`${total} record da leggere`}><Bell size={18}/>{total?<span className="lr-notice-count">{total}</span>:null}</summary><div role="region" aria-label="Notifiche interne"><strong>Aggiornamenti dell’archivio</strong><p>Nuovi per te o cambiati dall’ultima lettura.</p>{Object.entries(labels).map(([tab,label])=><div key={tab}><Link href={`/intelligence?vista=${tab}`}>{label} <TabNotice tab={tab}/></Link><button onClick={()=>void c.save({action:'read',tab})}>Segna letti</button></div>)}{!total?<p>Nessun aggiornamento da leggere.</p>:null}{c.error?<p role="status">{c.error}</p>:null}</div></details>}
export function RecordTools({id,tab}:{id:string;tab:string}){const c=useContext(Context),[busy,setBusy]=useState(false);if(!c)return null;const active=c.state.favorites.includes(id),notice=c.state.notices[tab]?.[id];return <span className="lr-record-tools"><button disabled={busy} aria-label={active?'Rimuovi dai preferiti':'Aggiungi ai preferiti'} aria-pressed={active} onClick={async()=>{setBusy(true);try{await c.save({action:'favorite',id,active:!active})}finally{setBusy(false)}}}><Star size={15} fill={active?'currentColor':'none'}/></button>{notice?<button className="lr-unread" title="Segna questo record come letto" onClick={()=>void c.save(notice==='updated'&&tab!=='notizie'?{action:'read-property',tab,id,expectedHash:c.state.updates?.[tab]?.[id]?.hash}:{action:'read',tab,id})}>{notice==='updated'?'Aggiornato':'Nuovo'}</button>:null}</span>}
export function NewsNotice({id}:{id:string}){const c=useContext(Context),notice=c?.state.notices.notizie?.[id];return notice?<button className="lr-unread" onClick={()=>void c?.save({action:'read',tab:'notizie',id})}>{notice==='updated'?'Aggiornata':'Nuova'} · Segna letta</button>:null;}

function recapValue(field:string,value:string|number|null){
 if(value==null||value==='')return 'Non disponibile';
 if(field==='latest_asking_price'&&typeof value==='number')return formatCurrency(value);
 if(field==='earliest_market_evidence_at')return formatDate(String(value));
 if(field==='surface_sqm'&&typeof value==='number')return formatNumber(value)+' m²';
 if(field==='latitude'||field==='longitude')return String(value);
 if(typeof value==='number')return formatNumber(value);
 const labels:Record<string,string>={...EXIT_LABELS,UNKNOWN:'Da verificare',NOT_SOLD_CONFIRMED:'Non venduto, confermato',OUR_AGENCY:'La nostra agenzia',OBSERVED_AGENCY:'Altra agenzia',private:'Privato',unknown:'Venditore da verificare',agency:'Agenzia'};
 return labels[value]??value;
}
export function PropertyUpdateRecap({id,preferredTab='mercato'}:{id:string;preferredTab?:string}){
 const c=useContext(Context),[busy,setBusy]=useState(false);
 const tabs=[...new Set([preferredTab,...['mercato','opportunita','privati','usciti']])].filter(tab=>tab!=='notizie'&&tab!=='preferiti');
 const tab=tabs.find(tab=>c?.state.notices[tab]?.[id]==='updated');
 if(!c||!tab)return null;
 const recap=c.state.updates?.[tab]?.[id];
 const fallback=recap?.current??{};
 return <section className="lr-property-update" aria-label="Riepilogo aggiornamenti dell’immobile">
 <header><div><h2>Aggiornamenti dell’immobile</h2><p>Modifiche rispetto all’ultima versione che hai segnato come letta.</p></div><button type="button" className="lr-unread" disabled={busy} onClick={async()=>{setBusy(true);try{await c.save({action:'read-property',id,tab,expectedHash:recap?.hash})}finally{setBusy(false)}}}><Check size={14} aria-hidden="true"/>{busy?'Salvataggio…':'Segna come letto'}</button></header>
 {recap?.changes.length?<div className="lr-update-table"><table><caption className="sr-only">Confronto tra dati precedenti e attuali</caption><thead><tr><th>Dato cambiato</th><th>Prima</th><th>Adesso</th></tr></thead><tbody>{recap.changes.map(change=><tr key={change.field}><th scope="row">{change.label}</th><td>{recapValue(change.field,change.before)}</td><td>{recapValue(change.field,change.after)}</td></tr>)}</tbody></table></div>:recap?.previousUnavailable||!recap?<><p>Per questo avviso non erano conservati i valori precedenti: il confronto dettagliato non è disponibile.</p>{Object.keys(fallback).length?<dl className="lr-update-current">{[['latest_asking_price','Prezzo attuale'],['exit_classification','Esito attuale'],['agency_name','Agenzia attuale']].map(([field,label])=><div key={field}><dt>{label}</dt><dd>{recapValue(field!,fallback[field!]??null)}</dd></div>)}</dl>:null}</>:<p>Sono cambiati dati di riferimento dell’archivio; i campi riepilogati risultano invariati.</p>}
 {c.error?<p role="status">{c.error}</p>:null}
 </section>;
}
