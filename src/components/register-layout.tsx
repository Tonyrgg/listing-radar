"use client";
import { useState, type ReactNode } from "react";

export function RegisterLayout({children, initialDetail}: {children:ReactNode; initialDetail:boolean}) {
  const [expanded,setExpanded]=useState(initialDetail);
  return <section className="lr-register-layout" data-expanded={expanded}>
    <div className="lr-register-switch" role="group" aria-label="Colonne del registro">
      {["Sintesi","Tutte le colonne"].map((label,i)=><button key={label} type="button" aria-pressed={expanded===Boolean(i)} onClick={()=>setExpanded(Boolean(i))}>{label}</button>)}
    </div>{children}
  </section>;
}
