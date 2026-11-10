"use client";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import {SlidersHorizontal,X} from "lucide-react";
function subscribe(listener:()=>void){const m=window.matchMedia("(min-width:900px)");m.addEventListener("change",listener);return()=>m.removeEventListener("change",listener)}
function getDesktop(){return window.matchMedia("(min-width:900px)").matches}
export function RadarFilterPanel({count,filters,children}:{count:number;filters:ReactNode;children:ReactNode}){
 const desktop=useSyncExternalStore(subscribe,getDesktop,()=>true);
 const [expanded,setExpanded]=useState<boolean|null>(null);
 const open=expanded??desktop;
 return <div className="lr-radar-body" data-filters={open?"open":"closed"}>
  <section className="lr-radar-results" aria-label="Risultati immobili">
   <div className="lr-radar-tools"><button type="button" className="lr-filter-toggle" onClick={()=>setExpanded(!open)} aria-expanded={open} aria-controls="radar-filter-sidebar"><SlidersHorizontal size={15}/>{open?"Nascondi filtri":"Mostra filtri"}{count?<span>{count}</span>:null}</button></div>
   {children}
  </section>
  {open?<aside id="radar-filter-sidebar" className="lr-radar-filters" aria-label="Filtri immobili"><header><h2>Filtri</h2><button type="button" onClick={()=>setExpanded(false)} aria-label="Chiudi filtri"><X size={18}/></button></header>{filters}</aside>:null}
 </div>;
}
