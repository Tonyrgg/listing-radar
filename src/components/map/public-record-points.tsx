"use client";
import { useMemo,useState } from "react";
import { Marker,Popup,useMapEvents,useMap } from "react-leaflet";
import L from "leaflet";
import Link from "next/link";
import { listingClusters } from "@/lib/map/listing-clusters";
import { MAP_DATA_COLORS,MAP_INK } from "@/lib/design/map-palette";
import { PUBLIC_RECORD_LABELS,type PublicRecordMapPoint } from "@/lib/property-lifecycle/buildings/read-model";
import styles from "./territory-archive.module.css";
export function PublicRecordPoints({points}:{points:PublicRecordMapPoint[]}){
 const map=useMap(),[zoom,setZoom]=useState(map.getZoom());useMapEvents({zoomend:()=>setZoom(map.getZoom())});
 const index=useMemo(()=>new Map(points.map(p=>[p.id,p])),[points]);
 const clusters=useMemo(()=>listingClusters(points.map(p=>({id:p.id,title:p.title,addressRaw:p.streetName,source:"Comune",url:`/map?atto=${p.recordId}#atto`,price:null,sqm:null,latitude:p.latitude,longitude:p.longitude})),zoom),[points,zoom]);
 return <>{clusters.map(c=>{
  const rows=c.listings.map(l=>index.get(l.id)!),unique=[...new Map(rows.map(r=>[r.recordId,r])).values()],first=rows[0];
  const color=/PLAN|VARIANT|HERITAGE/.test(first.category)?MAP_DATA_COLORS.positive:/WORK|VIABILITY/.test(first.category)?MAP_DATA_COLORS.attention:/ORDER|ORDINANZA/.test(first.category)?MAP_DATA_COLORS.accentuated:MAP_DATA_COLORS.info;
  const label=`${unique.length} documenti pubblici · ${first.streetName}`;
  const icon=L.divIcon({className:styles.marker,iconSize:[30,30],iconAnchor:[15,15],html:`<span style="display:grid;place-items:center;width:30px;height:30px;border-radius:6px;border:2px solid ${MAP_INK.halo};background:${color};color:${MAP_INK.onColor};font-weight:650">${unique.length>1?unique.length:"▤"}</span>`});
  return <Marker key={c.id} position={[c.latitude,c.longitude]} icon={icon} title={label} keyboard eventHandlers={{add:e=>e.target.getElement()?.setAttribute("aria-label",label)}}>
    <Popup className={styles.recordPopup} maxWidth={340} maxHeight={360}>
      <strong>Documenti pubblici · {unique.length}</strong><p>Posizione indicativa sulla strada, non del civico o dell’appartamento.</p>
      <ul className="space-y-3">{unique.slice(0,8).map(r=><li key={r.recordId}><span>{PUBLIC_RECORD_LABELS[r.category]??"Atto pubblico"}</span><br/><Link className="underline" href={`/map?atto=${r.recordId}#atto`}>{r.title}</Link></li>)}</ul>
      <div className="mt-3 space-y-2">{[...new Map(rows.map(r=>[r.streetId,r])).values()].filter(r=>r.streetId).slice(0,6).map(r=><p key={r.streetId}><Link className="underline" href={`/map?via_id=${r.streetId}#contesto`}>Tutti gli atti: {r.streetName}</Link></p>)}</div>
    </Popup>
  </Marker>;
 })}</>;
}
