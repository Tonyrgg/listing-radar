import { CheckCircle2, MapPin, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { PendingSubmitButton } from "@/components/loading-controls";
import { PageHeader } from "@/components/page-header";
import {
  Dato,
  DatoAssente,
  Fonte,
  Giudizio,
  Movimento,
  Periodo,
  Stato,
  certaintyFromConfidence,
  formaFromAgencyState,
  formaFromPropertyState,
  livelloFromOpportunity,
} from "@/components/ui/atoms";
import { Card, CardBody, CardHeader, EmptyState, Label, Meta } from "@/components/ui/primitives";
import { getCurrentUser } from "@/lib/auth";
import { readNow } from "@/lib/clock";
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
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";
import type { LifecyclePropertyDetail } from "@/lib/property-lifecycle/read-models/types";

import {
  flagPropertyForLifecycleReview,
  recordAgencyOutcomeOverride,
  recordPropertySaleOverride,
} from "../../actions";
import { ExternalSourceLink, LifecycleUnavailable, ageDays } from "../../_components/ui";
import styles from "../../lifecycle.module.css";

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
  const vecchio = typeof payload.oldPrice === "number" ? payload.oldPrice : null;
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
    typeof payload.priorAgencyState === "string" ? payload.priorAgencyState : null;
  if (precedente) return <Meta>Prima era: {agencyListingStateLabel(precedente)}</Meta>;

  return null;
}

/** Le foto: la prima grande, le altre in fila. Una casa si riconosce così. */
function Foto({ urls, alt }: Readonly<{ urls: string[]; alt: string }>) {
  if (!urls.length) {
    return (
      <div className="grid aspect-[16/6] w-full place-items-center rounded-[var(--lr-radius-card)] bg-[var(--lr-raised)] px-6 text-center text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
        Di questa casa non abbiamo nessuna foto
      </div>
    );
  }

  const [prima, ...altre] = urls;

  return (
    <div className="space-y-2">
      <div
        role="img"
        aria-label={alt}
        className="aspect-[4/3] w-full rounded-[var(--lr-radius-card)] bg-[var(--lr-raised)] bg-cover bg-center"
        style={{ backgroundImage: `url("${prima}")` }}
      />
      {altre.length ? (
        <div className="flex gap-2">
          {altre.slice(0, 4).map((url, indice) => (
            <div
              key={url}
              role="img"
              aria-label={`${alt}, foto ${indice + 2}`}
              className="h-16 flex-1 rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)] bg-cover bg-center"
              style={{ backgroundImage: `url("${url}")` }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Un fatto della casa, con il suo grado di certezza. */
function Fatto({
  label,
  children,
}: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <p className="mt-0.5 text-[length:var(--lr-text-record)] text-[var(--lr-ink)]">{children}</p>
    </div>
  );
}

/**
 * Le prove, una per cosa affermata.
 *
 * Lo stesso indizio arriva a ogni passaggio del crawler: «Dove si trova» tre
 * volte, con la stessa origine e tre date. Di quel gruppo conta la più vecchia,
 * perché è quella che sposta indietro l'età reale di mercato.
 */
function proveDistinte(evidence: LifecyclePropertyDetail["evidence"]) {
  const migliori = new Map<string, LifecyclePropertyDetail["evidence"][number]>();

  for (const prova of evidence) {
    const chiave = `${prova.claimKey}|${prova.extractionMethod}`;
    const quando = prova.sourceRecordedAt ?? prova.observedAt;
    const gia = migliori.get(chiave);

    if (!gia || quando < (gia.sourceRecordedAt ?? gia.observedAt)) {
      migliori.set(chiave, prova);
    }
  }

  return [...migliori.values()].sort((a, b) =>
    (a.sourceRecordedAt ?? a.observedAt).localeCompare(b.sourceRecordedAt ?? b.observedAt),
  );
}

function ChiLaTiene({ detail }: Readonly<{ detail: LifecyclePropertyDetail }>) {
  const { property, publications, privatePublications } = detail;
  const niente =
    !property.agencies.length && !publications.length && !privatePublications.length;

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
        <div key={agency.listingId} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
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
        <div key={publication.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
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
        <div key={publication.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
          <Stato forma="privato">
            Annuncio di un privato su {getSourceLabel(publication.source)}
          </Stato>
          <Meta>
            <Dato certainty={certaintyFromConfidence(publication.identityScore)}>
              stessa casa {identityOutcomeLabel(publication.identityOutcome).toLocaleLowerCase("it")}
            </Dato>
          </Meta>
          <ExternalSourceLink href={publication.canonicalUrl} />
        </div>
      ))}
    </div>
  );
}

export default async function SchedaCasaPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  await connection();
  const { id } = await params;

  const [view, user, now] = await Promise.all([
    loadLifecycleView((repository) => repository.property(id)),
    getCurrentUser(),
    readNow(),
  ]);

  if (!view.available) return <LifecycleUnavailable message={view.message} />;
  if (!view.data) notFound();

  const detail = view.data;
  const property = detail.property;
  const giorniDiMercato = ageDays(property.trueMarketStartLowerBound, now);
  const agenziaAttiva = property.agencies.find((agency) => agency.state === "ACTIVE");
  const giorniInAgenzia = ageDays(agenziaAttiva?.firstSeenAt ?? null, now);
  const indirizzo = property.address ? formatShouty(property.address) : null;

  /* `rawText` è spesso il titolone dell'annuncio in stampatello: come posizione
   * si scrivono via, zona e comune, che è quello che si stava cercando. */
  const posizione = detail.location
    ? [
        ...new Set(
          [detail.location.streetName, detail.location.locality, detail.location.municipality]
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
        description={[property.locality, property.propertyType && humanize(property.propertyType)]
          .filter(Boolean)
          .join(" · ")}
        backHref="/listings"
        backLabel="Torna all'archivio"
        actions={
          <div className="flex flex-col items-end gap-1.5">
            <Stato forma={formaFromPropertyState(property.propertyState)}>
              {propertyStateLabel(property.propertyState)}
            </Stato>
            <Meta>{saleStatusLabel(property.saleStatus)}</Meta>
          </div>
        }
      />

      {/* Il colpo d'occhio: la foto e i pochi fatti che decidono. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Foto urls={detail.imageUrls} alt={indirizzo ?? formatShouty(property.title)} />

        <div className="space-y-5">
          <div>
            <Label>Prezzo richiesto oggi</Label>
            <p className="text-[length:var(--lr-text-page)] font-[650] leading-tight tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
              {formatCurrency(property.currentPrice)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Fatto label="Superficie">
              {property.surfaceSqm != null ? (
                `${formatNumber(property.surfaceSqm)} m²`
              ) : (
                <DatoAssente label="non dichiarata" />
              )}
            </Fatto>
            <Fatto label="Locali">
              {property.rooms != null ? (
                formatNumber(property.rooms)
              ) : (
                <DatoAssente label="non dichiarati" />
              )}
            </Fatto>
            <Fatto label="Sul mercato">
              {giorniDiMercato != null ? (
                <Periodo
                  from={`da almeno ${formatDays(giorniDiMercato)}`}
                  uncertain={(property.trueMarketStartConfidence ?? 0) < 0.85}
                  note={
                    property.trueMarketStartMethod
                      ? `Lo sappiamo ${extractionMethodLabel(property.trueMarketStartMethod)}`
                      : undefined
                  }
                />
              ) : (
                <DatoAssente label="da quando non si sa" />
              )}
            </Fatto>
            <Fatto label="Con questa agenzia">
              {giorniInAgenzia != null ? (
                `da ${formatDays(giorniInAgenzia)}`
              ) : (
                <DatoAssente label="nessun mandato attivo" />
              )}
            </Fatto>
          </div>

          {property.relaunchCount > 0 ? (
            <Meta>
              L&apos;annuncio è stato ripubblicato {formatNumber(property.relaunchCount)}{" "}
              {property.relaunchCount === 1 ? "volta" : "volte"}: sembra nuovo, ma la casa è sul
              mercato da prima.
            </Meta>
          ) : null}

          {/* Cosa ne pensiamo, e perché — mai il giudizio senza gli indizi. */}
          {/* Un giudizio che si regge solo sull'assenza di segnali non è un
            * giudizio: diceva «1 indizio su 4» accanto a «nessun segnale
            * commerciale attuale». */}
          {detail.opportunity && !hasNoRealSignal(detail.opportunity.reasons) ? (
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
        </div>
      </div>

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
                        <Dato certainty={certaintyFromConfidence(evidence.confidence)}>
                          {claimKeyLabel(evidence.claimKey)}
                        </Dato>
                      </span>
                      <Meta>
                        {formatDate(evidence.sourceRecordedAt ?? evidence.observedAt)},{" "}
                        {extractionMethodLabel(evidence.extractionMethod)}
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
              <form action={recordPropertySaleOverride} className={styles.manualForm}>
                <input type="hidden" name="propertyId" value={property.id} />
                <label className={styles.manualLabel}>
                  Questa casa è stata venduta?
                  <select
                    name="saleStatus"
                    defaultValue={property.saleStatus}
                    className={styles.select}
                  >
                    <option value="UNKNOWN">Non lo sappiamo</option>
                    <option value="SOLD_CONFIRMED">Sì, venduta</option>
                    <option value="NOT_SOLD_CONFIRMED">No, non venduta</option>
                  </select>
                </label>
                <label className={styles.manualLabel}>
                  Come lo sai?
                  <input
                    name="reason"
                    required
                    minLength={5}
                    placeholder="Es. me l'ha detto il proprietario al telefono"
                    className={styles.input}
                  />
                </label>
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
                <form action={recordAgencyOutcomeOverride} className={styles.manualForm}>
                  <input type="hidden" name="propertyId" value={property.id} />
                  <input
                    type="hidden"
                    name="agencyListingId"
                    value={property.agencies[0].listingId}
                  />
                  <label className={styles.manualLabel}>
                    Com&apos;è finita con {property.agencies[0].name}?
                    <select
                      name="agencyState"
                      defaultValue="CLOSED_WITHDRAWN"
                      className={styles.select}
                    >
                      <option value="CLOSED_WITHDRAWN">Il proprietario ha ritirato</option>
                      <option value="CLOSED_SWITCHED">È passata a un&apos;altra agenzia</option>
                      <option value="CLOSED_TO_PRIVATE">La vende da sé</option>
                      <option value="OFF_MARKET_NO_SALE_EVIDENCE">
                        Non è più in vendita, ma non risulta venduta
                      </option>
                    </select>
                  </label>
                  <label className={styles.manualLabel}>
                    Come lo sai?
                    <input
                      name="reason"
                      required
                      minLength={5}
                      placeholder="Da dove viene la conferma"
                      className={styles.input}
                    />
                  </label>
                  <PendingSubmitButton
                    type="submit"
                    pendingLabel="Registro"
                    icon={<CheckCircle2 aria-hidden="true" className="size-4" />}
                    className={styles.secondaryAction}
                  >
                    Registra
                  </PendingSubmitButton>
                </form>
              ) : (
                <div />
              )}

              <form action={flagPropertyForLifecycleReview} className={styles.manualForm}>
                <input type="hidden" name="propertyId" value={property.id} />
                <label className={styles.manualLabel}>
                  Qui c&apos;è qualcosa che non torna
                  <input
                    name="reason"
                    required
                    minLength={5}
                    placeholder="Cosa va controllato"
                    className={styles.input}
                  />
                </label>
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
