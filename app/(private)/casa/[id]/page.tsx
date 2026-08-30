import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { readNow } from "@/lib/clock";
import { getProperty } from "@/lib/matching/repository";
import { vistaCasa } from "@/lib/property-lifecycle/read-models/server";

import { LifecycleUnavailable } from "@/app/(private)/lifecycle/_components/ui";

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
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  await connection();
  const { id } = await params;

  const [vistaMercato, user, now] = await Promise.all([
    vistaCasa(id),
    getCurrentUser(),
    readNow(),
  ]);

  if (vistaMercato.available && vistaMercato.data) {
    return <SchedaMercato detail={vistaMercato.data} user={user} now={now} />;
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
