import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { readNow } from "@/lib/clock";
import { getProperty } from "@/lib/matching/repository";
import { vistaCasa } from "@/lib/property-lifecycle/read-models/server";

import { LifecycleUnavailable } from "@/app/(private)/lifecycle/_components/ui";
import { PublicRecords } from "@/components/public-records";
import { readPropertyPublicRecords } from "@/lib/property-lifecycle/buildings/read-model";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

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
    const records=await readPropertyPublicRecords(getSupabaseServiceClient(),vistaMercato.data).catch(()=>null);
    return <><SchedaMercato detail={vistaMercato.data} user={user} now={now} />
      <section id="documenti" className="mt-6 scroll-mt-20"><h2 className="mb-3 text-[length:var(--lr-text-section)] font-[650]">Documenti ed evidenze pubbliche</h2>
        {records?<PublicRecords records={records} propertyContext />:<p>Il registro documentale non è momentaneamente raggiungibile. Le altre informazioni del dossier restano disponibili.</p>}
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
