"use client";
import { useEffect,useId,useRef,useState } from "react";
import {createPortal} from "react-dom";
import {ImageOff} from "lucide-react";
export function PropertyThumbnail({src,address,preview=false}:{src?:string;address:string;preview?:boolean}){
 const [failed,setFailed]=useState(false),[position,setPosition]=useState<{left:number;top:number;width:number;height:number}|null>(null);
 const host=useRef<HTMLSpanElement>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const id=useId();
 useEffect(()=>{
  if(!preview||!src||failed)return;
  const node=host.current,link=node?.closest("a");
  function hide(){if(timer.current)clearTimeout(timer.current);setPosition(null)}
  function show(){
   if(!window.matchMedia("(hover:hover)").matches)return;
   if(timer.current)clearTimeout(timer.current);
   timer.current=setTimeout(()=>{
    const r=node?.getBoundingClientRect();if(!r)return;
    const width=Math.min(380,innerWidth-32),height=Math.min(300,innerHeight-32);
    const left=r.right+width+16<innerWidth?r.right+12:Math.max(16,r.left-width-12);
    setPosition({left,top:Math.max(16,Math.min(r.top-30,innerHeight-height-16)),width,height});
   },140);
  }
  node?.addEventListener("mouseenter",show);node?.addEventListener("mouseleave",hide);
  link?.addEventListener("focus",show);link?.addEventListener("blur",hide);
  document.addEventListener("scroll",hide,true);
  const escape=(e:KeyboardEvent)=>{if(e.key==="Escape")hide()};document.addEventListener("keydown",escape);
  return()=>{hide();node?.removeEventListener("mouseenter",show);node?.removeEventListener("mouseleave",hide);link?.removeEventListener("focus",show);link?.removeEventListener("blur",hide);document.removeEventListener("scroll",hide,true);document.removeEventListener("keydown",escape)};
 },[preview,src,failed]);
 return <span ref={host} className="lr-property-thumbnail">{src&&!failed?<>
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img src={src} alt={"Foto: "+address} width={76} height={64} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>
  {position?createPortal(<span id={id} role="tooltip" className="lr-photo-preview" style={position}>
   {/* eslint-disable-next-line @next/next/no-img-element */}
   <img src={src} alt={"Foto ingrandita: "+address}/><span>{address}</span>
  </span>,document.body):null}
 </>:<span title="Foto non disponibile"><ImageOff size={20} aria-hidden="true"/><span className="sr-only">Foto non disponibile</span></span>}</span>;
}
