import { ArrowLeft, CheckCircle2, FileCheck2, MapPin, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { MappaDellaCasa } from "@/components/casa/mappa-della-casa";
import { RigaDiVita } from "@/components/casa/riga-di-vita";
import { PendingSubmitButton } from "@/components/loading-controls";
import {
  Dato,
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
  Label,
  Meta,
  Scelta,
  Testo,
  buttonClass,
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
  extractionMethodLabel,
  hasNoRealSignal,
  humanize,
  identityOutcomeLabel,
  locationPrecisionLabel,
  opportunityReasonLabel,
  publicationStateLabel,
  saleStatusLabel,
} from "@/lib/property-lifecycle/read-models/presentation";
import { formaPosizione } from "@/lib/map/posizione-casa";
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
 * La scheda di una casa che osserviamo.
 *
 * Prima era un dossier: otto riquadri di numeri, tre navigazioni sovrapposte e
 * una foto alta quanto lo schermo. Diceva tutto e non rispondeva a niente.
 *
 * Adesso l'ordine è quello delle domande vere. In alto chi è e cosa ci si fa
 * adesso — la decisione, con gli indizi che la reggono. Sotto, a sinistra, le
 * prove nel tempo: le foto e la riga di vita. A destra i numeri fermi: prezzo,
 * misure, chi la vende, dove sta. Le correzioni in fondo, perché si guarda
 * prima e si decide dopo.
 */

/** Cosa farci, adesso. Non è un punteggio: è un verbo. */
const AZIONE = {
  alta: "Da chiamare",
  media: "Da tenere d'occhio",
  bassa: "Nessuna urgenza",
} as const;

/** I metodi che datano la casa guardando le foto, non l'annuncio. */
function dataDallaFoto(method: string | null) {
  return Boolean(method) && /IMAGE_FILENAME|MEDIA_LAST_MODIFIED|UPLOAD_PATH/.test(method!);
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

/** Il primo prezzo che le abbiamo visto, letto all'indietro nei ribassi. */
function primoPrezzo(eventi: LifecyclePropertyDetail["events"]) {
  const conPrezzo = eventi
    .filter((evento) => typeof evento.payload.oldPrice === "number")
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return conPrezzo.length ? (conPrezzo[0].payload.oldPrice as number) : null;
}

/** Un numero fermo, con la sua etichetta. La griglia non cambia mai posto. */
function Misura({
  label,
  children,
  nota,
}: Readonly<{ label: string; children: React.ReactNode; nota?: string }>) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <p className="mt-0.5 text-[length:var(--lr-text-record)] text-[var(--lr-ink)]">
        {children}
      </p>
      {nota ? (
        <p className="mt-1 text-[length:var(--lr-text-meta)] leading-snug text-[var(--lr-ink-3)]">
          {nota}
        </p>
      ) : null}
    </div>
  );
}

/** Le foto: una grande e la fila delle altre, senza mangiarsi la pagina. */
function MuroDiFoto({
  urls,
  alt,
  didascalia,
}: Readonly<{ urls: readonly string[]; alt: string; didascalia?: string }>) {
  if (!urls.length) {
    return (
      <div className="grid aspect-[16/9] w-full place-items-center rounded-[var(--lr-radius-container)] border border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] px-6 text-center text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
        Di questa casa non abbiamo nessuna foto
      </div>
    );
  }

  const [prima, ...altre] = urls;
  const miniature = altre.slice(0, 3);
  const restanti = altre.length - miniature.length;

  return (
    <div className="space-y-2">
      <div
        role="img"
        aria-label={alt}
        className="relative aspect-[16/9] w-full overflow-hidden rounded-[var(--lr-radius-container)] border border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] bg-cover bg-center"
        style={{ backgroundImage: `url("${prima}")` }}
      >
        {didascalia ? (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-[var(--lr-radius-pill)] border border-[var(--lr-line)] bg-[var(--lr-surface)]/95 px-2.5 py-1 text-[length:var(--lr-text-label)] font-medium text-[var(--lr-ink-2)]">
            {didascalia}
          </span>
        ) : null}
      </div>

      {miniature.length ? (
        <div className="grid grid-cols-4 gap-2">
          {miniature.map((url, indice) => (
            <span
              key={url}
              role="img"
              aria-label={`${alt}, foto ${indice + 2}`}
              className="block aspect-[4/3] overflow-hidden rounded-[var(--lr-radius-control)] border border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] bg-cover bg-center"
              style={{ backgroundImage: `url("${url}")` }}
            />
          ))}
          {restanti > 0 ? (
            <span className="grid aspect-[4/3] place-items-center rounded-[var(--lr-radius-control)] border border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]">
              +{formatNumber(restanti)} foto
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
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
    <div className="space-y-3">
      {property.agencies.map((agency) => (
        <div
          key={agency.listingId}
          className="rounded-[var(--lr-radius-control)] border border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] p-3"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link
              href={`/lifecycle/agencies/${agency.slug}`}
              className="text-[length:var(--lr-text-record)] font-[650] text-[var(--lr-ink)] hover:underline"
            >
              {formatShouty(agency.name)}
            </Link>
            <Stato forma={formaFromAgencyState(agency.state)}>
              {agencyListingStateLabel(agency.state)}
            </Stato>
          </div>
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
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
        >
          <span className="text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
            {formatShouty(publication.agencyName)}
          </span>
          <Meta>
            annuncio su {getSourceLabel(publication.sourceKey)} ·{" "}
            {publicationStateLabel(publication.state)} · dal{" "}
            {formatDate(publication.firstSeenAt)}
          </Meta>
          <ExternalSourceLink href={publication.canonicalUrl} />
        </div>
      ))}

      {privatePublications.map((publication) => (
        <div
          key={publication.id}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
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
  const indirizzo = property.address
    ? formatShouty(property.address)
    : formatShouty(property.title);

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
  const dove = posizione || property.locality || null;
  const prove = proveDistinte(detail.evidence);
  const prezzoIniziale = primoPrezzo(detail.events);
  const scarto =
    prezzoIniziale != null && property.currentPrice != null
      ? property.currentPrice - prezzoIniziale
      : null;
  const euroAlMq =
    property.currentPrice != null && property.surfaceSqm
      ? Math.round(property.currentPrice / property.surfaceSqm)
      : null;
  const indizi =
    detail.opportunity && !hasNoRealSignal(detail.opportunity.reasons)
      ? detail.opportunity.reasons
      : [];
  const azione = detail.opportunity
    ? AZIONE[livelloFromOpportunity(detail.opportunity.level)]
    : null;
  const forma = formaPosizione(detail.location);

  return (
    <div className="space-y-4">
      {/* Dove sei e come si torna indietro: una riga sola, poi la casa. */}
      <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
        <Link
          href="/listings"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-[var(--lr-ink)]"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Archivio
        </Link>
        {dove ? (
          <>
            <span aria-hidden="true">/</span>
            <span className="text-[var(--lr-ink-2)]">{dove}</span>
          </>
        ) : null}
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-[length:var(--lr-text-section)] font-[650] leading-tight tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
              {indirizzo}
            </h1>
            <Stato forma={formaFromPropertyState(property.propertyState)}>
              La tiene un&apos;agenzia · la osserviamo
            </Stato>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
            {[
              property.propertyType ? humanize(property.propertyType) : null,
              dove,
              detail.location
                ? locationPrecisionLabel(detail.location.precision)
                : null,
            ]
              .filter(Boolean)
              .map((pezzo, indice) => (
                <span key={pezzo as string}>
                  {indice ? "· " : ""}
                  {pezzo}
                </span>
              ))}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {detail.publications[0]?.canonicalUrl ? (
            <a
              href={detail.publications[0].canonicalUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonClass("secondary", { compact: true })}
            >
              Annuncio
            </a>
          ) : null}
          <a
            href="#correggi"
            className={buttonClass("secondary", { compact: true })}
          >
            <FileCheck2 aria-hidden="true" className="size-4" />
            Correggi
          </a>
        </div>
      </header>

      {/* Cosa fare adesso, con gli indizi che lo reggono. Mai il giudizio da
        * solo: un giudizio senza gli indizi è un'opinione. */}
      {azione && indizi.length ? (
        <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)] px-4 py-3">
          <div className="min-w-0 shrink-0">
            <Label>Cosa fare adesso</Label>
            <p className="text-[length:var(--lr-text-record)] font-[650] leading-tight text-[var(--lr-ink)]">
              {azione}
            </p>
            <p className="mt-0.5 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
              {formatNumber(indizi.length)}{" "}
              {indizi.length === 1 ? "indizio" : "indizi"} su{" "}
              {formatNumber(Math.max(indizi.length, 4))}
            </p>
          </div>

          <ul className="flex min-w-0 flex-wrap gap-1.5">
            {indizi.map((reason) => (
              <li
                key={reason}
                className="inline-flex min-h-8 items-center rounded-[var(--lr-radius-pill)] border border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] px-3 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]"
              >
                {opportunityReasonLabel(reason)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-4">
          <MuroDiFoto
            urls={detail.imageUrls}
            alt={indirizzo}
            didascalia={
              dataDallaFoto(property.trueMarketStartMethod) &&
              property.trueMarketStartLowerBound
                ? `foto del ${formatDate(property.trueMarketStartLowerBound)} — la più vecchia che abbiamo`
                : undefined
            }
          />

          <RigaDiVita eventi={detail.events} prove={prove} />
        </div>

        <div className="space-y-4">
          <Card>
            <CardBody className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-[var(--lr-line-quiet)] pb-4">
                <div className="min-w-0">
                  <Label>Prezzo richiesto oggi</Label>
                  <p className="text-[length:var(--lr-text-page)] font-[650] leading-tight tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
                    {formatCurrency(property.currentPrice)}
                  </p>
                  {scarto || euroAlMq ? (
                    <p className="mt-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                      {scarto
                        ? `${scarto < 0 ? "↓ −" : "↑ +"}${formatCurrency(Math.abs(scarto))} dal primo prezzo`
                        : null}
                      {scarto && euroAlMq ? " · " : null}
                      {euroAlMq ? `${formatNumber(euroAlMq)} €/m²` : null}
                    </p>
                  ) : null}
                </div>
                <Stato forma={formaFromPropertyState(property.propertyState)}>
                  {saleStatusLabel(property.saleStatus)}
                </Stato>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                <Misura label="Superficie">
                  {property.surfaceSqm != null
                    ? `${formatNumber(property.surfaceSqm)} m²`
                    : "non dichiarata"}
                </Misura>
                <Misura label="Locali">
                  {property.rooms != null
                    ? formatNumber(property.rooms)
                    : "non dichiarati"}
                </Misura>
                <Misura label="Ripubblicazioni">
                  {formatNumber(property.relaunchCount)}
                </Misura>
                <Misura label="Con questa agenzia">
                  {giorniInAgenzia != null ? formatDays(giorniInAgenzia) : "—"}
                </Misura>
                <div className="col-span-2">
                  <Misura
                    label="Sul mercato"
                    nota={
                      property.trueMarketStartMethod
                        ? `Lo sappiamo ${extractionMethodLabel(property.trueMarketStartMethod)}.`
                        : undefined
                    }
                  >
                    {giorniDiMercato != null ? (
                      <Dato
                        certainty={certaintyFromConfidence(
                          property.trueMarketStartConfidence,
                        )}
                      >
                        da almeno {formatDays(giorniDiMercato)}
                      </Dato>
                    ) : (
                      "non lo sappiamo"
                    )}
                  </Misura>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Chi la vende"
              meta={`${formatNumber(property.agencies.length)} ${property.agencies.length === 1 ? "mandato" : "mandati"} · ${property.activePrivateCount ? `${formatNumber(property.activePrivateCount)} privato` : "nessun privato"}`}
            />
            <CardBody>
              <ChiLaTiene detail={detail} />
            </CardBody>
          </Card>

          {/* La mappa entra solo se abbiamo qualcosa da mostrarci: lo spillo
            * dove la casa la conosciamo, l'area quando sappiamo la via e non il
            * civico. Se non sappiamo dov'è, la scheda non compare: un riquadro
            * che dice «posizione ignota» occupa spazio per dire niente. */}
          {detail.location && forma !== "niente" ? (
            <Card>
              <CardHeader
                title="Dove si trova"
                meta={locationPrecisionLabel(detail.location.precision)}
              />
              <CardBody className="space-y-2">
                <MappaDellaCasa
                  posizione={detail.location}
                  etichetta={indirizzo}
                />
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                  <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                  <Dato
                    certainty={certaintyFromConfidence(
                      detail.location.confidence,
                      { manuallyVerified: detail.location.manuallyVerified },
                    )}
                  >
                    {dove ?? "posizione parziale"}
                  </Dato>
                  {forma === "area" ? (
                    <span>· la casa sta in quest&apos;area, non nel centro del cerchio</span>
                  ) : null}
                </p>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      {/* Le correzioni restano in fondo: si guarda prima, si decide dopo. */}
      <Card id="correggi">
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
    </div>
  );
}
