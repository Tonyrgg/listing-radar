"use client";
import { useEffect,useMemo,useState } from "react";
import { MapContainer,TileLayer,Marker,useMap,useMapEvents,GeoJSON } from "react-leaflet";
import {BoundedTooltip} from './bounded-tooltip';
import L from "leaflet";
import { MAP_DATA_COLORS,MAP_INK } from "@/lib/design/map-palette";
import { listingClusters } from "@/lib/map/listing-clusters";
import { territoryCategory,TERRITORY_LABELS } from "@/lib/property-lifecycle/read-models/territory";
import type { IntelligenceRow } from "@/lib/property-lifecycle/read-models/intelligence";
import { PropertyHover } from "./property-hover";
import { BITONTO_CENTER } from "@/lib/map/constants";
import styles from "./territory-archive.module.css";
import { PublicRecordPoints } from "./public-record-points";
import type { PublicRecordMapPoint } from "@/lib/property-lifecycle/buildings/read-model";
import type {BuildingMapPoint} from '@/lib/property-lifecycle/buildings/graph-read-model';
import {BuildingPoints} from './building-points';
import type {InternalZone} from '@/lib/matching/types';
import type {TerritoryWorkArea} from '@/lib/map/types';

const categoryColors={active:MAP_DATA_COLORS.info,sold:MAP_DATA_COLORS.positive,exit:MAP_DATA_COLORS.attention,unknown:MAP_DATA_COLORS.muted,interesting:MAP_DATA_COLORS.accentuated};
function Points({rows,now,selected,onSelect}:{rows:IntelligenceRow[];now:number;selected?:string|null;onSelect?:(id:string)=>void}) {
  const map=useMap(),[zoom,setZoom]=useState(14);
  useMapEvents({zoomend:()=>setZoom(map.getZoom())});
  const pins=useMemo(()=>rows.map(r=>({id:r.property_id,title:r.address,source:r.agency_name,url:`/casa/${r.property_id}`,price:r.latest_asking_price,sqm:r.surface_sqm??null,addressRaw:r.address,latitude:r.latitude!,longitude:r.longitude!})),[rows]);
  const clusters=useMemo(()=>listingClusters(pins,zoom),[pins,zoom]);
  const index=useMemo(()=>new Map(rows.map(r=>[r.property_id,r])),[rows]);
  const selectedRow=index.get(selected??""),latitude=selectedRow?.latitude,longitude=selectedRow?.longitude;
  useEffect(()=>{if(latitude!=null&&longitude!=null)map.setView([latitude,longitude],Math.max(map.getZoom(),17),{animate:false});},[map,latitude,longitude]);
  return <>{clusters.map(c=>{
    const isGroup=c.listings.length>1,row=index.get(c.listings[0].id)!;
    const category=territoryCategory(row),color=isGroup?MAP_DATA_COLORS.muted:categoryColors[category as keyof typeof categoryColors];
    const label=isGroup?`${c.listings.length} immobili, clicca per ingrandire`:`${row.address} · ${TERRITORY_LABELS[category]}`;
    const icon=L.divIcon({className:styles.marker,iconSize:[32,32],iconAnchor:[16,16],html:`<span style="display:grid;place-items:center;width:32px;height:32px;border-radius:50%;border:2px solid ${MAP_INK.halo};background:${color};color:${MAP_INK.onColor};font-weight:650">${isGroup?c.listings.length:"●"}</span>`});
    return <Marker key={c.id} position={[c.latitude,c.longitude]} icon={icon} title={isGroup?`${c.listings.length} immobili, clicca per ingrandire`:`${row.address} · ${TERRITORY_LABELS[category]}`} alt={row.address} keyboard
      eventHandlers={{add:e=>e.target.getElement()?.setAttribute("aria-label",label),click:()=>isGroup?map.setView([c.latitude,c.longitude],Math.min(19,map.getZoom()+2)):onSelect?.(row.property_id)}}>
      <BoundedTooltip>{isGroup?<div className="max-w-64"><strong>{c.listings.length} immobili conosciuti</strong><p className="mt-1">Clicca per ingrandire e distinguere le unità.</p>{c.listings.slice(0,4).map(p=><p key={p.id}>{p.title}</p>)}</div>:<PropertyHover row={row} now={now}/>}</BoundedTooltip>
    </Marker>;
  })}</>;
}
function ViewControls({coordinates,workAreas}:{coordinates:string;workAreas:TerritoryWorkArea[]}){
 const map=useMap();
 return <div className="lr-map-view-controls"><button type="button" onClick={()=>map.setView([BITONTO_CENTER.latitude,BITONTO_CENTER.longitude],14,{animate:false})}>Centra Bitonto</button><button type="button" disabled={!coordinates} onClick={()=>map.fitBounds(coordinates.split(';').map(p=>p.split(',').map(Number) as [number,number]),{padding:[35,35],maxZoom:17,animate:false})}>Inquadra risultati</button>{workAreas.length?<button type="button" onClick={()=>{const bounds=L.featureGroup(workAreas.map(area=>L.geoJSON(area.geometry as GeoJSON.GeoJsonObject))).getBounds();if(bounds.isValid())map.fitBounds(bounds,{padding:[35,35],maxZoom:16,animate:false});}}>Inquadra zone di lavoro</button>:null}</div>;
}
export function TerritoryArchiveCanvas({rows,now,recordPoints=[],buildingPoints=[],zones=[],workAreas=[],showProperties=true,selected,onSelect}:{selected?:string|null;onSelect?:(id:string)=>void;rows:IntelligenceRow[];now:number;recordPoints?:PublicRecordMapPoint[];buildingPoints?:BuildingMapPoint[];zones?:InternalZone[];workAreas?:TerritoryWorkArea[];showProperties?:boolean}) {
  const visiblePoints=[...(showProperties?rows:[]),...buildingPoints,...recordPoints];
  return <MapContainer center={[BITONTO_CENTER.latitude,BITONTO_CENTER.longitude]} zoom={14} scrollWheelZoom={true} className="h-[min(70vh,48rem)] min-h-[28rem] w-full rounded-[var(--lr-radius-container)] border border-[var(--lr-line)]" style={{zIndex:0}}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
    {workAreas.map(area=><GeoJSON key={area.id} data={area.geometry as GeoJSON.GeoJsonObject} style={{color:area.color,weight:3,fillColor:area.color,fillOpacity:.12}}><BoundedTooltip><strong>{area.name}</strong><p>{area.agentName?`Assegnata a: ${area.agentName}`:area.agentId?'Assegnazione da verificare':'Senza assegnazione'}</p></BoundedTooltip></GeoJSON>)}
    <Points rows={showProperties?rows:[]} now={now} selected={selected} onSelect={onSelect}/>
    <PublicRecordPoints points={recordPoints}/>
    <BuildingPoints points={buildingPoints}/>
    {zones.map(zone=>zone.geometry?<GeoJSON key={zone.id} data={zone.geometry as GeoJSON.GeoJsonObject} style={{color:zone.color??"#276b52",weight:3,fillColor:zone.color??"#4f9b78",fillOpacity:.16}}/>:null)}
    <ViewControls coordinates={visiblePoints.map(p=>`${p.latitude},${p.longitude}`).join(';')} workAreas={workAreas}/>
  </MapContainer>;
}
