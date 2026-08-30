import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { EventRow } from "@/components/event-row";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, Chip, EmptyState, Meta, buttonClass } from "@/components/ui/primitives";
import { formatNumber } from "@/lib/formatting";
import { signPropertyPhotos } from "@/lib/lifecycle-photos";
import { lifecycleEventCountLabel } from "@/lib/property-lifecycle/read-models/presentation";
import { vistaMovimenti } from "@/lib/property-lifecycle/read-models/server";
import type { LifecycleEventItem } from "@/lib/property-lifecycle/read-models/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Giorno per giorno" };

/**
 * Giorno per giorno.
 *
 * Questa pagina leggeva i riepiloghi testuali del vecchio archivio e ne
 * estraeva i numeri con un'espressione regolare. Da quando i crawler V1 sono
 * spenti quei riepiloghi non arrivano più: la pagina mostrava lo stesso
 * giorno ripetuto, «54 annunci · 0 nuovi», con la stessa classifica identica
 * per ogni data. Numeri veri di un sistema fermo, che sembravano freschi.
 *
 * Ora legge i movimenti veri di Property Lifecycle e li raccoglie per data:
 * i giorni in cui il mercato si è mosso, e cosa ha fatto.
 */

const GIORNI_DA_MOSTRARE = 21;

function giorno(iso: string) {
  return iso.slice(0, 10);
}

function nomeDelGiorno(iso: string, oggi: string) {
  if (giorno(iso) === oggi) return "Oggi";

  const ieri = new Date(`${oggi}T12:00:00Z`);
  ieri.setUTCDate(ieri.getUTCDate() - 1);
  if (giorno(iso) === ieri.toISOString().slice(0, 10)) return "Ieri";

  return new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

/** Cosa è successo quel giorno, contato per tipo. */
function riassunto(eventi: LifecycleEventItem[]) {
  const conteggi = new Map<string, number>();
  for (const evento of eventi) {
    conteggi.set(evento.eventType, (conteggi.get(evento.eventType) ?? 0) + 1);
  }

  return [...conteggi.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tipo, quanti]) => `${formatNumber(quanti)} ${lifecycleEventCountLabel(tipo, quanti)}`);
}

export default async function GiornoPerGiornoPage() {
  await connection();

  const vista = await vistaMovimenti(300);

  if (!vista.available || !vista.data) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Oggi"
          title="Giorno per giorno"
          description="Cosa ha fatto il mercato, una data alla volta."
          backHref="/dashboard"
          backLabel="Torna a Oggi"
        />
        <Card>
          <CardBody>
            <EmptyState
              title="I movimenti non sono raggiungibili"
              description="Questa pagina lavora sull'archivio dei segnali, che al momento non risponde."
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  const eventi = vista.data;
  const oggi = new Date().toISOString().slice(0, 10);

  const perGiorno = new Map<string, LifecycleEventItem[]>();
  for (const evento of eventi) {
    const chiave = giorno(evento.occurredAt);
    perGiorno.set(chiave, [...(perGiorno.get(chiave) ?? []), evento]);
  }

  const giorni = [...perGiorno.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, GIORNI_DA_MOSTRARE);

  const foto = await signPropertyPhotos(eventi.map((evento) => evento.property));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Oggi"
        title="Giorno per giorno"
        description="Cosa ha fatto il mercato, una data alla volta: prezzi che scendono, annunci che escono, case che tornano in mano al proprietario."
        backHref="/dashboard"
        backLabel="Torna a Oggi"
        actions={
          <Chip tone="neutral">
            {formatNumber(eventi.length)} movimenti in {formatNumber(perGiorno.size)} giorni
          </Chip>
        }
      />

      {giorni.length ? (
        giorni.map(([data, delGiorno]) => (
          <Card key={data}>
            <CardHeader
              title={nomeDelGiorno(delGiorno[0].occurredAt, oggi)}
              meta={riassunto(delGiorno).join(" · ")}
              action={
                <Meta>
                  {formatNumber(delGiorno.length)}{" "}
                  {delGiorno.length === 1 ? "movimento" : "movimenti"}
                </Meta>
              }
            />
            <div>
              {delGiorno.slice(0, 8).map((evento) => (
                <EventRow
                  key={evento.id}
                  event={evento}
                  foto={foto.get(evento.propertyId)}
                  mostraOra
                />
              ))}
            </div>
            {delGiorno.length > 8 ? (
              <p className="border-t border-[var(--lr-line-quiet)] px-3 py-2 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                e altri {formatNumber(delGiorno.length - 8)} movimenti in questa giornata
              </p>
            ) : null}
          </Card>
        ))
      ) : (
        <Card>
          <CardBody>
            <EmptyState
              title="Il mercato non si è ancora mosso"
              description="Qui compariranno i giorni in cui qualcosa è cambiato: un prezzo, un mandato, un annuncio uscito."
              action={
                <Link href="/lifecycle" className={buttonClass("secondary", { compact: true })}>
                  Vai ai segnali
                </Link>
              }
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
