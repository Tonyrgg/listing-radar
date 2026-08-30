import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { DashboardEventCard } from "@/components/dashboard-event-card";
import { Banda, FasciaVuota, StrisciaFiducia } from "@/components/home-bands";
import { PageHeader } from "@/components/page-header";
import { PropertyRow, signalsFromOpportunity } from "@/components/property-row";
import { QuickRequestButton } from "@/components/matching/quick-request";
import { livelloFromOpportunity } from "@/components/ui/atoms";
import { Chip, buttonClass } from "@/components/ui/primitives";
import { readNow } from "@/lib/clock";
import { isMarketMove } from "@/lib/property-lifecycle/read-models/market-events";
import { vistaOggi } from "@/lib/property-lifecycle/read-models/server";
import { signPropertyPhotos } from "@/lib/lifecycle-photos";
import { getSourcesSummary } from "@/lib/sources-health";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Oggi" };



export default async function TodayPage() {
  await connection();

  const [sources, segnali, now] = await Promise.all([
    getSourcesSummary(),
    vistaOggi(),
    readNow(),
  ]);

  const eventi = (segnali.data?.recentEvents ?? [])
    .filter((event) => isMarketMove(event.eventType))
    .slice(0, 6);

  /* La fascia si chiama «cosa conviene guardare»: mettere righe deboli sotto
   * quel titolo è disonesto. Si mostra solo ciò che merita davvero. */
  const occasioni = (segnali.data?.priorityOpportunities ?? [])
    .filter((item) => livelloFromOpportunity(item.level) !== "bassa")
    .slice(0, 4);

  const foto = await signPropertyPhotos([
    ...occasioni.map((item) => item.property),
    ...eventi.map((event) => event.property),
  ]);

  const oggi = new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(now));

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={oggi.charAt(0).toUpperCase() + oggi.slice(1)}
        title="Oggi"
        actions={<QuickRequestButton />}
      />

      {/* Fascia 0 — quanto puoi fidarti di quello che stai per leggere. */}
      <StrisciaFiducia sources={sources} />

      {/* Fascia 1 — cosa è cambiato senza di te. */}
      <Banda
        numero={1}
        titolo="Cosa si è mosso"
        conteggio={eventi.length ? <Chip tone="info">{eventi.length} movimenti</Chip> : null}
        azione={
          eventi.length ? (
            <Link href="/lifecycle" className={buttonClass("quiet", { compact: true })}>
              Tutti i segnali
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null
        }
      >
        {eventi.length ? (
          <div className="grid gap-4 p-4 md:grid-cols-2 2xl:grid-cols-3">
            {eventi.map((event) => (
              <DashboardEventCard
                key={event.id}
                event={event}
                foto={foto.get(event.propertyId)}
                now={now}
              />
            ))}
          </div>
        ) : (
          <FasciaVuota
            titolo={segnali.available ? "Il mercato è fermo" : "I segnali non sono disponibili"}
            descrizione={
              segnali.available
                ? "Nessun ribasso, uscita o passaggio di agenzia da quando hai guardato l'ultima volta."
                : "Questa sezione lavora su un archivio separato che non risulta pronto. Il resto della pagina funziona normalmente."
            }
          />
        )}
      </Banda>

      {/* Fascia 2 — il giudizio. */}
      <Banda
        numero={2}
        titolo="Cosa conviene guardare adesso"
        conteggio={
          occasioni.length ? (
            <Chip tone="neutral">
              {occasioni.length === 1 ? "1 da guardare" : `${occasioni.length} da guardare`}
            </Chip>
          ) : null
        }
        azione={
          occasioni.length ? (
            <Link
              href="/lifecycle/opportunities"
              className={buttonClass("quiet", { compact: true })}
            >
              Tutte
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null
        }
      >
        {occasioni.length ? (
          <div>
            {/* La stessa riga dell'archivio: cambia il posto, non la casa. */}
            {occasioni.map((item) => (
              <PropertyRow
                key={item.id}
                property={item.property}
                foto={foto.get(item.property.id)}
                signals={signalsFromOpportunity(item)}
                now={now}
              />
            ))}
          </div>
        ) : (
          <FasciaVuota
            titolo="Oggi non c'è niente che meriti una telefonata"
            descrizione="Nessuna proprietà osservata mostra segnali forti. Non è un errore: è un mercato fermo."
            azione={
              <Link href="/lifecycle/opportunities" className={buttonClass("secondary", { compact: true })}>
                Vedi tutti i segnali
              </Link>
            }
          />
        )}
      </Banda>

    </div>
  );
}
