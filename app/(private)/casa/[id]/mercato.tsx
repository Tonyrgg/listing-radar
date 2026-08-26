import { CheckCircle2, MapPin, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ColpoDocchio } from "@/components/casa/colpo-docchio";
import { PageHeader } from "@/components/page-header";
import { PendingSubmitButton } from "@/components/loading-controls";
import {
  Dato,
  Fonte,
  Giudizio,
  Movimento,
  Stato,
  certaintyFromConfidence,
  formaFromAgencyState,
  formaFromPropertyState,
  livelloFromOpportunity,
} from "@/components/ui/atoms";
import {
  Campo,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Meta,
  Scelta,
  Testo,
} from "@/components/ui/primitives";
import { getCurrentUser } from "@/lib/auth";
import { getSourceLabel } from "@/lib/labels";
import {
  formatCurrency,
  formatDate,
  formatDays,
  formatNumber,
  formatShouty,
} from "@/lib/formatting";
import {
  agencyListingStateLabel,
  claimKeyLabel,
  extractionMethodLabel,
  hasNoRealSignal,
  humanize,
  identityOutcomeLabel,
  lifecycleEventLabel,
  locationPrecisionLabel,
  opportunityReasonLabel,
  propertyStateLabel,
  publicationStateLabel,
  saleStatusLabel,
} from "@/lib/property-lifecycle/read-models/presentation";
import type { LifecyclePropertyDetail } from "@/lib/property-lifecycle/read-models/types";

import {
  flagPropertyForLifecycleReview,
  recordAgencyOutcomeOverride,
  recordPropertySaleOverride,
} from "@/app/(private)/lifecycle/actions";
import {
  ExternalSourceLink,
  ageDays,
} from "@/app/(private)/lifecycle/_components/ui";
import styles from "@/app/(private)/lifecycle/lifecycle.module.css";

export const metadata: Metadata = { title: "Scheda della casa" };

/**
 * La scheda di una casa.
 *
 * Prima era un dossier: otto riquadri di numeri, tre navigazioni sovrapposte,
 * pillole con dentro `UNKNOWN` e una foto alta quanto lo schermo. Diceva tutto
 * e non rispondeva a niente.
 *
 * Ora risponde nell'ordine in cui uno se le fa, le domande: che casa è, chi la
 * vende e da quando, cosa le è successo, cosa ne pensiamo, e cosa di tutto
 * questo è davvero dimostrato.
 */

function riepilogoEvento(payload: Record<string, unknown>) {
  const vecchio =
    typeof payload.oldPrice === "number" ? payload.oldPrice : null;
  const nuovo = typeof payload.newPrice === "number" ? payload.newPrice : null;

  if (vecchio != null && nuovo != null) {
    const delta = nuovo - vecchio;
    return (
      <Movimento
        direction={delta === 0 ? "flat" : delta < 0 ? "down" : "up"}
        amount={`${delta < 0 ? "−" : "+"}${formatCurrency(Math.abs(delta))}`}
        since={`${formatCurrency(vecchio)} → ${formatCurrency(nuovo)}`}
      />
    );
  }

  const esito = typeof payload.outcome === "string" ? payload.outcome : null;
  if (esito) return <Meta>{humanize(esito)}</Meta>;

  const precedente =
    typeof payload.priorAgencyState === "string"
      ? payload.priorAgencyState
      : null;
  if (precedente)
    return <Meta>Prima era: {agencyListingStateLabel(precedente)}</Meta>;

  return null;
}



/**
 * Le prove, una per cosa affermata.
 *
 * Lo stesso indizio arriva a ogni passaggio del crawler: «Dove si trova» tre
 * volte, con la stessa origine e tre date. Di quel gruppo conta la più vecchia,
 * perché è quella che sposta indietro l'età reale di mercato.
 */
function proveDistinte(evidence: LifecyclePropertyDetail["evidence"]) {
  const migliori = new Map<
    string,
    LifecyclePropertyDetail["evidence"][number]
  >();

  for (const prova of evidence) {
    const chiave = `${prova.claimKey}|${prova.extractionMethod}`;
    const quando = prova.sourceRecordedAt ?? prova.observedAt;
    const gia = migliori.get(chiave);

    if (!gia || quando < (gia.sourceRecordedAt ?? gia.observedAt)) {
      migliori.set(chiave, prova);
    }
  }

  return [...migliori.values()].sort((a, b) =>
    (a.sourceRecordedAt ?? a.observedAt).localeCompare(
      b.sourceRecordedAt ?? b.observedAt,
    ),
  );
}

function ChiLaTiene({ detail }: Readonly<{ detail: LifecyclePropertyDetail }>) {
  const { property, publications, privatePublications } = detail;
  const niente =
    !property.agencies.length &&
    !publications.length &&
    !privatePublications.length;

  if (niente) {
    return (
      <EmptyState
        title="Nessuno la sta vendendo, per quanto vediamo"
        description="Non risulta nessun mandato né annuncio attivo su questa casa."
      />
    );
  }

  return (
    <div className="divide-y divide-[var(--lr-line-quiet)]">
      {property.agencies.map((agency) => (
        <div
          key={agency.listingId}
          className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3"
        >
          <Link
            href={`/lifecycle/agencies/${agency.slug}`}
            className="text-[length:var(--lr-text-record)] font-[650] text-[var(--lr-ink)] hover:underline"
          >
            {formatShouty(agency.name)}
          </Link>
          <Stato forma={formaFromAgencyState(agency.state)}>
            {agencyListingStateLabel(agency.state)}
          </Stato>
          <Meta>
            dal {formatDate(agency.firstSeenAt)}, vista l&apos;ultima volta il{" "}
            {formatDate(agency.lastSeenAt)}
            {agency.reference ? ` · rif. ${agency.reference}` : ""}
          </Meta>
        </div>
      ))}

      {publications.map((publication) => (
        <div
          key={publication.id}
          className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3"
        >
          <Fonte
            name={formatShouty(publication.agencyName)}
            note={`Annuncio su ${getSourceLabel(publication.sourceKey)}`}
          />
          <Meta>{publicationStateLabel(publication.state)}</Meta>
          <Meta>dal {formatDate(publication.firstSeenAt)}</Meta>
          <ExternalSourceLink href={publication.canonicalUrl} />
        </div>
      ))}

      {privatePublications.map((publication) => (
        <div
          key={publication.id}
          className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3"
        >
          <Stato forma="privato">
            Annuncio di un privato su {getSourceLabel(publication.source)}
          </Stato>
          <Meta>
            <Dato
              certainty={certaintyFromConfidence(publication.identityScore)}
            >
              stessa casa{" "}
              {identityOutcomeLabel(
                publication.identityOutcome,
              ).toLocaleLowerCase("it")}
            </Dato>
          </Meta>
          <ExternalSourceLink href={publication.canonicalUrl} />
        </div>
      ))}
    </div>
  );
}

/**
 * La scheda di una casa che osserviamo sul mercato.
 *
 * Non è più una pagina: la pagina è `/casa/[id]`, e decide se la casa la
 * tengono gli altri o la teniamo noi. Qui resta quello che si può dire di una
 * casa che guardiamo da fuori — chi la vende, cosa le è successo, cosa
 * sappiamo davvero.
 */
export function SchedaMercato({
  detail,
  user,
  now,
}: Readonly<{
  detail: LifecyclePropertyDetail;
  user: Awaited<ReturnType<typeof getCurrentUser>>;
  now: number;
}>) {
  const property = detail.property;
  const giorniDiMercato = ageDays(property.trueMarketStartLowerBound, now);
  const agenziaAttiva = property.agencies.find(
    (agency) => agency.state === "ACTIVE",
  );
  const giorniInAgenzia = ageDays(agenziaAttiva?.firstSeenAt ?? null, now);
  const indirizzo = property.address ? formatShouty(property.address) : null;

  /* `rawText` è spesso il titolone dell'annuncio in stampatello: come posizione
   * si scrivono via, zona e comune, che è quello che si stava cercando. */
  const posizione = detail.location
    ? [
        ...new Set(
          [
            detail.location.streetName,
            detail.location.locality,
            detail.location.municipality,
          ]
            .filter(Boolean)
            .map((parte) => formatShouty(String(parte))),
        ),
      ].join(" · ")
    : null;
  const prove = proveDistinte(detail.evidence);

  return (
    <>
      <PageHeader
        eyebrow="La casa"
        title={indirizzo ?? formatShouty(property.title)}
        description={[
          "La tiene qualcun altro: la osserviamo",
          property.locality,
          property.propertyType && humanize(property.propertyType),
        ]
          .filter(Boolean)
          .join(" · ")}
        backHref="/listings"
        backLabel="Torna all'archivio"
      />

      <ColpoDocchio
        casa={{
          indirizzo: indirizzo ?? formatShouty(property.title),
          contratto: propertyStateLabel(property.propertyState),
          prezzo: property.currentPrice,
          prezzoEtichetta: "Prezzo richiesto oggi",
          mq: property.surfaceSqm,
          locali: property.rooms,
          piano: null,
          foto: detail.imageUrls,
          statoTesto: saleStatusLabel(property.saleStatus),
          statoForma: formaFromPropertyState(property.propertyState),
          giorniSulMercato: giorniDiMercato,
          giorniIncerti: (property.trueMarketStartConfidence ?? 0) < 0.85,
          notaGiorni: property.trueMarketStartMethod
            ? `Lo sappiamo ${extractionMethodLabel(property.trueMarketStartMethod)}`
            : undefined,
        }}
      >
          {giorniInAgenzia != null ? (
            <Meta>Con questa agenzia da {formatDays(giorniInAgenzia)}.</Meta>
          ) : null}

          {property.relaunchCount > 0 ? (
            <Meta>
              L&apos;annuncio è stato ripubblicato{" "}
              {formatNumber(property.relaunchCount)}{" "}
              {property.relaunchCount === 1 ? "volta" : "volte"}: sembra nuovo,
              ma la casa è sul mercato da prima.
            </Meta>
          ) : null}

          {/* Cosa ne pensiamo, e perché — mai il giudizio senza gli indizi.
            * Un giudizio che si regge solo sull'assenza di segnali non è un
            * giudizio: diceva «1 indizio su 4» accanto a «nessun segnale
            * commerciale attuale». */}
          {detail.opportunity &&
          !hasNoRealSignal(detail.opportunity.reasons) ? (
            <Card>
              <CardBody className="space-y-3">
                <Giudizio
                  livello={livelloFromOpportunity(detail.opportunity.level)}
                  signals={detail.opportunity.reasons.length}
                  total={Math.max(detail.opportunity.reasons.length, 4)}
                />
                <ul className="space-y-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
                  {detail.opportunity.reasons.map((reason) => (
                    <li key={reason}>{opportunityReasonLabel(reason)}</li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          {detail.location ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
              <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
              <Dato
                certainty={certaintyFromConfidence(detail.location.confidence, {
                  manuallyVerified: detail.location.manuallyVerified,
                })}
              >
                {posizione || indirizzo || "posizione parziale"}
              </Dato>
              <span>· {locationPrecisionLabel(detail.location.precision)}</span>
            </p>
          ) : null}
      </ColpoDocchio>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
        {/* Cosa le è successo, dal più recente. */}
        <Card>
          <CardHeader
            title="Cosa le è successo"
            meta="Ogni riga è un fatto osservato, non una nostra opinione."
          />
          <CardBody>
            {detail.events.length ? (
              <ol className="divide-y divide-[var(--lr-line-quiet)]">
                {detail.events.map((event) => (
                  <li key={event.id} className="flex gap-4 py-3">
                    <time
                      dateTime={event.occurredAt}
                      className="w-24 shrink-0 pt-0.5 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]"
                    >
                      {formatDate(event.occurredAt)}
                    </time>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
                        <Dato
                          certainty={certaintyFromConfidence(event.confidence, {
                            manuallyVerified: event.actorType === "USER",
                          })}
                          hint={
                            event.actorType === "USER"
                              ? "Registrato da una persona"
                              : undefined
                          }
                        >
                          {lifecycleEventLabel(event.eventType)}
                        </Dato>
                      </p>
                      {riepilogoEvento(event.payload)}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                title="Non le è ancora successo niente"
                description="La casa è appena entrata nell'archivio: i movimenti compariranno qui."
              />
            )}
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Chi la vende"
              meta="Mandati e annunci, con il periodo in cui li abbiamo visti."
            />
            <CardBody>
              <ChiLaTiene detail={detail} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Cosa sappiamo davvero"
              meta="Il tratteggio è nostro: la fonte non lo dichiarava."
            />
            <CardBody>
              {prove.length ? (
                <div className="divide-y divide-[var(--lr-line-quiet)]">
                  {prove.map((evidence) => (
                    <div
                      key={evidence.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
                    >
                      <span className="text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
                        <Dato
                          certainty={certaintyFromConfidence(
                            evidence.confidence,
                          )}
                        >
                          {claimKeyLabel(evidence.claimKey)}
                        </Dato>
                      </span>
                      <Meta>
                        {formatDate(
                          evidence.sourceRecordedAt ?? evidence.observedAt,
                        )}
                        , {extractionMethodLabel(evidence.extractionMethod)}
                      </Meta>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Nessuna prova allegata"
                  description="Quello che leggi qui sopra viene dall'ultimo annuncio, senza una prova conservata."
                />
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Le correzioni restano in fondo: si guarda prima, si decide dopo. */}
      <Card>
        <CardHeader
          title="Correggi quello che sappiamo"
          meta="Ogni correzione resta scritta con il tuo nome, la data e il motivo. Quello che confermi non viene più sovrascritto da solo."
        />
        <CardBody>
          {user ? (
            <div className="grid gap-5 lg:grid-cols-3">
              <form
                action={recordPropertySaleOverride}
                className={styles.manualForm}
              >
                <input type="hidden" name="propertyId" value={property.id} />
                <Campo label="Questa casa è stata venduta?">
                  <Scelta name="saleStatus" defaultValue={property.saleStatus}>
                    <option value="UNKNOWN">Non lo sappiamo</option>
                    <option value="SOLD_CONFIRMED">Sì, venduta</option>
                    <option value="NOT_SOLD_CONFIRMED">No, non venduta</option>
                  </Scelta>
                </Campo>
                <Campo label="Come lo sai?">
                  <Testo
                    name="reason"
                    required
                    minLength={5}
                    placeholder="Es. me l'ha detto il proprietario al telefono"
                  />
                </Campo>
                <PendingSubmitButton
                  type="submit"
                  pendingLabel="Registro"
                  icon={<ShieldCheck aria-hidden="true" className="size-4" />}
                  className={styles.primaryAction}
                >
                  Registra
                </PendingSubmitButton>
              </form>

              {property.agencies[0] ? (
                <form
                  action={recordAgencyOutcomeOverride}
                  className={styles.manualForm}
                >
                  <input type="hidden" name="propertyId" value={property.id} />
                  <input
                    type="hidden"
                    name="agencyListingId"
                    value={property.agencies[0].listingId}
                  />
                  <Campo
                    label={`Com'è finita con ${formatShouty(property.agencies[0].name)}?`}
                  >
                    <Scelta name="agencyState" defaultValue="CLOSED_WITHDRAWN">
                      <option value="CLOSED_WITHDRAWN">
                        Il proprietario ha ritirato
                      </option>
                      <option value="CLOSED_SWITCHED">
                        È passata a un&apos;altra agenzia
                      </option>
                      <option value="CLOSED_TO_PRIVATE">La vende da sé</option>
                      <option value="OFF_MARKET_NO_SALE_EVIDENCE">
                        Non è più in vendita, ma non risulta venduta
                      </option>
                    </Scelta>
                  </Campo>
                  <Campo label="Come lo sai?">
                    <Testo
                      name="reason"
                      required
                      minLength={5}
                      placeholder="Da dove viene la conferma"
                    />
                  </Campo>
                  <PendingSubmitButton
                    type="submit"
                    pendingLabel="Registro"
                    icon={
                      <CheckCircle2 aria-hidden="true" className="size-4" />
                    }
                    className={styles.secondaryAction}
                  >
                    Registra
                  </PendingSubmitButton>
                </form>
              ) : (
                <div />
              )}

              <form
                action={flagPropertyForLifecycleReview}
                className={styles.manualForm}
              >
                <input type="hidden" name="propertyId" value={property.id} />
                <Campo label="Qui c'è qualcosa che non torna">
                  <Testo
                    name="reason"
                    required
                    minLength={5}
                    placeholder="Cosa va controllato"
                  />
                </Campo>
                <PendingSubmitButton
                  type="submit"
                  pendingLabel="Apro la verifica"
                  className={styles.secondaryAction}
                >
                  Mettila fra le cose da decidere
                </PendingSubmitButton>
              </form>
            </div>
          ) : (
            <EmptyState
              title="Per correggere serve essere riconosciuti"
              description="Ogni correzione porta un nome e una data: finché non c'è un utente, la scheda resta in sola lettura."
            />
          )}
        </CardBody>
      </Card>
    </>
  );
}
