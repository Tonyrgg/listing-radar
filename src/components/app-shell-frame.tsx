"use client";
import { LogOut, PanelLeftClose, PanelLeftOpen, Menu, X, ChevronRight, Radar } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { logout } from "@/app/login/actions";
import { PendingSubmitButton } from "@/components/loading-controls";
import { CercaGlobale } from "@/components/global-search";
import { SidebarNav, workspaceArea } from "@/components/sidebar-nav";
import { FlashToast } from "@/components/ui/feedback";
import { GlobalActionLoader } from "@/components/ui/global-action-loader";
import { buttonClass } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { Flash } from "@/lib/flash-shared";
function Brand(){return <Link href="/intelligence" className="lr-brand" aria-label="Listing Radar, apri Intelligence"><span className="lr-brand-symbol"><Radar size={24} aria-hidden="true"/></span><span><strong>Listing Radar</strong><small>COREIMMOBILIARE</small></span></Link>}
export function AppShellFrame({children,showLogout,flash,segnoDiDisegno,barraAperta}:Readonly<{children:React.ReactNode;showLogout:boolean;flash:Flash|null;segnoDiDisegno:number;barraAperta:boolean}>) {
 const [collapsed,setCollapsed]=useState(!barraAperta),[mobileOpen,setMobileOpen]=useState(false);
 const path=usePathname(),current=workspaceArea(path);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setMobileOpen(false)};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[]);
 function toggleCollapsed(){setCollapsed(value=>{document.cookie="listing-radar-sidebar="+(value?"expanded":"collapsed")+"; path=/; max-age=31536000; samesite=lax";return !value})}
 return <div className={"lr-workspace"+(collapsed?" lr-sidebar-collapsed":"")} data-area={current.area}>
 <Suspense fallback={null}><GlobalActionLoader segnoDiDisegno={segnoDiDisegno}/></Suspense><a href="#main-content" className="lr-skip">Vai al contenuto</a>
 <aside className="lr-sidebar"><div className="lr-sidebar-brand"><Brand/><button onClick={toggleCollapsed} className="lr-icon-button" aria-label={collapsed?"Apri la barra laterale":"Chiudi la barra laterale"}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button></div><SidebarNav collapsed={collapsed}/><div className="lr-sidebar-territory"><span className="lr-territory-dot"/><span>Bitonto · Palombaio · Mariotto<small>Archivio privato di intelligence</small></span></div></aside>
 <div className="lr-workspace-body"><header className="lr-topbar"><button className="lr-icon-button lr-mobile-menu" aria-label={mobileOpen?"Chiudi navigazione":"Apri navigazione"} aria-expanded={mobileOpen} aria-controls="mobile-navigation" onClick={()=>setMobileOpen(!mobileOpen)}>{mobileOpen?<X size={22}/>:<Menu size={22}/>}</button><div className="lr-breadcrumb"><Link href="/intelligence">Listing Radar</Link><ChevronRight size={14} aria-hidden="true"/><span>{current.label}</span></div><CercaGlobale className="lr-global-search"/><div className="lr-topbar-actions"><span className="lr-theme-desktop"><ThemeToggle/></span><span className="lr-theme-mobile"><ThemeToggle compact/></span>{showLogout&&<form action={logout}><PendingSubmitButton type="submit" pendingLabel="" icon={<LogOut size={16} aria-hidden="true"/>} aria-label="Esci" title="Esci" className={buttonClass("quiet",{compact:true,icon:true})}><span className="sr-only">Esci</span></PendingSubmitButton></form>}</div></header>
 {mobileOpen&&<div id="mobile-navigation" className="lr-mobile-navigation"><Brand/><SidebarNav onNavigate={()=>setMobileOpen(false)}/></div>}
 <main id="main-content" className="lr-page" tabIndex={-1}>{children}</main></div><FlashToast flash={flash}/></div>;
}
