"use client";
import {useActionState} from "react";
import Link from "next/link";
import {CheckCircle2,HelpCircle,Undo2} from "lucide-react";
import {saveQuickPropertySaleDecision} from "@/app/(private)/lifecycle/actions";
import {controlClass,buttonClass} from "@/components/ui/primitives";

const choices=[
 {value:"SOLD_CONFIRMED",label:"Venduto",description:"Sposta nei Venduti",Icon:CheckCircle2},
 {value:"NOT_SOLD_CONFIRMED",label:"Non venduto",description:"Correggi un segnale errato",Icon:Undo2},
 {value:"UNKNOWN",label:"Da verificare",description:"Esito non confermato",Icon:HelpCircle},
];
export function QuickSaleDecision({propertyId,saleStatus}:{propertyId:string;saleStatus:string}){
 const [result,action,pending]=useActionState(saveQuickPropertySaleDecision,{ok:false,message:""});
 const selected=result.ok&&result.status?result.status:saleStatus;
 return <form action={action} aria-busy={pending} className="space-y-3 lg:col-span-3">
  <input type="hidden" name="propertyId" value={propertyId}/>
  <div><h3 className="font-semibold">Esito della vendita</h3><p className="text-sm text-[var(--lr-ink-3)]">Un clic registra la tua conferma e aggiorna liste, scheda e mappa.</p></div>
  <div className="grid gap-2 sm:grid-cols-3">
   {choices.map(({value,label,description,Icon})=><button key={value} type="submit" name="saleStatus" value={value} disabled={pending} aria-pressed={selected===value}
    className="flex min-h-20 items-center gap-3 rounded border border-[var(--lr-line)] px-4 py-3 text-left transition-colors hover:bg-[var(--lr-raised)] disabled:cursor-wait disabled:opacity-60 aria-pressed:border-[var(--lr-ink-2)] aria-pressed:bg-[var(--lr-raised)]">
    <Icon size={20} aria-hidden="true"/><span><strong className="block">{label}</strong><span className="text-sm text-[var(--lr-ink-3)]">{description}</span></span>
   </button>)}
  </div>
  <label className="block"><span className="mb-1 block text-sm">Nota facoltativa · aggiungila prima di scegliere l’esito</span><input name="reason" maxLength={2000} className={controlClass()} placeholder="Es. confermato dal proprietario" disabled={pending}/></label>
  <p className="text-sm text-[var(--lr-ink-3)]">Registriamo chi conferma e quando. Data e prezzo effettivi della vendita restano sconosciuti se non documentati.</p>
  <div role="status" aria-live="polite">{pending?"Salvataggio della correzione…":result.message}</div>
  {result.ok&&result.status==="SOLD_CONFIRMED"?<Link href="/intelligence?vista=venduti" className={buttonClass("secondary")}>Apri Venduti</Link>:null}
 </form>;
}
