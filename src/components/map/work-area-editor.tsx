'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ConfirmDialog} from '@/components/ui/feedback';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ZoneMap} from '@/components/matching/zone-map';
import {buttonClass,controlClass,Meta} from '@/components/ui/primitives';
import {saveWorkAreaAction} from '@/app/(private)/map/zone/actions';
import {MAP_DATA_COLORS} from '@/lib/design/map-palette';
import type {Agent,GeoJsonGeometry,MapArea} from '@/lib/map/types';

export function WorkAreaEditor({initialAreas,agents,initialId,startNew=false}:{initialAreas:MapArea[];agents:Agent[];initialId:string|null;startNew?:boolean}){
  const initial=startNew?null:initialAreas.find(a=>a.id===initialId)??(initialId?null:initialAreas[0]??null);
  const [areas,setAreas]=useState(initialAreas),[selected,setSelected]=useState<MapArea|null>(initial);
  const [creationId,setCreationId]=useState(()=>crypto.randomUUID());
  const [name,setName]=useState(initial?.name??''),[color,setColor]=useState(initial?.color??MAP_DATA_COLORS.accentuated),[agentId,setAgentId]=useState(initial?.agentId??'');
  const [geometry,setGeometry]=useState<GeoJsonGeometry|null>(initial?.geometry??null);
  const [drawing,setDrawing]=useState(false),[editing,setEditing]=useState(false),[pending,setPending]=useState(false);
  const mapPanel=useRef<HTMLDivElement>(null);
  const router=useRouter();
  const [leaveChoice,setLeaveChoice]=useState<{kind:'area';area:MapArea|null}|{kind:'territory'}|null>(null);
  const [message,setMessage]=useState(''),[error,setError]=useState(initialId&&!initial?'La zona richiesta non è disponibile. Seleziona una zona dall’elenco.':'');
  const dirty=name!==(selected?.name??'')||color!==(selected?.color??MAP_DATA_COLORS.accentuated)||agentId!==(selected?.agentId??'')||JSON.stringify(geometry)!==JSON.stringify(selected?.geometry??null);
  const shapes=useMemo(()=>areas.map(a=>({shapeId:a.id,zoneId:a.id,name:a.name,color:a.color,geometry:a.geometry})),[areas]);
  const geometryChanged=useCallback((value:GeoJsonGeometry)=>{setGeometry(value);setMessage('');},[]);
  const drawingConsumed=useCallback(()=>setDrawing(false),[]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>event.preventDefault();
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  function showMap(){mapPanel.current?.scrollIntoView({behavior:'smooth',block:'center'});}
  function choose(area:MapArea|null){
    if(pending)return;
    if(dirty){setLeaveChoice({kind:'area',area});return;}
    applyChoice(area);
  }
  function applyChoice(area:MapArea|null){
    setSelected(area);setCreationId(crypto.randomUUID());setName(area?.name??'');setColor(area?.color??MAP_DATA_COLORS.accentuated);setAgentId(area?.agentId??'');setGeometry(area?.geometry??null);
    setEditing(false);setDrawing(false);setError('');setMessage('');
  }
  async function save(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(pending||!geometry)return;
    setPending(true);setError('');setMessage('');setDrawing(false);setEditing(false);
    try{
      const saved=await saveWorkAreaAction({...(selected?{id:selected.id,expectedUpdatedAt:selected.updatedAt}:{creationId}),name,color,agentId:agentId||null,geometry});
      setAreas(current=>[...current.filter(a=>a.id!==saved.id),saved].sort((a,b)=>a.name.localeCompare(b.name,'it')));
      setSelected(saved);setName(saved.name);setColor(saved.color??MAP_DATA_COLORS.accentuated);setAgentId(saved.agentId??'');setGeometry(saved.geometry);
      setMessage(`Zona «${saved.name}» salvata. I confini sono aggiornati in Territorio.`);
    }catch(reason){setError(reason instanceof Error?reason.message:'Salvataggio non riuscito.');}
    finally{setPending(false);}
  }
  return <>
    <ConfirmDialog open={leaveChoice!==null} title="Abbandonare le modifiche?" description="Le modifiche non salvate ai confini o ai dati della zona andranno perse." confirmLabel="Abbandona modifiche" cancelLabel="Continua a modificare" onCancel={()=>setLeaveChoice(null)} onConfirm={()=>{const choice=leaveChoice;setLeaveChoice(null);if(choice?.kind==='territory')router.push('/map');else if(choice?.kind==='area')applyChoice(choice.area);}}/>
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/map" className={buttonClass('quiet')} onClick={event=>{if(pending){event.preventDefault();return;}if(dirty){event.preventDefault();setLeaveChoice({kind:'territory'});}}}>← Torna a Territorio</Link><button type="button" className={buttonClass('secondary')} disabled={pending} onClick={()=>choose(null)}>Nuova zona</button></div>
    <div className="grid items-start gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <div className="space-y-5">
        <label className="block"><span className="mb-1 block">Zona da modificare</span><select className={controlClass()} value={selected?.id??''} disabled={pending} onChange={event=>choose(areas.find(a=>a.id===event.target.value)??null)}><option value="">Nuova zona</option>{areas.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <form onSubmit={save} className="space-y-4"><h2 className="text-xl font-semibold">{selected?'Modifica zona':'Crea una zona'}</h2><fieldset disabled={pending} className="space-y-4">
          <label className="block"><span className="mb-1 block">Nome della zona</span><input required maxLength={160} value={name} onChange={event=>setName(event.target.value)} className={controlClass()} placeholder="Es. Zona San Leone"/></label>
          <label className="block"><span className="mb-1 block">Assegnazione</span><select className={controlClass()} value={agentId} onChange={event=>setAgentId(event.target.value)}><option value="">Senza assegnazione</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-3"><span>Colore sulla mappa</span><input type="color" aria-label="Colore della zona" value={color} onChange={event=>setColor(event.target.value)} className="h-11 w-16 cursor-pointer"/></label>
          <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass('secondary')} disabled={drawing} onClick={()=>{setEditing(false);setDrawing(true);setMessage('');showMap();}}>{geometry?'Ridisegna confini':'Disegna confini'}</button>{geometry?<button type="button" className={buttonClass('secondary')} disabled={drawing} aria-pressed={editing} onClick={()=>{setEditing(value=>!value);if(!editing)showMap();}}>{editing?'Termina modifica punti':'Modifica punti'}</button>:null}</div>
          {drawing?<p role="status">Clicca sulla mappa per aggiungere i punti. Clicca sul primo punto per chiudere il perimetro. Esc annulla il disegno.</p>:editing?<p role="status">Trascina i vertici o i punti intermedi del perimetro. Premi Salva zona per confermare.</p>:<Meta>{geometry?'Il perimetro è pronto. Puoi modificarlo o disegnarlo nuovamente.':'Disegna il perimetro sulla mappa prima di salvare.'}</Meta>}
          <div className="flex flex-wrap gap-2"><button className={buttonClass('primary')} disabled={!geometry||!name.trim()||!dirty||drawing}>{pending?'Salvataggio…':'Salva zona'}</button><button type="button" className={buttonClass('quiet')} disabled={!dirty&&!editing&&!drawing} onClick={()=>choose(selected)}>Annulla modifiche</button></div>
        </fieldset></form>
        {error?<p role="alert" className="text-[var(--lr-danger)]">{error}</p>:null}{message?<p role="status">{message}</p>:dirty?<Meta>Modifiche non salvate.</Meta>:null}
      </div>
      <div ref={mapPanel} className="min-w-0 space-y-2"><ZoneMap shapes={shapes} highlightedZoneId={selected?.id} editingZoneId={selected?.id??'new-area'} editingGeometry={geometry} draftGeometry={editing?null:geometry} draftColor={color} vertexEditing={editing} drawing={drawing} onGeometryCreated={geometryChanged} onGeometryEdited={geometryChanged} onDrawingConsumed={drawingConsumed} onZoneToggle={id=>{if(!drawing&&!editing&&!pending)choose(areas.find(a=>a.id===id)??null);}} showFullscreenControl/><Meta>Seleziona una zona dalla mappa o dall’elenco. Il salvataggio conserva il disegno tra le postazioni.</Meta></div>
    </div>
  </>;
}
