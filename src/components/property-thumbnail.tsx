"use client";
import { useState } from "react";
import { ImageOff } from "lucide-react";

export function PropertyThumbnail({src,address}:{src?:string;address:string}) {
 const [failed,setFailed]=useState(false);
 return <span className="lr-property-thumbnail">{src&&!failed?
 // Private signed storage URLs, already generated as 640px thumbnails.
 // eslint-disable-next-line @next/next/no-img-element
 <img src={src} alt={`Foto: ${address}`} width={76} height={64} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>:<span title="Foto non disponibile"><ImageOff size={20} aria-hidden="true"/><span className="sr-only">Foto non disponibile</span></span>}</span>;
}
