"use client";
import {useCallback,useMemo,useSyncExternalStore} from 'react';
import {Marker,Tooltip,useMap} from 'react-leaflet';
import {useRouter} from 'next/navigation';
import L from 'leaflet';
import {listingClusters} from '@/lib/map/listing-clusters';
import {MAP_DATA_COLORS,MAP_INK} from '@/lib/design/map-palette';
import {activityLabel,type BuildingMapPoint} from '@/lib/property-lifecycle/buildings/graph-read-model';
import {formatDate} from '@/lib/formatting';
import styles from './territory-archive.module.css';
export function BuildingPoints({points}:{points:BuildingMapPoint[]}){
 const map=useMap(),router=useRouter();
 const subscribe=useCallback((fn:()=>void)=>{map.on('zoomend',fn);return()=>{map.off('zoomend',fn);};},[map]);
 const getZoom=useCallback(()=>map.getZoom(),[map]),zoom=useSyncExternalStore(subscribe,getZoom,getZoom);
 const index=useMemo(()=>new Map(points.map(p=>[p.id,p])),[points]);
 const groups=useMemo(()=>listingClusters(points.map(p=>({id:p.id,title:p.title,addressRaw:p.title,source:'Edificio',url:`/map?edificio=${p.id}#edificio`,price:null,sqm:null,latitude:p.latitude,longitude:p.longitude})),zoom),[points,zoom]);
 return <>{groups.map(g=>{const b=index.get(g.listings[0].id)!,group=g.listings.length>1,label=group?`${g.listings.length} edifici, ingrandisci`:`Edificio ${b.title}`;
  const icon=L.divIcon({className:styles.marker,iconSize:[32,32],iconAnchor:[16,16],html:`<span style="display:grid;place-items:center;width:32px;height:32px;border:2px solid ${MAP_INK.halo};border-radius:4px;background:${MAP_DATA_COLORS.positive};color:${MAP_INK.onColor};font-weight:650">${group?g.listings.length:'⌂'}</span>`});
  return <Marker key={g.id} position={[g.latitude,g.longitude]} icon={icon} title={label} zIndexOffset={2000} eventHandlers={{add:e=>e.target.getElement()?.setAttribute('aria-label',label),click:()=>group?map.setView([g.latitude,g.longitude],Math.min(19,map.getZoom()+2)):router.push(`/map?edificio=${b.id}#edificio`)}}>
   <Tooltip interactive className={styles.hover} opacity={1}>{group?<div><strong>{g.listings.length} edifici conosciuti</strong><p>Ingrandisci per distinguere i contesti. I punti di strada restano indicativi.</p></div>:<div><strong>{b.title}</strong><p>{b.public_record_count} documenti pubblici · ultimo {formatDate(b.last_activity)}</p>{b.factCount?<p>{b.factCount} segnali immobiliari · {b.factLabels?.join(' · ')}</p>:null}<p>Immobili conosciuti: {b.known_properties} · attivi: {b.active_properties}</p><p>Attività territoriale: {activityLabel(b.activity.score)}</p><p>Precisione punto: {b.precision_type}. Singole unità da verificare.</p><p>Clicca per aprire l’edificio</p></div>}</Tooltip>
  </Marker>;
 })}</>;
}
