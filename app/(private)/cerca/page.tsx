import { ArrowRight, MapPinned, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { PageHeader } from "@/components/page-header";
import { PortfolioRow } from "@/components/matching/portfolio-row";
import { PropertyRow } from "@/components/property-row";
import {
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Meta,
  Ricerca,
  buttonClass,
} from "@/components/ui/primitives";
import { readNow } from "@/lib/clock";
import { formatCurrency, formatNumber, formatShouty } from "@/lib/formatting";
import { signPropertyPhotos } from "@/lib/lifecycle-photos";
import { cleanRequestTitle } from "@/lib/matching/request-presentation";
import { cercaOvunque } from "@/lib/search";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cerca" };

/**
 * Una ricerca sola, per tutto.
 *
 * Ogni sezione aveva la sua casella e cercava solo dentro di sé: per trovare
 * «via Piepoli» bisognava già sapere se era una casa del mercato, una casa
 * nostra, la richiesta di un cliente o una zona. Sapere dove cercare una cosa
 * è un lavoro che il programma può fare da solo.
 */

function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function CercaPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  await connection();

  const query = await searchParams;
  const termine = param(query.q).trim();

  const [risultati, now] = await Promise.all([cercaOvunque(termine), readNow()]);
  const foto = await signPropertyPhotos(risultati.case);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Cerca"
        title={termine ? `“${termine}”` : "Cerca in tutto"}
        description="Case osservate sul mercato, case che teniamo noi, clienti e zone: tutto insieme, senza dover sapere dove sta."
        actions={
          termine ? (
            <Chip tone={risultati.quante ? "neutral" : "warn"}>
              {risultati.quante === 1 ? "1 risultato" : `${formatNumber(risultati.quante)} risultati`}
            </Chip>
          ) : null
        }
      />

      <form className="flex flex-wrap items-center gap-2">
        <Ricerca
          label="Cerca in tutto"
          defaultValue={termine}
          placeholder="via, zona, nome di un cliente, agenzia…"
        />
      </form>

      {!termine ? (
        <Card className="p-4">
          <EmptyState
            title="Scrivi qualcosa"
            description="Bastano due lettere. Cerca una via per trovare le case che ci stanno sopra, il nome di un cliente per aprire la sua richiesta, il nome di una zona per vedere che perimetro ha."
          />
        </Card>
      ) : null}

      {termine && !risultati.quante ? (
        <Card className="p-4">
          <EmptyState
            title={`Niente che somigli a “${termine}”`}
            description="Prova con meno lettere, o con il nome della via senza il numero civico: gli indirizzi arrivano dai portali e non sono sempre scritti allo stesso modo."
          />
        </Card>
      ) : null}

      {risultati.case.length ? (
        <Card>
          <CardHeader
            title="Case osservate sul mercato"
            meta="Quello che tengono le altre agenzie, o che vende un privato."
            action={
              <Link
                href={`/listings?q=${encodeURIComponent(termine)}`}
                className={buttonClass("quiet", { compact: true })}
              >
                Tutte nell&apos;archivio
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            }
          />
          <div>
            {risultati.case.map((property) => (
              <PropertyRow
                key={property.id}
                property={property}
                foto={foto.get(property.id)}
                now={now}
              />
            ))}
          </div>
        </Card>
      ) : null}

      {risultati.nostre.length ? (
        <Card>
          <CardHeader
            title="Case che teniamo noi"
            meta="Gli incarichi del portafoglio."
            action={
              <Link
                href={`/portfolio?q=${encodeURIComponent(termine)}`}
                className={buttonClass("quiet", { compact: true })}
              >
                Tutto il portafoglio
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            }
          />
          <div>
            {risultati.nostre.map((property) => (
              <PortfolioRow
                key={property.id}
                property={property}
                href={`/portfolio/${property.id}`}
                tono={property.mandate_status === "active" ? "action" : "neutral"}
              />
            ))}
          </div>
        </Card>
      ) : null}

      {risultati.richieste.length ? (
        <Card>
          <CardHeader
            title="Clienti che cercano"
            meta="Richieste aperte e chiuse."
            action={
              <Link
                href={`/requests?q=${encodeURIComponent(termine)}`}
                className={buttonClass("quiet", { compact: true })}
              >
                Tutte le richieste
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            }
          />
          <div>
            {risultati.richieste.map((richiesta) => {
              const budget =
                richiesta.contract_type === "sale"
                  ? (richiesta.budget_max ?? richiesta.budget_ideal)
                  : (richiesta.monthly_rent_max ?? richiesta.monthly_rent_ideal);

              return (
                <Link
                  key={richiesta.id}
                  href={`/requests/${richiesta.id}`}
                  className="flex items-center gap-3 border-t border-[var(--lr-line-quiet)] px-3 py-2.5 transition-colors first:border-t-0 hover:bg-[var(--lr-raised)]"
                >
                  <UserRound aria-hidden="true" className="size-4 shrink-0 text-[var(--lr-ink-3)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink)]">
                      {richiesta.clients?.full_name ?? cleanRequestTitle(richiesta.title)}
                    </span>
                    <span className="block truncate text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                      {[
                        richiesta.contract_type === "sale" ? "vuole comprare" : "cerca in affitto",
                        budget != null ? `fino a ${formatCurrency(budget)}` : null,
                        richiesta.municipality,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-[var(--lr-ink-3)]" />
                </Link>
              );
            })}
          </div>
        </Card>
      ) : null}

      {risultati.zone.length ? (
        <Card>
          <CardHeader title="Zone" meta="I perimetri con cui leggiamo il territorio." />
          <div>
            {risultati.zone.map((zona) => (
              <Link
                key={zona.id}
                href="/zones"
                className="flex items-center gap-3 border-t border-[var(--lr-line-quiet)] px-3 py-2.5 transition-colors first:border-t-0 hover:bg-[var(--lr-raised)]"
              >
                <MapPinned aria-hidden="true" className="size-4 shrink-0 text-[var(--lr-ink-3)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink)]">
                    {formatShouty(zona.name)}
                  </span>
                  {zona.associated_streets?.length ? (
                    <span className="block truncate text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                      {zona.associated_streets.slice(0, 6).join(", ")}
                    </span>
                  ) : null}
                </span>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-[var(--lr-ink-3)]" />
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      {risultati.quante ? (
        <Meta className="px-1">
          La ricerca guarda l&apos;indirizzo scritto dal portale e quello che abbiamo riconosciuto
          noi: una casa può comparire con il nome della via anche se l&apos;annuncio non lo diceva.
        </Meta>
      ) : null}
    </div>
  );
}
