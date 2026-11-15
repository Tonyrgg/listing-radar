"use client";
import {useRef,useState,useEffect,useTransition,useCallback} from 'react';
import {loadWorkerStreetDirectory} from '@/app/(private)/map/actions';
import {buttonClass,controlClass} from '@/components/ui/primitives';
import type {ZoneStreetDirectory} from '../../../worker/src/territory/zone-streets';
import styles from './worker-street-directory.module.css';

export function WorkerStreetDirectory({loadDirectory=loadWorkerStreetDirectory}:{loadDirectory?:()=>Promise<ZoneStreetDirectory>}={}){
 const dialog=useRef<HTMLDialogElement>(null),[data,setData]=useState<ZoneStreetDirectory|null>(null),[error,setError]=useState(''),[pending,start]=useTransition();
 const [selected,setSelected]=useState<string[]>([]),[search,setSearch]=useState(''),[acquired,setAcquired]=useState(false),[expanded,setExpanded]=useState(false);
 const reload=useCallback(()=>{start(async()=>{try{setData(await loadDirectory());setError('');}catch(e){setError(e instanceof Error?e.message:'Elenco non disponibile');}});},[loadDirectory]);
 useEffect(()=>{const refresh=()=>{if(dialog.current?.open)reload();};const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[reload]);
 const groups=[...(data?.areas??[]).map(a=>({id:a.id,name:a.name,count:a.streetCount})),{id:'unassigned',name:'Fuori dalle zone disegnate',count:data?.streets.filter(s=>!s.unlocated&&!s.areaIds.length).length??0},{id:'unlocated',name:'Da localizzare',count:data?.streets.filter(s=>s.unlocated).length??0}];
 const belongs=(s:NonNullable<typeof data>['streets'][number],id:string)=>id==='unlocated'?s.unlocated:id==='unassigned'?!s.unlocated&&!s.areaIds.length:s.areaIds.includes(id);
 const rows=(data?.streets??[]).filter(s=>(!acquired||Boolean(s.lastScanAt)||Boolean(s.count))&&(!search.trim()||`${s.name} ${s.locality} ${s.id}`.toLocaleLowerCase('it').includes(search.trim().toLocaleLowerCase('it'))));
 const count=rows.filter(s=>!selected.length||selected.some(id=>belongs(s,id))).length;
 return <><button type="button" className={buttonClass('secondary')} onClick={()=>{dialog.current?.showModal();reload();}}>Vie per zona</button>
 <dialog ref={dialog} className={styles.dialog} aria-labelledby="worker-streets-title" onClick={e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close();}}>
  <header className={styles.header}><div><h2 id="worker-streets-title">Vie per zona</h2><p>Archivio condiviso del Worker V2</p></div><button type="button" className={buttonClass('quiet')} onClick={()=>dialog.current?.close()}>Chiudi</button></header>
  <div className={styles.layout}><aside className={styles.filters}><h3>Zone da mostrare</h3><button type="button" className={buttonClass('quiet')} onClick={()=>setSelected([])}>Tutte le zone</button>{groups.map(g=><label key={g.id}><input type="checkbox" checked={selected.includes(g.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,g.id]:ids.filter(id=>id!==g.id))}/><span>{g.name}</span><small>{g.count}</small></label>)}<p>Le vie che attraversano più zone compaiono in ciascuna lista.</p><a href="/map/zone" className="underline">Modifica i confini delle zone</a></aside>
   <div className={styles.content}><div className={styles.toolbar}><input aria-label="Cerca nelle vie" type="search" value={search} onChange={e=>setSearch(e.target.value)} className={controlClass()} placeholder="Nome della via o codice"/><label><input type="checkbox" checked={acquired} onChange={e=>setAcquired(e.target.checked)}/>Solo vie acquisite</label></div>
    <div className={styles.status}><span role="status">{pending?'Aggiornamento…':`${count} vie uniche`}</span><button type="button" className={buttonClass('quiet')} onClick={()=>setExpanded(v=>!v)}>{expanded?'Richiudi liste':'Apri liste'}</button><button type="button" className={buttonClass('quiet')} disabled={pending} onClick={reload}>Aggiorna</button></div>
    {error?<p role="alert">{error} <button onClick={reload} className="underline">Riprova</button></p>:null}
    {!data&&pending?<p>Caricamento delle vie memorizzate…</p>:null}
    {data&&!data.streets.length?<p>Il Worker non ha ancora pubblicato vie nell’archivio condiviso.</p>:null}
    {groups.filter(g=>!selected.length||selected.includes(g.id)).map(g=>{const streets=rows.filter(s=>belongs(s,g.id));return <details key={`${g.id}:${expanded}:${selected.join(',')}`} open={expanded||selected.length>0} className={styles.group}><summary>{g.name}<span>{streets.length} vie</span></summary>{streets.length?<div className={styles.table}><table><thead><tr><th>Via</th><th>Località / riferimento</th><th>In memoria</th><th>Ultima acquisizione</th></tr></thead><tbody>{streets.map(s=><tr key={s.id}><th scope="row">{s.name}<small>Codice {s.id}{s.areaIds.length>1?' · attraversa più zone':''}</small></th><td>{s.locality}</td><td>{s.count??0} immobili</td><td>{s.lastScanAt?new Date(s.lastScanAt).toLocaleDateString('it-IT'):'Non acquisita'}</td></tr>)}</tbody></table></div>:<p>Nessuna via con questi filtri.</p>}</details>;})}
   </div></div>
 </dialog></>;
}
