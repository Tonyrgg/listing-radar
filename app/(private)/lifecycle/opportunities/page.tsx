import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { PropertyRow, signalsFromOpportunity } from "@/components/property-row";
import { livelloFromOpportunity } from "@/components/ui/atoms";
import { Card, CardBody, Chip, EmptyState, Meta, buttonClass } from "@/components/ui/primitives";
import { readNow } from "@/lib/clock";
import { signPropertyPhotos } from "@/lib/lifecycle-photos";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";

import { LifecycleHeader, LifecycleUnavailable } from "../_components/ui";

export const metadata: Metadata = { title: "Opportunità" };

/**
 * Da quali case conviene passare.
 *
 * Prima ogni riga portava «Indice 50 su 100», che non dice se 50 è tanto, e
 * i filtri erano i livelli del database. Adesso il filtro è la domanda vera —
 * quanta attenzione merita — e la riga è la stessa dell'archivio: foto,
 * indirizzo, prezzo, e il motivo per cui è lì.
 */

const FILTRI = [
  { chiave: "tutte", etichetta: "Tutte" },
  { chiave: "chiamare", etichetta: "Da chiamare" },
  { chiave: "occhiata", etichetta: "Vale un'occhiata" },
  { chiave: "occhio", etichetta: "Da tenere d'occhio" },
] as const;

type Filtro = (typeof FILTRI)[number]["chiave"];

const LIVELLO_DEL_FILTRO: Record<Exclude<Filtro, "tutte">, "alta" | "media" | "bassa"> = {
  chiamare: "alta",
  occhiata: "media",
  occhio: "bassa",
};

export default async function OpportunitaPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await connection();

  const query = await searchParams;
  const richiesto = Array.isArray(query.quanto) ? query.quanto[0] : query.quanto;
  const filtro: Filtro = FILTRI.some((voce) => voce.chiave === richiesto)
    ? (richiesto as Filtro)
    : "tutte";

  const [view, now] = await Promise.all([
    loadLifecycleView((repository) => repository.opportunities()),
    readNow(),
  ]);

  if (!view.available || !view.data) return <LifecycleUnavailable message={view.message} />;

  const tutte = view.data;
  const visibili =
    filtro === "tutte"
      ? tutte
      : tutte.filter(
          (item) => livelloFromOpportunity(item.level) === LIVELLO_DEL_FILTRO[filtro],
        );

  const foto = await signPropertyPhotos(visibili.slice(0, 40).map((item) => item.property));

  return (
    <>
      <LifecycleHeader
        eyebrow="Opportunità"
        title="Da quali case conviene passare"
        description="Nascono da fatti osservati: un mandato finito senza prova di vendita, un ritorno da privato, un prezzo che scende da mesi. La lista mette in fila il lavoro, non decide al posto tuo."
        actions={<Chip tone="neutral">{visibili.length} in lista</Chip>}
      />

      <div className="flex flex-wrap gap-2">
        {FILTRI.map((voce) => (
          <Link
            key={voce.chiave}
            href={voce.chiave === "tutte" ? "/lifecycle/opportunities" : `?quanto=${voce.chiave}`}
            className={buttonClass(filtro === voce.chiave ? "secondary" : "quiet", {
              compact: true,
            })}
            aria-current={filtro === voce.chiave ? "page" : undefined}
          >
            {voce.etichetta}
          </Link>
        ))}
      </div>

      <Card>
        {visibili.length ? (
          <div>
            {visibili.slice(0, 40).map((item) => (
              <PropertyRow
                key={item.id}
                property={item.property}
                foto={foto.get(item.property.id)}
                signals={signalsFromOpportunity(item)}
                now={now}
                giudizioSempre
              />
            ))}
          </div>
        ) : (
          <CardBody>
            <EmptyState
              title="Niente in questa fascia"
              description="Prova a guardare tutte le case: le occasioni forti sono rare, ed è normale che una fascia resti vuota."
              action={
                <Link
                  href="/lifecycle/opportunities"
                  className={buttonClass("secondary", { compact: true })}
                >
                  Mostra tutte
                </Link>
              }
            />
          </CardBody>
        )}
      </Card>

      {visibili.length > 40 ? (
        <Meta className="px-1">
          Ne vedi 40 di {visibili.length}: usa i filtri qui sopra per arrivare alle altre.
        </Meta>
      ) : null}
    </>
  );
}
