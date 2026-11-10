"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
export function CopySourceLink({url}:{url:string}){
 const [status,setStatus]=useState<"idle"|"copied"|"error">("idle");
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
 async function copy(){
  try{await navigator.clipboard.writeText(url);setStatus("copied")}catch{setStatus("error")}
  if(timer.current)clearTimeout(timer.current);
  timer.current=setTimeout(()=>setStatus("idle"),3000);
 }
 return <><button type="button" className="lr-case-copy" onClick={copy}>{status==="copied"?<Check size={14}/>:<Copy size={14}/>} {status==="copied"?"Link copiato":"Copia il link dell’annuncio"}</button><span role="status" className={status==="error"?"lr-table-warning":"sr-only"}>{status==="error"?"Copia non disponibile. Apri l’annuncio e copia l’indirizzo dal browser.":status==="copied"?"Link copiato":""}</span></>;
}
