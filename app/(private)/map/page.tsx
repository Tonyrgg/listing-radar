import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { TerritoryArchive } from "@/components/map/territory-archive";
import { PublicRecords } from "@/components/public-records";
import { Meta,EmptyState,controlClass,buttonClass } from "@/components/ui/primitives";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { readNow } from "@/lib/clock";
import { PUBLIC_RECORD_LABELS,readPublicRecords } from "@/lib/property-lifecycle/buildings/read-model";
import type { IntelligenceRow } from "@/lib/property-lifecycle/read-models/intelligence";
export const metadata:Metadata={title:"Territorio"};
export default async function MapPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  await connection();
  const params=await searchParams,value=(key:string)=>typeof params[key]==="string"?params[key] as string:"";
  const db=getSupabaseServiceClient(),rows:IntelligenceRow[]=[];
  let failed=false;
  for(let from=0;;from+=500){
    const r=await db.from("market_observer_property_archive").select("*").order("property_id").range(from,from+499);
    if(r.error){failed=true;break;} const page=(r.data??[]) as IntelligenceRow[];rows.push(...page);if(page.length<500)break;
  }
  const page=Math.max(1,Math.floor(Number(value("pagina"))||1));
  const records=await readPublicRecords(db,{query:value("documento"),year:value("anno"),type:value("tipo_atto"),source:value("fonte_atto"),zone:value("area"),page}).catch(()=>null);
  const nextUrl=(n:number)=>{const q=new URLSearchParams({pagina:String(n)});for(const key of ["documento","anno","tipo_atto","fonte_atto","area"])if(value(key))q.set(key,value(key));return `?${q}#documenti-pubblici`;};
  return <div className="space-y-6">
    <PageHeader title="Territorio" description="Tutti gli immobili conosciuti e le evidenze pubbliche sul territorio, anche quando non sono più sul mercato."/>
    {failed?<EmptyState title="Mappa dell’archivio non disponibile" description="La lettura dei dati non è completa. Riprova tra poco; nessun punto è stato cancellato."/>:<TerritoryArchive rows={rows} now={await readNow()}/>}
    <section id="documenti-pubblici" className="scroll-mt-24 space-y-4 border-t border-[var(--lr-line)] pt-6">
      <div><h2 className="text-[length:var(--lr-text-section)] font-[650]">Documenti pubblici e pratiche edilizie</h2><Meta>Registro comunale già importato e catalogo ufficiale SIT/PRG. I piani sono contesto di area, non vincoli assegnati automaticamente alle case.</Meta></div>
      <form method="get" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="min-w-0"><span className="mb-1 block">Via, civico, titolo o pratica</span><input name="documento" defaultValue={value("documento")} className={controlClass()} placeholder="Cerca nelle prove pubbliche"/></label>
        <label><span className="mb-1 block">Anno pratica</span><input name="anno" type="number" min="1900" max="2100" defaultValue={value("anno")} className={controlClass()}/></label>
        <label><span className="mb-1 block">Tipo documento</span><select name="tipo_atto" defaultValue={value("tipo_atto")} className={controlClass()}><option value="">Tutti</option>{Object.entries(PUBLIC_RECORD_LABELS).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
        <label><span className="mb-1 block">Fonte</span><select name="fonte_atto" defaultValue={value("fonte_atto")} className={controlClass()}><option value="">Tutte</option><option value="comune-bitonto-elenco-pratiche">Registro pratiche edilizie</option><option value="comune-bitonto-prg-catalog">SIT / PRG, catalogo documenti</option></select></label>
        <label><span className="mb-1 block">Area documentale dichiarata</span><select name="area" defaultValue={value("area")} className={controlClass()}><option value="">Tutte</option>{["Bitonto","Palombaio","Mariotto"].map(z=><option key={z}>{z}</option>)}</select></label>
        <div className="flex items-end gap-2"><button className={buttonClass("secondary")}>Cerca documenti</button><Link href="/map#documenti-pubblici" className={buttonClass("quiet")}>Azzera</Link></div>
      </form>
      {records?<PublicRecords records={records.records}/>:<EmptyState title="Documenti temporaneamente non disponibili" description="La lettura del registro pubblico non è riuscita. Riprova tra poco."/>}
      <nav aria-label="Pagine documenti" className="flex items-center justify-between gap-3">{page>1?<Link href={nextUrl(page-1)} className={buttonClass("secondary")}>Documenti precedenti</Link>:<span/>}<Meta>Pagina {page}</Meta>{records?.hasNext?<Link href={nextUrl(page+1)} className={buttonClass("secondary")}>Altri documenti</Link>:<span/>}</nav>
    </section>
  </div>;
}
