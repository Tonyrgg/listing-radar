"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Chip, Meta, buttonClass, controlClass } from "@/components/ui/primitives";
import type { IntelligenceRow } from "@/lib/property-lifecycle/read-models/intelligence";
import { territoryCategory, TERRITORY_LABELS } from "@/lib/property-lifecycle/read-models/territory";
import { formatCurrency, formatNumber } from "@/lib/formatting";
import type { PublicRecordMapPoint } from "@/lib/property-lifecycle/buildings/read-model";
import {PUBLIC_RECORD_LABELS} from '@/lib/property-lifecycle/buildings/read-model';
import type {readBuildingMap} from '@/lib/property-lifecycle/buildings/graph-read-model';
import {territorialRecordRecent} from '@/lib/property-lifecycle/buildings/territorial-graph';
const Canvas=dynamic(()=>import("./territory-archive-canvas").then(m=>m.TerritoryArchiveCanvas),{ssr:false,loading:()=> <div className="grid min-h-[32rem] place-content-center bg-[var(--lr-raised)]">Caricamento della mappa…</div>});

export function TerritoryArchive({rows,now,recordMap,buildingMap}:{rows:IntelligenceRow[];now:number;recordMap?:{points:PublicRecordMapPoint[];total:number;locatedRecords:number}|null;buildingMap?:Awaited<ReturnType<typeof readBuildingMap>>|null}) {
  const [query,setQuery]=useState(""),[state,setState]=useState("");
  const [showRecords,setShowRecords]=useState(false);
  const [showProperties,setShowProperties]=useState(true),[showBuildings,setShowBuildings]=useState(false);
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
  return <section className="space-y-3" aria-label="Archivio territoriale">
    <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]"><label className="min-w-0"><span className="mb-1 block text-[length:var(--lr-text-meta)] font-medium">Cerca immobile, via, zona o agenzia</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} className={controlClass()} placeholder="Anche immobili storici e non più rilevati"/></label><label><span className="mb-1 block text-[length:var(--lr-text-meta)] font-medium">Stato sulla mappa</span><select value={state} onChange={e=>setState(e.target.value)} className={controlClass()}><option value="">Tutti gli stati</option>{Object.entries(TERRITORY_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
    <div className="flex flex-wrap items-center justify-between gap-2"><Meta>{filtered.length} immobili nell’archivio · {mapped.length} con coordinate · {unmapped} da localizzare</Meta><Meta>Passa sul punto per la scheda. Clicca per il dossier; sui gruppi, ingrandisci.</Meta></div>
    <div className="flex flex-wrap gap-x-6 gap-y-2"><label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={showProperties} onChange={e=>setShowProperties(e.target.checked)}/>Immobili</label><label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-[var(--lr-accent)]" checked={showRecords} onChange={e=>setShowRecords(e.target.checked)}/>Documenti pubblici {recordMap?`· ${recordMap.locatedRecords} localizzabili su ${recordMap.total}`:"· layer temporaneamente non disponibile"}</label><label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={showBuildings} onChange={e=>setShowBuildings(e.target.checked)}/>Edifici {buildingMap?`· ${buildingMap.located} rappresentabili su ${buildingMap.total}`:'· layer non disponibile'}</label></div>
    <details><summary className="cursor-pointer py-2">Filtra contesti e attività territoriali</summary><div className="grid gap-3 py-3 sm:grid-cols-2 xl:grid-cols-4">
      <label>Periodo documenti<select className={controlClass()} value={period} onChange={e=>setPeriod(e.target.value)}><option value="">Tutte le date</option><option value="30">Ultimi 30 giorni</option><option value="90">Ultimi 90 giorni</option></select></label>
      <label>Categoria territoriale<select className={controlClass()} value={category} onChange={e=>setCategory(e.target.value)}><option value="">Tutte le categorie</option>{Object.entries(PUBLIC_RECORD_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>Immobili nel contesto edificio<select className={controlClass()} value={portfolio} onChange={e=>setPortfolio(e.target.value)}><option value="">Con o senza immobili</option><option value="known">Con immobili conosciuti</option><option value="active">Con immobili attivi</option></select></label>
      <label>Attività territoriale<select className={controlClass()} value={activity} onChange={e=>setActivity(e.target.value)}><option value="">Tutti i contesti</option><option value="building">Edificio con attività moderata o alta</option><option value="street">Strada con attività negli ultimi 90 giorni</option></select></label>
    </div><Meta>I filtri territoriali agiscono sui layer documenti ed edifici; il filtro di presenza richiede contesto edificio, non vicinanza sulla via.</Meta></details>
    {showRecords?<Meta>Punti quadrati e gruppi: pratiche, ordinanze, lavori e urbanistica. La posizione sulla via è indicativa; i record senza coordinate restano ricercabili sotto la mappa.</Meta>:null}
    {showBuildings?<Meta>Edifici sulla mappa: {buildingPoints.length}. I punti con precisione STREET rappresentano la strada, non il civico.</Meta>:null}
    <Canvas rows={mapped} now={now} showProperties={showProperties} recordPoints={showRecords?recordPoints:[]} buildingPoints={showBuildings?buildingPoints:[]}/>
    <div className="flex flex-wrap gap-2" aria-label="Legenda stati">{Object.entries(TERRITORY_LABELS).map(([key,label])=><Chip key={key} tone={key==="sold"?"ok":key==="exit"?"warn":key==="interesting"?"info":"neutral"}>{label}</Chip>)}</div>
    <Meta>Le coordinate dichiarate dai siti possono essere approssimative. Un punto non dimostra il civico: la scheda mostra la precisione disponibile.</Meta>
    <details open={query.trim()?true:undefined} className="border-t border-[var(--lr-line-quiet)] pt-3"><summary className="cursor-pointer py-2 font-medium">Elenco immobili · include {unmapped} senza coordinate</summary><div className="mt-2 max-h-96 overflow-y-auto divide-y divide-[var(--lr-line-quiet)]">{filtered.map(r=><div key={r.property_id} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div><Link href={`/casa/${r.property_id}`} className="font-[650] hover:underline">{r.address}</Link><Meta>{r.agency_name} · {TERRITORY_LABELS[territoryCategory(r)]}{r.surface_sqm!=null?` · ${formatNumber(r.surface_sqm)} m²`:""}{r.latitude==null||r.longitude==null?" · coordinate non disponibili":""}</Meta></div><p>{formatCurrency(r.latest_asking_price)}</p></div>)}</div>{!filtered.length?<p className="py-3">Nessun immobile corrispondente. Prova una via o un’agenzia diversa.</p>:null}</details>
    <Link href="/intelligence" className={buttonClass("quiet")}>Apri archivio completo con filtri</Link>
  </section>;
}
