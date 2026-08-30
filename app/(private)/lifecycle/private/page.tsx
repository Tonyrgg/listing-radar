import { ExternalLink, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { Dato, Stato, certaintyFromConfidence } from "@/components/ui/atoms";
import { Card, CardBody, Chip, EmptyState, Meta, Stripe } from "@/components/ui/primitives";
import { formatCurrency, formatDate, formatNumber, formatShouty } from "@/lib/formatting";
import { getSourceLabel } from "@/lib/labels";
import { signPropertyPhotos } from "@/lib/lifecycle-photos";
import { identityOutcomeLabel } from "@/lib/property-lifecycle/read-models/presentation";
import { vistaPrivati } from "@/lib/property-lifecycle/read-models/server";

import { LifecycleHeader, LifecycleUnavailable } from "../_components/ui";

export const metadata: Metadata = { title: "Privati" };

/**
 * Chi vende da solo.
 *
 * È la ragione per cui questo programma esiste: una casa che esce da
 * un'agenzia e ricompare pubblicata dal proprietario è la sola informazione
 * che nessun portale ti regala. Perciò qui si scrive per esteso da dove
 * arriva l'annuncio, quanto siamo sicuri che sia la stessa casa, e chi la
 * teneva prima.
 *
 * Nomi, telefoni ed email del venditore non entrano: il collegamento si fa
 * con posizione e caratteristiche dell'immobile.
 */

export default async function PrivatiPage() {
  await connection();

  const view = await vistaPrivati();
  if (!view.available || !view.data) return <LifecycleUnavailable message={view.message} />;

  const annunci = view.data;
  const attivi = annunci.filter((annuncio) => annuncio.state === "ACTIVE");
  const foto = await signPropertyPhotos(annunci.map((annuncio) => annuncio.property));

  return (
    <>
      <LifecycleHeader
        eyebrow="Segnali"
        title="Chi vende da solo"
        description="Una casa che lascia l'agenzia e ricompare pubblicata dal proprietario: è il momento in cui serve esserci. Il collegamento con l'immobile si fa su posizione e caratteristiche — nomi, telefoni ed email del venditore non entrano qui."
        actions={
          <Chip tone={attivi.length ? "warn" : "neutral"}>
            {attivi.length} {attivi.length === 1 ? "annuncio attivo" : "annunci attivi"}
          </Chip>
        }
      />

      {annunci.length ? (
        <Card>
          <div>
            {annunci.map((annuncio) => {
              const casa = annuncio.property;
              const immagine = foto.get(casa.id);
              const attivo = annuncio.state === "ACTIVE";
              const agenziaPrecedente = casa.agencies[0];

              return (
                <article
                  key={annuncio.id}
                  className="flex items-stretch gap-3 border-t border-[var(--lr-line-quiet)] p-3 first:border-t-0"
                >
                  <Stripe tone={attivo ? "warn" : "neutral"} />

                  <Link
                    href={`/casa/${casa.id}`}
                    className="block h-24 w-32 shrink-0 overflow-hidden rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)] sm:h-28 sm:w-40"
                    aria-label={`Apri la scheda di ${formatShouty(casa.address ?? casa.title)}`}
                  >
                    {immagine ? (
                      <span
                        className="block size-full bg-cover bg-center"
                        style={{ backgroundImage: `url("${immagine}")` }}
                      />
                    ) : null}
                  </Link>

                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                      <span className="inline-flex items-center gap-1.5 text-[var(--lr-warn)]">
                        <UserRound aria-hidden="true" className="size-3.5" />
                        La vende il proprietario
                      </span>
                      <span>su {getSourceLabel(annuncio.source)}</span>
                      <span>
                        dal {formatDate(annuncio.firstSeenAt)}
                        {annuncio.removedAt ? ` al ${formatDate(annuncio.removedAt)}` : ""}
                      </span>
                    </div>

                    <Link
                      href={`/casa/${casa.id}`}
                      className="truncate text-[length:var(--lr-text-record)] font-[650] leading-snug tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)] hover:underline"
                    >
                      {formatShouty(casa.address ?? annuncio.title)}
                    </Link>

                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
                      <b className="font-[650] text-[var(--lr-ink)]">
                        {formatCurrency(annuncio.price)}
                      </b>
                      {annuncio.surfaceSqm != null ? (
                        <span>{formatNumber(annuncio.surfaceSqm)} mq</span>
                      ) : null}
                      {annuncio.rooms != null ? (
                        <span>{formatNumber(annuncio.rooms)} locali</span>
                      ) : null}
                    </div>

                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                      <Dato certainty={certaintyFromConfidence(annuncio.identityScore)}>
                        {identityOutcomeLabel(annuncio.identityOutcome)}
                      </Dato>
                      {agenziaPrecedente ? (
                        <span>
                          prima la teneva {formatShouty(agenziaPrecedente.name)}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end justify-center gap-2">
                    <Stato forma={attivo ? "privato" : "chiuso"}>
                      {attivo ? "Online adesso" : "Non più online"}
                    </Stato>
                    <a
                      href={annuncio.canonicalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)] hover:text-[var(--lr-ink)]"
                    >
                      Vedi l&apos;annuncio
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <EmptyState
              title="Nessuno vende da solo, per quanto vediamo"
              description="Quando un annuncio di un privato combacia con una casa che seguiamo, compare qui con la sua storia."
            />
          </CardBody>
        </Card>
      )}

      <Meta className="px-1">
        Del venditore non conserviamo nome, telefono né email: il collegamento con la casa si fa
        solo su posizione e caratteristiche dell&apos;immobile.
      </Meta>
    </>
  );
}
