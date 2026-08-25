import { ArrowRight, RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { EventRow } from "@/components/event-row";
import { PendingSubmitButton } from "@/components/loading-controls";
import { PropertyRow, signalsFromOpportunity } from "@/components/property-row";
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Meta,
  buttonClass,
} from "@/components/ui/primitives";
import { readNow } from "@/lib/clock";
import { formatDate, formatNumber } from "@/lib/formatting";
import { signPropertyPhotos } from "@/lib/lifecycle-photos";
import { isMarketMove } from "@/lib/property-lifecycle/read-models/market-events";
import {
  lifecycleEventLabel,
} from "@/lib/property-lifecycle/read-models/presentation";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";
import type { LifecycleEventItem } from "@/lib/property-lifecycle/read-models/types";

import { enqueueGlobalLifecycleRefresh } from "./actions";
import { LifecycleHeader, LifecycleUnavailable } from "./_components/ui";
import styles from "./lifecycle.module.css";

export const metadata: Metadata = { title: "Segnali" };

/**
 * Segnali — cosa è cambiato sul mercato.
 *
 * Due domande, due colonne: cosa si è mosso da solo, e da quali case conviene
 * passare adesso. Le cifre in cima non sono un cruscotto: sono la frase che
 * dice quanto grande è il mercato che stai guardando.
 */

/**
 * Sei righe «Segnale di vendita» dello stesso giorno non sono sei notizie: è
 * una notizia sola letta sei volte. Di ogni serie restano le prime due righe,
 * con le foto, e una riga che dice quante altre erano uguali.
 */
type Blocco =
  | { genere: "evento"; event: LifecycleEventItem }
  | { genere: "altre"; eventType: string; quante: number; giorno: string };

function raggruppaMovimenti(events: LifecycleEventItem[]): Blocco[] {
  const blocchi: Blocco[] = [];
  let inizio = 0;

  while (inizio < events.length) {
    const tipo = events[inizio].eventType;
    const giorno = events[inizio].occurredAt.slice(0, 10);

    let fine = inizio;
    while (
      fine < events.length &&
      events[fine].eventType === tipo &&
      events[fine].occurredAt.slice(0, 10) === giorno
    ) {
      fine += 1;
    }

    const serie = events.slice(inizio, fine);
    for (const event of serie.slice(0, 2)) {
      blocchi.push({ genere: "evento", event });
    }

    if (serie.length > 2) {
      blocchi.push({
        genere: "altre",
        eventType: tipo,
        quante: serie.length - 2,
        giorno: serie[2].occurredAt,
      });
    }

    inizio = fine;
  }

  return blocchi;
}

function Cifra({
  valore,
  cosa,
  href,
}: Readonly<{ valore: number; cosa: string; href?: string }>) {
  const corpo = (
    <>
      <strong className="block text-[length:var(--lr-text-page)] font-[650] leading-none tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
        {formatNumber(valore)}
      </strong>
      <span className="mt-1.5 block text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]">
        {cosa}
      </span>
    </>
  );

  if (!href) {
    return <div className="min-w-0 px-4 py-3">{corpo}</div>;
  }

  return (
    <Link
      href={href}
      className="min-w-0 rounded-[var(--lr-radius-control)] px-4 py-3 transition-colors hover:bg-[var(--lr-raised)]"
    >
      {corpo}
    </Link>
  );
}

export default async function SegnaliPage() {
  await connection();

  const [view, now] = await Promise.all([
    loadLifecycleView((repository) => repository.dashboard()),
    readNow(),
  ]);

  if (!view.available || !view.data) {
    return <LifecycleUnavailable message={view.message} />;
  }

  const dashboard = view.data;
  const movimenti = dashboard.recentEvents.filter((event) => isMarketMove(event.eventType));
  const blocchi = raggruppaMovimenti(movimenti);
  const occasioni = dashboard.priorityOpportunities.slice(0, 6);

  /* Una firma sola per tutte le foto della pagina: eventi e occasioni parlano
   * spesso delle stesse case. */
  const foto = await signPropertyPhotos([
    ...movimenti.map((event) => event.property),
    ...occasioni.map((item) => item.property),
  ]);

  return (
    <>
      <LifecycleHeader
        eyebrow="Segnali"
        title="Cosa è cambiato sul mercato"
        description="Ogni movimento ricondotto alla casa vera: prezzi che scendono, annunci che spariscono, mandati che cambiano mano."
        actions={
          <>
            {/* Rileggere tutte le fonti è un'azione di questa sezione, non una
              * voce di menu: stava in una barra a parte, scritta «Refresh All». */}
            <form action={enqueueGlobalLifecycleRefresh}>
              <PendingSubmitButton
                type="submit"
                pendingLabel="Metto in coda"
                icon={<RefreshCw aria-hidden="true" className="size-4" />}
                className={styles.secondaryAction}
              >
                Rileggi tutte le fonti
              </PendingSubmitButton>
            </form>
          </>
        }
      />

      {/* Quanto grande è il mercato che stai guardando. */}
      <Card className="flex flex-wrap divide-x divide-[var(--lr-line-quiet)]">
        <Cifra valore={dashboard.metrics.totalProperties} cosa="case osservate" href="/listings" />
        <Cifra valore={dashboard.metrics.activeProperties} cosa="ancora in vendita" href="/listings" />
        <Cifra
          valore={dashboard.metrics.activePrivate}
          cosa="vendute da un privato"
          href="/lifecycle/private"
        />
        <Cifra
          valore={dashboard.metrics.openReviews}
          cosa="cose da decidere"
          href="/lifecycle/review"
        />
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader
            title="Cosa si è mosso"
            meta="Solo movimenti veri: il primo censimento non è una notizia."
          />
          {movimenti.length ? (
            <div>
              {blocchi.map((blocco) =>
                blocco.genere === "evento" ? (
                  <EventRow
                    key={blocco.event.id}
                    event={blocco.event}
                    foto={foto.get(blocco.event.propertyId)}
                  />
                ) : (
                  <p
                    key={`${blocco.eventType}-${blocco.giorno}`}
                    className="border-t border-[var(--lr-line-quiet)] px-3 py-2 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]"
                  >
                    {blocco.quante === 1
                      ? "e un'altra casa"
                      : `e altre ${formatNumber(blocco.quante)} case`}{" "}
                    con lo stesso segnale «
                    {lifecycleEventLabel(blocco.eventType).toLocaleLowerCase("it")}» il{" "}
                    {formatDate(blocco.giorno)}
                  </p>
                ),
              )}
            </div>
          ) : (
            <CardBody>
              <EmptyState
                title="Il mercato è fermo"
                description="Nessun prezzo cambiato, nessun annuncio uscito, nessun mandato passato di mano dall'ultima lettura delle fonti."
              />
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Da guardare adesso"
            meta="Le case che hanno più di un indizio a loro favore."
            action={
              <Link
                href="/lifecycle/opportunities"
                className={buttonClass("quiet", { compact: true })}
              >
                Tutte
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            }
          />
          {occasioni.length ? (
            <div>
              {occasioni.map((item) => (
                <PropertyRow
                  key={item.id}
                  property={item.property}
                  foto={foto.get(item.propertyId)}
                  signals={signalsFromOpportunity(item)}
                  now={now}
                  compact
                />
              ))}
            </div>
          ) : (
            <CardBody>
              <EmptyState
                title="Nessuna casa in evidenza"
                description="Le occasioni nascono da uscite senza prova di vendita e da passaggi a privato: finché non ce ne sono, questa colonna resta vuota."
              />
            </CardBody>
          )}
        </Card>
      </div>

      <Meta className="px-1">
        Aggiornato con l&apos;ultima lettura delle fonti. Il testo tratteggiato è dedotto da noi,
        non dichiarato dalla fonte.
      </Meta>
    </>
  );
}
