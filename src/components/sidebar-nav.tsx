"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Cog, MapPinned, Radar, ClipboardList, ScanSearch, ArrowUpRight } from "lucide-react";
export const workspaceDestinations = [
 { href: "/intelligence", label: "Intelligence", hint: "Mercato, opportunità e notizie", icon: Radar, owns: ["/intelligence","/lifecycle","/casa","/listings","/dashboard"] },
 { href: "/map", label: "Territorio", hint: "Luoghi, edifici e documenti", icon: MapPinned, owns: ["/map"] },
 { href: "/fonti", label: "Fonti e documenti", hint: "Copertura e prove disponibili", icon: Building2, owns: ["/fonti"] },
 { href: "/richieste", label: "Richieste e verifiche", hint: "Contatti ricevuti e segnali", icon: ClipboardList, owns: ["/richieste","/acquisition","/contacts","/logbook"] },
 { href: "/matching/overview", label: "Abbinamenti", hint: "Clienti e immobili disponibili", icon: ScanSearch, owns: ["/matching","/requests","/portfolio","/zones","/matching-settings","/incoming","/reports","/cerca"] },
] as const;
export function workspaceArea(path: string) {
 if(path.startsWith("/lifecycle/review")||path.startsWith("/lifecycle/agencies"))return {label:"Fonti e documenti",area:"fonti"};
 if(path.startsWith("/settings")) return {label:"Impostazioni",area:"settings"};
 const item=workspaceDestinations.find(d=>d.owns.some(base=>path===base||path.startsWith(base+"/")));
 return {label:item?.label??"Listing Radar",area:item?.href.split("/")[1]??"intelligence"};
}
export function SidebarNav({collapsed=false,onNavigate}:Readonly<{collapsed?:boolean;onNavigate?:()=>void}>) {
 const path=usePathname();
 return <nav className={"lr-navigation"+(collapsed?" is-collapsed":"")} aria-label="Navigazione principale">
 <p className="lr-nav-label">ARCHIVIO IMMOBILIARE</p>
 {workspaceDestinations.map((item,index)=>{const active=workspaceArea(path).area===workspaceArea(item.href).area;const Icon=item.icon;return <div key={item.href}>{index===3&&<p className="lr-nav-label lr-nav-divider">LAVORO E VERIFICHE</p>}<Link onClick={onNavigate} href={item.href} aria-current={active?"page":undefined} className={"lr-nav-item"+(active?" is-active":"")} title={collapsed?item.label:undefined}><Icon aria-hidden="true" size={20}/><span><strong>{item.label}</strong><small>{item.hint}</small></span></Link></div>})}
 <div className="lr-nav-shortcuts"><p className="lr-nav-label">ACCESSO DIRETTO</p><Link onClick={onNavigate} href="/fonti/pratiche">Pratiche e documenti <ArrowUpRight size={14} aria-hidden="true"/></Link><Link onClick={onNavigate} href="/richieste/segnali">Segnali TonyBook <ArrowUpRight size={14} aria-hidden="true"/></Link></div>
 <Link onClick={onNavigate} href="/settings" aria-current={path.startsWith("/settings")?"page":undefined} className={"lr-nav-item lr-nav-settings"+(path.startsWith("/settings")?" is-active":"")}><Cog aria-hidden="true" size={20}/><span><strong>Impostazioni</strong><small>Preferenze e automazioni</small></span></Link></nav>;
}
