"use client";
import dynamic from "next/dynamic";
import {loadTerritoryLayers} from "@/app/(private)/map/actions";
import {PropertyHover} from "./property-hover";
import Link from "next/link";
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { Chip, Meta, buttonClass, controlClass } from "@/components/ui/primitives";
import type { IntelligenceRow } from "@/lib/property-lifecycle/read-models/intelligence";
import { territoryCategory, TERRITORY_LABELS } from "@/lib/property-lifecycle/read-models/territory";
import { formatCurrency, formatNumber } from "@/lib/formatting";
import type { PublicRecordMapPoint } from "@/lib/property-lifecycle/buildings/read-model";
import {PUBLIC_RECORD_LABELS} from '@/lib/property-lifecycle/buildings/read-model';
import type {readBuildingMap} from '@/lib/property-lifecycle/buildings/graph-read-model';
import {territorialRecordRecent} from '@/lib/property-lifecycle/buildings/territorial-graph';
import type {InternalZone} from '@/lib/matching/types';
import type {TerritoryWorkArea} from '@/lib/map/types';
import {WorkAreaControls,useWorkAreaSelection} from './work-area-controls';
import styles from './territory-archive.module.css';
const Canvas=dynamic(()=>import("./territory-archive-canvas").then(m=>m.TerritoryArchiveCanvas),{ssr:false,loading:()=> <div className="grid min-h-[32rem] place-content-center bg-[var(--lr-raised)]">Caricamento della mappa…</div>});

export function TerritoryArchive({rows,now,zones=[],workAreas=null,recordMap:initialRecordMap,buildingMap:initialBuildingMap}:{rows:IntelligenceRow[];now:number;zones?:InternalZone[];workAreas?:TerritoryWorkArea[]|null;recordMap?:{points:PublicRecordMapPoint[];total:number;locatedRecords:number}|null;buildingMap?:Awaited<ReturnType<typeof readBuildingMap>>|null}) {
  const [search,setSearch]=useState("");
  const query=useDeferredValue(search);
  const [state,setState]=useState("");
  const [recordMap,setRecordMap]=useState(initialRecordMap),[buildingMap,setBuildingMap]=useState(initialBuildingMap);
  const [layerState,setLayerState]=useState<"idle"|"loading"|"ready"|"error">(initialRecordMap&&initialBuildingMap?"ready":"idle");
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const selected=rows.find(r=>r.property_id===selectedId);

  const [showRecords,setShowRecords]=useState(false);
  const [showProperties,setShowProperties]=useState(true),[showBuildings,setShowBuildings]=useState(false);
  const [visibleZones,setVisibleZones]=useState<string[]>([]);
  const workAreaSelection=useWorkAreaSelection(workAreas);
  useEffect(()=>{
    if((!showRecords&&!showBuildings)||layerState!=="idle")return;
    // Loading does not block the property map; results are kept when a layer is hidden.
    Promise.resolve().then(()=>setLayerState("loading"));
    loadTerritoryLayers().then(data=>{setRecordMap(data.recordMap);setBuildingMap(data.buildingMap);setLayerState(data.recordMap&&data.buildingMap?"ready":"error");}).catch(()=>{setLayerState("error");});
  },[showRecords,showBuildings,layerState]);
  const [period,setPeriod]=useState(''),[category,setCategory]=useState(''),[portfolio,setPortfolio]=useState(''),[activity,setActivity]=useState('');
  const recentStreets=new Set(buildingMap?.recentStreets??[]);
  const recordPoints=(recordMap?.points??[]).filter(p=>{
    const bs=(p.buildingIds??[]).map(id=>buildingMap?.summaries[id]).filter(Boolean);
    return (!query.trim()||`${p.title} ${p.streetName}`.toLocaleLowerCase('it').includes(query.trim().toLocaleLowerCase('it')))&&(!category||p.category===category)&&(!period||territorialRecordRecent(p.recordDate,p.sourceStatus,now,Number(period)))&&(!portfolio||bs.some(b=>portfolio==='active'?b!.active>0:b!.known>0))&&(!activity||(activity==='street'?recentStreets.has(p.streetId??''):bs.some(b=>b!.score>=25)));
  });
  const buildingPoints=(buildingMap?.points??[]).filter(b=>(!query.trim()||b.title.toLocaleLowerCase('it').includes(query.trim().toLocaleLowerCase('it')))&&(!period||(period==='30'?b.recent30:b.recent90)>0)&&(!category||b.categories.includes(category))&&(!portfolio||(portfolio==='active'?b.active_properties:b.known_properties)>0)&&(!activity||(activity==='street'?recentStreets.has(b.street_id??''):b.activity.score>=25)));
  const filtered=useMemo(()=>rows.filter(r=>(!state||territoryCategory(r)===state)&&(!query.trim()||[r.address,r.locality,r.zone_name,r.agency_name,r.property_type].some(v=>v?.toLocaleLowerCase("it").includes(query.toLocaleLowerCase("it").trim())))),[rows,query,state]);
  const mapped=useMemo(()=>filtered.filter(r=>r.latitude!=null&&r.longitude!=null),[filtered]);
  const unmapped=filtered.length-mapped.length;
  const [visibleCount,setVisibleCount]=useState(50);
  return <section className={styles.archive} aria-label="Archivio territoriale">
  <div className="lr-territory-desk"><aside className="lr-territory-tools"><h2>Esplora il territorio</h2>
  <label><span className="mb-1 block">Immobile, via, zona o agenzia</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} className={controlClass()} placeholder="Cerca nell’archivio"/></label>
  <label><span className="mb-1 block">Stato degli immobili</span><select value={state} onChange={e=>setState(e.target.value)} className={controlClass()}><option value="">Tutti gli stati</option>{Object.entries(TERRITORY_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  <WorkAreaControls areas={workAreas} selection={workAreaSelection}/>
  <div><h3>Cosa mostrare</h3><label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={showProperties} onChange={e=>setShowProperties(e.target.checked)}/>Immobili</label><label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={showRecords} onChange={e=>setShowRecords(e.target.checked)}/>Documenti pubblici</label><Meta>{recordMap?`${recordMap.locatedRecords} localizzabili su ${recordMap.total}`:layerState==="loading"?"Caricamento del livello…":layerState==="error"?"Caricamento non riuscito":"Caricato quando attivi il livello"}</Meta><label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={showBuildings} onChange={e=>setShowBuildings(e.target.checked)}/>Edifici</label><Meta>{buildingMap?`${buildingMap.located} rappresentabili su ${buildingMap.total}`:layerState==="loading"?"Caricamento del livello…":layerState==="error"?"Caricamento non riuscito":"Caricato quando attivi il livello"}</Meta>{zones.length?<fieldset className="mt-3 border-t border-[var(--lr-line)] pt-2"><legend className="text-xs font-semibold uppercase tracking-wide">Zone interne</legend>{zones.map(z=><label key={z.id} className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={visibleZones.includes(z.id)} onChange={e=>setVisibleZones(ids=>e.target.checked?[...ids,z.id]:ids.filter(id=>id!==z.id))}/><span className="size-3 rounded-sm" style={{background:z.color??"#4f9b78"}}/>{z.name}</label>)}</fieldset>:null}</div>
  <details><summary>Filtra contesti e attività territoriali</summary><div className="grid gap-3 py-3">
   <label>Periodo documenti<select className={controlClass()} value={period} onChange={e=>setPeriod(e.target.value)}><option value="">Tutte le date</option><option value="30">Ultimi 30 giorni</option><option value="90">Ultimi 90 giorni</option></select></label>
   <label>Categoria territoriale<select className={controlClass()} value={category} onChange={e=>setCategory(e.target.value)}><option value="">Tutte le categorie</option>{Object.entries(PUBLIC_RECORD_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
   <label>Immobili nel contesto edificio<select className={controlClass()} value={portfolio} onChange={e=>setPortfolio(e.target.value)}><option value="">Con o senza immobili</option><option value="known">Con immobili conosciuti</option><option value="active">Con immobili attivi</option></select></label>
   <label>Attività territoriale<select className={controlClass()} value={activity} onChange={e=>setActivity(e.target.value)}><option value="">Tutti i contesti</option><option value="building">Edificio con attività moderata o alta</option><option value="street">Strada con attività negli ultimi 90 giorni</option></select></label>
  </div><Meta>I filtri territoriali agiscono sui layer documenti ed edifici; il filtro di presenza richiede contesto edificio, non vicinanza sulla via.</Meta></details>
  <div><h3>Copertura del campione</h3><p className="text-sm">{filtered.length} immobili</p><Meta>{mapped.length} con coordinate · {unmapped} da localizzare</Meta></div>
  <Link href="/intelligence" className={buttonClass("secondary")}>Consulta il registro</Link>
  </aside><div className="lr-territory-map"><Canvas rows={mapped} now={now} selected={selectedId} onSelect={setSelectedId} showProperties={showProperties} recordPoints={showRecords?recordPoints:[]} buildingPoints={showBuildings?buildingPoints:[]} zones={zones.filter(z=>visibleZones.includes(z.id))} workAreas={workAreaSelection.visible}/>
  {selected?<section className="lr-map-selection" aria-label="Immobile selezionato"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold">Immobile selezionato</h3><button type="button" className={buttonClass("quiet")} onClick={()=>setSelectedId(null)}>Chiudi</button></div><PropertyHover row={selected} now={now}/><Link href={`/casa/${selected.property_id}`} className={buttonClass("primary")}>Apri il dossier completo</Link></section>:null}
  {layerState==="error"?<p role="status">Un livello territoriale non è disponibile. <button type="button" className="underline" onClick={()=>setLayerState("idle")}>Riprova</button></p>:null}
  <div className="lr-territory-legend" aria-label="Legenda stati">{Object.entries(TERRITORY_LABELS).map(([key,label])=><Chip key={key} dot tone={key==="sold"?"ok":key==="exit"?"warn":key==="interesting"?"info":"neutral"}>{label}</Chip>)}</div>
  <p className="lr-record-meta">Seleziona un punto per leggere la sintesi senza lasciare la mappa. Ingrandisci i gruppi per distinguere gli immobili.</p><p className="lr-record-meta">Le coordinate dei siti possono essere approssimative. La scheda indica la precisione disponibile.</p>
  {showRecords?<Meta>Punti quadrati: documenti e pratiche. La posizione sulla via è indicativa; i record senza coordinate sono ricercabili sotto la mappa.</Meta>:null}
  {showBuildings?<Meta>Edifici sulla mappa: {buildingPoints.length}. I punti con precisione STREET rappresentano la strada, non il civico.</Meta>:null}
  </div></div>
  <details open={query.trim()?true:undefined} className="mt-5"><summary className="font-medium">Elenco immobili · include {unmapped} senza coordinate</summary><div className="lr-public-register mt-3 max-h-96 overflow-y-auto">{filtered.slice(0,visibleCount).map(r=><div key={r.property_id} className="lr-public-record grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto]"><div><button type="button" onClick={()=>setSelectedId(r.property_id)} className="lr-record-title text-left">{r.address}</button><Link href={`/casa/${r.property_id}`} className="ml-3 underline text-sm">Dossier</Link><Meta>{r.agency_name} · {TERRITORY_LABELS[territoryCategory(r)]}{r.surface_sqm!=null?` · ${formatNumber(r.surface_sqm)} m²`:""}{r.latitude==null||r.longitude==null?" · coordinate non disponibili":""}</Meta></div><p className="lr-price">{formatCurrency(r.latest_asking_price)}</p></div>)}</div>{filtered.length>visibleCount?<button type="button" className={buttonClass("secondary")} onClick={()=>setVisibleCount(n=>n+50)}>Mostra altri 50 immobili</button>:null}{!filtered.length?<p className="py-3">Nessun immobile corrispondente. Prova una via o un’agenzia diversa.</p>:null}</details>
  </section>;
}
