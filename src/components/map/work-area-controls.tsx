"use client";
import {useState} from 'react';
import {controlClass,Meta} from '@/components/ui/primitives';
import type {TerritoryWorkArea} from '@/lib/map/types';

export function useWorkAreaSelection(areas:TerritoryWorkArea[]|null) {
  const [show,setShow]=useState(true),[agentId,setAgentId]=useState('all');
  const [hidden,setHidden]=useState<string[]>([]);
  const matching=(areas??[]).filter(area=>agentId==='all'||(agentId==='unassigned'?!area.agentId:area.agentId===agentId));
  const visible=show?matching.filter(area=>!hidden.includes(area.id)):[];
  return {show,setShow,agentId,setAgentId,hidden,setHidden,matching,visible};
}

export function WorkAreaControls({areas,selection}:{areas:TerritoryWorkArea[]|null;selection:ReturnType<typeof useWorkAreaSelection>}) {
  const {show,setShow,agentId,setAgentId,hidden,setHidden,matching}=selection;
  const agents=[...new Map((areas??[]).filter(a=>a.agentId).map(a=>[a.agentId!,a.agentName??'Assegnazione da verificare'])).entries()];
  return <div>
    <h3>Zone di lavoro</h3>
    {areas===null?<p role="status">Zone di lavoro temporaneamente non disponibili. Ricarica la pagina per riprovare.</p>:!areas.length?<Meta>Nessuna zona di lavoro salvata.</Meta>:<>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/>Mostra le zone disegnate</label>
      <label><span className="mb-1 block">Assegnazione</span><select className={controlClass()} value={agentId} onChange={e=>setAgentId(e.target.value)}><option value="all">Tutte le assegnazioni</option>{agents.map(([id,name])=><option key={id} value={id}>{name}</option>)}{areas.some(a=>!a.agentId)?<option value="unassigned">Senza assegnazione</option>:null}</select></label>
      <fieldset className="mt-2" disabled={!show}><legend className="sr-only">Perimetri di lavoro visibili</legend>{matching.map(area=><label key={area.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={!hidden.includes(area.id)} onChange={e=>setHidden(ids=>e.target.checked?ids.filter(id=>id!==area.id):[...ids,area.id])}/><span aria-hidden="true" className="size-3 shrink-0 rounded-sm" style={{background:area.color}}/><span>{area.name}<span className="block text-xs text-[var(--lr-ink-3)]">{area.agentName??(area.agentId?'Assegnazione da verificare':'Senza assegnazione')}</span></span></label>)}</fieldset>
      {!matching.length?<Meta>Nessuna zona per questa assegnazione.</Meta>:null}
    </>}
  </div>;
}
