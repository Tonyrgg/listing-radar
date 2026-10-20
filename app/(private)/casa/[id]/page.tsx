import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from 'next/link';
import { connection } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { readNow } from "@/lib/clock";
import { getProperty } from "@/lib/matching/repository";
import { vistaCasa } from "@/lib/property-lifecycle/read-models/server";

import { LifecycleUnavailable } from "@/app/(private)/lifecycle/_components/ui";
import { PublicRecords } from "@/components/public-records";
import { readPropertyTerritorialContext } from "@/lib/property-lifecycle/buildings/read-model";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {readFactNews} from '@/lib/property-lifecycle/buildings/facts-read-model';
import {PropertyNewsList} from '@/components/property-news';

import { SchedaMercato } from "./mercato";
import { SchedaNostra } from "./nostra";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "La casa" };

/**
 * Una casa, una scheda sola.
 *
 * La stessa casa poteva avere quattro pagine: la scheda del mercato, la scheda
 * dell'annuncio, quella del portafoglio e il dettaglio di un abbinamento.
 * Quattro impaginazioni, quattro modi di scrivere «superficie», e nessuna che
 * sapesse dell'altra.
 *
 * Adesso l'indirizzo è uno solo. Che la casa la tenga un'agenzia che
 * osserviamo o la teniamo noi cambia quello che si può dire — non la forma con
 * cui si dice.
 */
export default async function CasaPage({
  params,searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: Promise<Record<string,string|string[]|undefined>> }>) {
  await connection();
  const { id } = await params;
  const query=await searchParams;
  const historyPage=Math.max(1,Math.min(10000,Math.floor(Number(query.storia)||1)));

  const [vistaMercato, user, now] = await Promise.all([
    vistaCasa(id,historyPage),
    getCurrentUser(),
    readNow(),
  ]);

  if (vistaMercato.available && vistaMercato.data) {
    const records=await readPropertyTerritorialContext(getSupabaseServiceClient(),vistaMercato.data).catch(()=>null);
    const facts=await readFactNews(getSupabaseServiceClient(),now).then(rows=>rows.filter(r=>r.building_id&&records?.buildingIds.includes(r.building_id))).catch(()=>null);
    return <><SchedaMercato detail={vistaMercato.data} user={user} now={now} />
      <section id="eventi-pubblici" className="mt-6 space-y-3"><h2 className="text-[length:var(--lr-text-section)] font-[650]">Eventi immobiliari pubblici</h2><p>Fatti documentali collegati all’edificio. L’attribuzione alla singola unità resta da verificare.</p>{facts?<><PropertyNewsList rows={facts.slice(0,10)}/>{!facts.length?<p>Nessuna trasformazione sostenuta da prove nel contesto edificio attualmente collegato.</p>:null}{facts.length>10?<Link className="underline" href={`/intelligence?vista=notizie&periodo=all&edificio=${facts[0].building_id}`}>Tutti i fatti e le prove dell’edificio · {facts.length}</Link>:null}</>:<p>Proiezione degli eventi temporaneamente non disponibile.</p>}</section>
      <section id="documenti" className="mt-6 scroll-mt-20"><h2 className="mb-3 text-[length:var(--lr-text-section)] font-[650]">Documenti ed evidenze pubbliche</h2>
        {records?<div className="space-y-5"><div><h3 className="font-[650]">Specifici della singola unità · {records.specific.length}</h3><p>Nessuna prova identifica attualmente la singola unità. I contesti seguenti restano separati.</p></div>
          <h3 className="font-[650]">Collegati all’edificio · {records.building.length}</h3>
          <div className="flex flex-wrap gap-3">{records.buildingIds.map(b=><Link key={b} href={`/map?edificio=${b}#edificio`} className="underline">Apri contesto edificio</Link>)}{records.streetId?<Link href={`/map?via_id=${records.streetId}#contesto`} className="underline">Apri via · {records.recentStreet} atti recenti</Link>:null}</div>
          <PublicRecords records={records.building} propertyContext />
          {records.street.length?<details><summary className="cursor-pointer py-2 font-[650]">Contesto della via · {records.street.length} atti</summary><PublicRecords records={records.street}/></details>:null}
          {records.area.length?<details><summary className="cursor-pointer py-2 font-[650]">Documenti di area · {records.area.length}</summary><PublicRecords records={records.area}/></details>:null}
          <p className="text-[var(--lr-ink-3)]">Il contesto di edificio, via o zona non certifica l’identità della singola unità né la conformità dell’immobile.</p>
        </div>:<p>Il registro documentale non è momentaneamente raggiungibile. Le altre informazioni del dossier restano disponibili.</p>}
      </section></>;
  }

  /* Se non è una casa osservata, può essere una che teniamo noi: gli
   * identificativi vivono in due tabelle diverse, ma per chi guarda è la
   * stessa domanda. */
  const nostra = await getProperty(id);
  if (nostra) {
    return <SchedaNostra id={id} />;
  }

  if (!vistaMercato.available) {
    return <LifecycleUnavailable message={vistaMercato.message} />;
  }

  notFound();
}
