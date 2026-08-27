import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, getSellerTypeTone, getStatusTone } from "@/components/badge";
import {
  LoadingAnchor,
  PendingSubmitButton,
} from "@/components/loading-controls";
import { ListingCompletenessPopover } from "@/components/listing-completeness-popover";
import { ListingPhotoGallery } from "@/components/listing-photo-gallery";
import { ListingScoreBreakdown } from "@/components/listing-score";
import { buttonClass } from "@/components/ui/primitives";
import { getDuplicateListings, getListingById } from "@/lib/data/repository";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPlainText,
  isUsableText,
} from "@/lib/formatting";
import {
  getListingCrmStatusLabel,
  getListingStatusLabel,
  getSellerTypeLabel,
  getSourceLabel,
} from "@/lib/labels";
import {
  getListingCompletenessScore,
  getMissingListingFields,
} from "@/lib/listings/completeness";
import { getOperationalSuggestion } from "@/lib/listings/operational";
import {
  archiveListing,
  restoreListing,
  updateListing,
  updateListingCrmStatus,
} from "@/app/(private)/listings/[id]/actions";
import { LISTING_STATUS_OPTIONS } from "@/lib/constants";
import { getPersistedScoringConfig } from "@/lib/settings/scoring-config-repository";

export const metadata: Metadata = {
  title: "Scheda annuncio",
};

function DetailItem({
  label,
  value,
  tone = "default",
}: Readonly<{
  label: string;
  value: string;
  tone?: "default" | "warning";
}>) {
  const isUnavailable = tone === "warning" || value === "Non disponibile";

  return (
    <div
      className={
        isUnavailable
          ? "rounded-[var(--lr-radius-control)] border border-[var(--lr-warn)] bg-[var(--lr-warn-soft)] px-3 py-2"
          : undefined
      }
    >
      <dt
        className={
          isUnavailable
            ? "text-[length:var(--lr-text-meta)] font-medium text-[var(--lr-warn)]"
            : "text-[length:var(--lr-text-meta)] font-medium text-[var(--lr-ink-3)]"
        }
      >
        {label}
      </dt>
      <dd className="mt-1 text-[length:var(--lr-text-body)] font-semibold leading-6 text-[var(--lr-ink)]">
        {value}
      </dd>
    </div>
  );
}

function formatMissingFieldsReviewLabel(count: number) {
  return count === 1 ? "1 campo da rivedere" : `${formatNumber(count)} campi da rivedere`;
}

function SummaryMetric({
  label,
  value,
  detail,
  tone = "default",
}: Readonly<{
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: "default" | "warning";
}>) {
  return (
    <div
      className={
        tone === "warning"
          ? "rounded-[var(--lr-radius-control)] border border-[var(--lr-warn)] bg-[var(--lr-warn-soft)] px-4 py-3"
          : "rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-raised)] px-4 py-3"
      }
    >
      <p className="text-[length:var(--lr-text-label)] font-semibold uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
        {label}
      </p>
      <p className="mt-2 truncate text-[length:var(--lr-text-section)] font-semibold leading-none text-[var(--lr-ink)]">
        {value}
      </p>
      {detail ? (
        <div
          className={
            tone === "warning"
              ? "mt-1 min-w-0 text-[length:var(--lr-text-meta)] text-[var(--lr-warn)]"
              : "mt-1 min-w-0 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]"
          }
        >
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function CrmStatusMetric({
  listingId,
  crmStatus,
}: Readonly<{
  listingId: string;
  crmStatus: "untreated" | "treated";
}>) {
  const isTreated = crmStatus === "treated";
  const toggleCrmStatus = updateListingCrmStatus.bind(
    null,
    listingId,
    isTreated ? "untreated" : "treated",
  );

  return (
    <form action={toggleCrmStatus}>
      <PendingSubmitButton
        type="submit"
        pendingLabel="Aggiorno CRM"
        className={
          isTreated
            ? "block w-full cursor-pointer rounded-[var(--lr-radius-control)] border border-[var(--lr-accent)] bg-[var(--lr-accent-soft)] px-4 py-3 text-left transition-colors hover:bg-[var(--lr-raised)]"
            : "block w-full cursor-pointer rounded-[var(--lr-radius-control)] border border-[var(--lr-danger)] bg-[var(--lr-danger-soft)] px-4 py-3 text-left transition-colors hover:bg-[var(--lr-danger-soft)]"
        }
      >
        <span className="block text-[length:var(--lr-text-label)] font-semibold uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
          CRM
        </span>
        <span className="mt-2 block truncate text-[length:var(--lr-text-section)] font-semibold leading-none text-[var(--lr-ink)]">
          {getListingCrmStatusLabel(crmStatus)}
        </span>
        <span className="mt-1 block truncate text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]">
          Clicca per segnare {isTreated ? "non trattato" : "trattato"}
        </span>
      </PendingSubmitButton>
    </form>
  );
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await getListingById(id);

  if (!listing) {
    notFound();
  }

  const [duplicateListings, scoringConfig] = await Promise.all([
    getDuplicateListings(listing),
    getPersistedScoringConfig(),
  ]);
  const priceHistory = (listing.snapshots ?? [])
    .filter((snapshot) => snapshot.price != null)
    .filter(
      (snapshot, index, values) =>
        index === values.length - 1 || snapshot.price !== values[index + 1]?.price,
    );
  const operationalSuggestion = getOperationalSuggestion(listing);
  const missingFields = getMissingListingFields(listing);
  const completenessScore = getListingCompletenessScore(listing);
  const hasMissingFields = missingFields.length > 0;
  const missingFieldsReviewLabel = formatMissingFieldsReviewLabel(
    missingFields.length,
  );
  const updateAction = updateListing.bind(null, listing.id);
  const archiveAction = archiveListing.bind(null, listing.id);
  const restoreAction = restoreListing.bind(null, listing.id);

  return (
    <div className="space-y-6">
      <Link
        href="/listings"
        className="inline-flex min-h-11 items-center text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink-2)] transition-colors hover:text-[var(--lr-ink)]"
      >
        Torna all&apos;archivio
      </Link>

      <section className="rounded-lg border border-[var(--lr-line)] bg-[var(--lr-surface)]">
        <div className="grid gap-5 p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={getSellerTypeTone(listing.sellerType)}>
                {getSellerTypeLabel(listing.sellerType)}
              </Badge>
              <Badge tone={getStatusTone(listing.status)}>
                {getListingStatusLabel(listing.status)}
              </Badge>
              {listing.isPriceDropped ? <Badge tone="red">Prezzo ridotto</Badge> : null}
              {listing.duplicateGroupId ? (
                <Badge tone="amber">Possibile duplicato</Badge>
              ) : null}
              {listing.status === "archived" ? (
                <form action={restoreAction}>
                  <PendingSubmitButton
                    type="submit"
                    pendingLabel="Ripristino"
                    className={buttonClass("secondary", { compact: true })}
                  >
                    Rimetti nell&apos;archivio attivo
                  </PendingSubmitButton>
                </form>
              ) : null}
            </div>

            <p className="mt-5 text-[length:var(--lr-text-meta)] font-semibold uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
              {getSourceLabel(listing.source)}
            </p>
            <h1 className="mt-2 max-w-5xl text-[length:var(--lr-text-page)] font-semibold leading-tight text-[var(--lr-ink)]">
              {listing.title}
            </h1>
            <p className="mt-4 max-w-3xl text-[length:var(--lr-text-body)] leading-6 text-[var(--lr-ink-2)]">
              {operationalSuggestion}
            </p>
          </div>

          <div className="grid content-start gap-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryMetric
                label="Prezzo"
                value={formatCurrency(listing.price)}
                tone={listing.price == null ? "warning" : "default"}
                detail={
                  listing.pricePerSqm != null
                    ? `${formatCurrency(listing.pricePerSqm)} al mq`
                    : undefined
                }
              />
              <SummaryMetric
                label="Appetibilità"
                value={`${formatNumber(listing.priorityScore)} pt`}
                detail="Priorità di controllo"
              />
              <SummaryMetric
                label="Completezza"
                value={`${completenessScore}%`}
                tone={hasMissingFields ? "warning" : "default"}
                detail={
                  hasMissingFields ? (
                    <ListingCompletenessPopover
                      score={completenessScore}
                      fields={missingFields}
                      triggerLabel={missingFieldsReviewLabel}
                    />
                  ) : (
                    "Scheda completa"
                  )
                }
              />
              <CrmStatusMetric
                listingId={listing.id}
                crmStatus={listing.crmStatus}
              />
            </div>

            <dl className="grid gap-3 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-raised)] p-4 sm:grid-cols-4">
              <DetailItem
                label="Superficie"
                tone={listing.sqm == null ? "warning" : "default"}
                value={
                  listing.sqm != null
                    ? `${formatNumber(listing.sqm)} mq`
                    : "Non disponibile"
                }
              />
              <DetailItem
                label="Locali e piano"
                tone={listing.rooms == null ? "warning" : "default"}
                value={[
                  listing.rooms != null
                    ? `${formatNumber(listing.rooms)} locali`
                    : null,
                  listing.floor,
                ]
                  .filter(Boolean)
                  .join(", ") || "Non disponibile"}
              />
              {/* Una «zona» lunga un paragrafo è un pezzo di pagina finito nel
                * campo sbagliato: meglio dire che manca, che spacciarla per
                * un'informazione. */}
              <DetailItem
                label="Zona"
                tone={isUsableText(listing.zone, { maxLength: 60 }) ? "default" : "warning"}
                value={
                  isUsableText(listing.zone, { maxLength: 60 })
                    ? formatPlainText(listing.zone)
                    : "Non letta dal portale"
                }
              />
              <DetailItem
                label="Online"
                value={`${formatNumber(listing.minimumDaysOnline)} giorni`}
              />
            </dl>
          </div>
        </div>

        <LoadingAnchor
          href={listing.url}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-12 items-center justify-center gap-2 border-t border-[var(--lr-line-quiet)] px-5 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-accent)] transition-colors hover:bg-[var(--lr-raised)]"
          pendingLabel="Apertura annuncio"
        >
          Vedi annuncio originale
        </LoadingAnchor>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="min-w-0">
          <ListingPhotoGallery title={listing.title} imageUrls={listing.imageUrls} />
        </div>

        <article className="min-w-0 rounded-lg border border-[var(--lr-line)] bg-[var(--lr-surface)] p-5">
          <h2 className="text-[length:var(--lr-text-section)] font-semibold text-[var(--lr-ink)]">
            Descrizione
          </h2>
          <p className="mt-4 max-h-[560px] overflow-auto whitespace-pre-wrap pr-2 text-[length:var(--lr-text-body)] leading-7 text-[var(--lr-ink-2)]">
            {isUsableText(listing.description, { minLength: 25 })
              ? listing.description
              : "Il portale non ha restituito una descrizione leggibile. Aprendo l'annuncio originale la trovi per intero."}
          </p>
        </article>
      </section>

      {(listing.sources ?? []).length ? (
        <section className="rounded-lg border border-[var(--lr-line)] bg-[var(--lr-surface)]">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--lr-line-quiet)] px-5 py-4">
            <div>
              <p className="text-[length:var(--lr-text-meta)] font-semibold uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-accent)]">
                Un immobile, più portali
              </p>
              <h2 className="mt-1 text-[length:var(--lr-text-section)] font-semibold text-[var(--lr-ink)]">
                Dove è pubblicato
              </h2>
            </div>
            <span className="text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
              {(listing.sources ?? []).length === 1
                ? "1 annuncio collegato"
                : `${formatNumber((listing.sources ?? []).length)} annunci collegati`}
            </span>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
            {(listing.sources ?? [])
              .toSorted((left, right) =>
                (right.lastSeenAt ?? "").localeCompare(left.lastSeenAt ?? ""),
              )
              .map((source) => (
                <a
                  key={source.id}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group rounded-lg border border-[var(--lr-line)] bg-[var(--lr-raised)] p-4 transition-colors hover:border-[var(--lr-accent)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[length:var(--lr-text-meta)] font-semibold uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-accent)]">
                        {getSourceLabel(source.source)}
                      </p>
                      <p className="mt-2 line-clamp-2 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink)]">
                        {source.title ?? listing.title}
                      </p>
                    </div>
                    <span className="shrink-0 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink)]">
                      {formatCurrency(source.price ?? listing.price)}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]">
                    <span>{source.sqm ?? listing.sqm ?? "—"} mq</span>
                    <span>{source.rooms ?? listing.rooms ?? "—"} locali</span>
                    <span>
                      {source.sellerType
                        ? getSellerTypeLabel(source.sellerType)
                        : "Venditore da verificare"}
                    </span>
                  </div>
                  <p className="mt-3 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                    Ultimo controllo {formatDateTime(source.lastSeenAt)}
                  </p>
                </a>
              ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <article className="rounded-lg border border-[var(--lr-line)] bg-[var(--lr-surface)] p-5">
          <ListingScoreBreakdown listing={listing} scoringConfig={scoringConfig} />
        </article>

        <article className="rounded-lg border border-[var(--lr-line)] bg-[var(--lr-surface)] p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[length:var(--lr-text-record)] font-semibold text-[var(--lr-ink)]">
              Completezza scheda
            </h2>
            <strong className="text-[length:var(--lr-text-body)] tabular-nums text-[var(--lr-ink)]">
              {completenessScore}%
            </strong>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--lr-canvas)]">
            <div
              className={
                hasMissingFields
                  ? "h-full rounded-full bg-[var(--lr-warn)]"
                  : "h-full rounded-full bg-[var(--lr-ok)]"
              }
              style={{ width: `${completenessScore}%` }}
            />
          </div>
          {hasMissingFields ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {missingFields.map((field) => (
                <span
                  key={field.key}
                  className={
                    field.severity === "required"
                      ? "rounded-md border border-[var(--lr-danger)] bg-[var(--lr-danger-soft)] px-2 py-1 text-[length:var(--lr-text-label)] font-semibold text-[var(--lr-danger)]"
                      : "rounded-md border border-[var(--lr-warn)] bg-[var(--lr-warn-soft)] px-2 py-1 text-[length:var(--lr-text-label)] font-semibold text-[var(--lr-warn)]"
                  }
                >
                  {field.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
              Tutti i dati principali sono presenti.
            </p>
          )}

          <dl className="mt-6 grid gap-5 sm:grid-cols-2">
            <DetailItem
              label="Venditore"
              value={formatPlainText(listing.sellerName)}
            />
            <DetailItem label="Telefono" value={formatPlainText(listing.phone)} />
            <DetailItem
              label="Prima segnalazione"
              value={formatDateTime(listing.firstSeenAt)}
            />
            <DetailItem
              label="Ultimo controllo"
              value={formatDateTime(listing.lastSeenAt)}
            />
          </dl>
        </article>
      </section>

      {listing.note ? (
        <article className="rounded-lg border border-[var(--lr-line)] bg-[var(--lr-surface)] p-5">
          <h2 className="text-[length:var(--lr-text-record)] font-semibold text-[var(--lr-ink)]">
            Note personali
          </h2>
          <p className="mt-3 whitespace-pre-wrap text-[length:var(--lr-text-body)] leading-7 text-[var(--lr-ink-2)]">
            {formatPlainText(listing.note)}
          </p>
        </article>
      ) : null}

      {duplicateListings.length ? (
        <section className="rounded-lg border border-[var(--lr-line)] bg-[var(--lr-surface)]">
          <div className="border-b border-[var(--lr-line-quiet)] px-5 py-4">
            <h2 className="text-[length:var(--lr-text-record)] font-semibold text-[var(--lr-ink)]">
              Possibili duplicati
            </h2>
            <p className="mt-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
              Lo stesso immobile potrebbe essere pubblicato da più fonti.
            </p>
          </div>
          <div className="divide-y divide-[var(--lr-line-quiet)]">
            {duplicateListings.map((duplicate) => (
              <Link key={duplicate.id} href={`/listings/${duplicate.id}`} className="flex min-h-14 items-center justify-between gap-4 px-5 py-3 hover:bg-[var(--lr-raised)]">
                <span className="min-w-0">
                  <span className="block truncate text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink)]">{duplicate.title}</span>
                  <span className="mt-1 block text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">{getSourceLabel(duplicate.source)}</span>
                </span>
                <span className="shrink-0 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink)]">{formatCurrency(duplicate.price)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {priceHistory.length > 1 ? (
        <section className="rounded-lg border border-[var(--lr-line)] bg-[var(--lr-surface)]">
          <div className="border-b border-[var(--lr-line-quiet)] px-5 py-4">
            <h2 className="text-[length:var(--lr-text-record)] font-semibold text-[var(--lr-ink)]">
              Storico prezzi
            </h2>
          </div>
          <div className="divide-y divide-[var(--lr-line-quiet)]">
            {priceHistory.map((snapshot) => (
              <div key={snapshot.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <span className="text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">{formatDateTime(snapshot.checkedAt)}</span>
                <strong className="text-[length:var(--lr-text-body)] tabular-nums text-[var(--lr-ink)]">{formatCurrency(snapshot.price)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <details className="rounded-lg border border-[var(--lr-line)] bg-[var(--lr-surface)]">
        <summary className="flex min-h-14 cursor-pointer list-none items-center px-5 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink)] marker:hidden">
          Modifica scheda
        </summary>
        <form action={updateAction} className="grid gap-4 border-t border-[var(--lr-line-quiet)] p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2 text-[length:var(--lr-text-body)] md:col-span-2">
            <span className="font-medium text-[var(--lr-ink)]">Titolo</span>
            <input name="title" defaultValue={listing.title} required className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-[length:var(--lr-text-body)]">
            <span className="font-medium text-[var(--lr-ink)]">Prezzo</span>
            <input name="price" type="number" defaultValue={listing.price ?? ""} className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-[length:var(--lr-text-body)]">
            <span className="font-medium text-[var(--lr-ink)]">Superficie mq</span>
            <input name="sqm" type="number" defaultValue={listing.sqm ?? ""} className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-[length:var(--lr-text-body)]">
            <span className="font-medium text-[var(--lr-ink)]">Locali</span>
            <input name="rooms" type="number" step="0.5" defaultValue={listing.rooms ?? ""} className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-[length:var(--lr-text-body)]">
            <span className="font-medium text-[var(--lr-ink)]">Piano</span>
            <input name="floor" defaultValue={listing.floor ?? ""} className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-[length:var(--lr-text-body)]">
            <span className="font-medium text-[var(--lr-ink)]">Zona</span>
            <input name="zone" defaultValue={listing.zone ?? ""} className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-[length:var(--lr-text-body)]">
            <span className="font-medium text-[var(--lr-ink)]">Indirizzo</span>
            <input name="addressRaw" defaultValue={listing.addressRaw ?? ""} className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-[length:var(--lr-text-body)]">
            <span className="font-medium text-[var(--lr-ink)]">Venditore</span>
            <select name="sellerType" defaultValue={listing.sellerType} className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3">
              <option value="private">Privato</option>
              <option value="agency">Agenzia</option>
              <option value="unknown">Da verificare</option>
            </select>
          </label>
          <label className="space-y-2 text-[length:var(--lr-text-body)]">
            <span className="font-medium text-[var(--lr-ink)]">Nome venditore</span>
            <input name="sellerName" defaultValue={listing.sellerName ?? ""} className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-[length:var(--lr-text-body)]">
            <span className="font-medium text-[var(--lr-ink)]">Telefono</span>
            <input name="phone" defaultValue={listing.phone ?? ""} className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-[length:var(--lr-text-body)]">
            <span className="font-medium text-[var(--lr-ink)]">Stato</span>
            <select name="status" defaultValue={listing.status} className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3">
              {LISTING_STATUS_OPTIONS.filter((value) => value !== "all").map((value) => (
                <option key={value} value={value}>{getListingStatusLabel(value)}</option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-[length:var(--lr-text-body)]">
            <span className="font-medium text-[var(--lr-ink)]">Trattamento CRM</span>
            <select name="crmStatus" defaultValue={listing.crmStatus} className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3">
              <option value="untreated">Non trattato</option>
              <option value="treated">Trattato</option>
            </select>
          </label>
          <label className="space-y-2 text-[length:var(--lr-text-body)] md:col-span-2 xl:col-span-4">
            <span className="font-medium text-[var(--lr-ink)]">Descrizione</span>
            <textarea name="description" defaultValue={listing.description ?? ""} rows={8} className="w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] p-3" />
          </label>
          <label className="space-y-2 text-[length:var(--lr-text-body)] md:col-span-2 xl:col-span-4">
            <span className="font-medium text-[var(--lr-ink)]">Nuova nota</span>
            <textarea name="note" rows={3} placeholder="Aggiungi una nota senza cancellare le precedenti" className="w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-canvas)] p-3" />
          </label>
          <div className="flex flex-col gap-3 md:col-span-2 md:flex-row xl:col-span-4">
            <PendingSubmitButton type="submit" pendingLabel="Salvo" className="h-11 rounded-md bg-[var(--lr-accent)] px-5 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-accent-ink)]">
              Salva modifiche
            </PendingSubmitButton>
            <PendingSubmitButton formAction={archiveAction} type="submit" pendingLabel="Archivio" className="inline-flex h-11 items-center justify-center rounded-md border border-[var(--lr-line)] px-5 text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink)]">
              Archivia
            </PendingSubmitButton>
          </div>
        </form>
      </details>

      <details className="rounded-lg border border-[var(--lr-line)] bg-[var(--lr-surface)]">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-5 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink)] marker:hidden">
          Altri dati della scheda
          <span className="text-[length:var(--lr-text-meta)] font-normal text-[var(--lr-ink-3)]">
            Facoltativo
          </span>
        </summary>
        <dl className="grid gap-5 border-t border-[var(--lr-line-quiet)] p-5 sm:grid-cols-2 xl:grid-cols-4">
          <DetailItem label="Fonte" value={getSourceLabel(listing.source)} />
          <DetailItem
            label="Prima segnalazione"
            value={formatDateTime(listing.firstSeenAt)}
          />
          <DetailItem
            label="Ultimo controllo"
            value={formatDateTime(listing.lastSeenAt)}
          />
          <DetailItem
            label="Data dichiarata dal portale"
            value={formatDate(listing.portalDeclaredDate)}
          />
          <DetailItem
            label="Data di pubblicazione"
            value={formatDate(listing.metadataDatePublished)}
          />
          <DetailItem
            label="Ultima modifica"
            value={formatDate(listing.metadataDateModified)}
          />
          <DetailItem
            label="Punteggio anzianita"
            value={formatNumber(listing.sellerFatigueScore)}
          />
          <DetailItem
            label="Indirizzo rilevato"
            value={formatPlainText(listing.addressRaw)}
          />
        </dl>
      </details>

      <details className="rounded-lg border border-[var(--lr-line)] bg-[var(--lr-surface)]">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-5 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink)] marker:hidden">
          Cronologia dei controlli
          <span className="text-[length:var(--lr-text-meta)] font-normal text-[var(--lr-ink-3)]">
            {listing.snapshots?.length ?? 0} controlli
          </span>
        </summary>
        <div className="border-t border-[var(--lr-line-quiet)]">
          {(listing.snapshots ?? []).length ? (
            <div className="divide-y divide-[var(--lr-line-quiet)]">
              {(listing.snapshots ?? []).map((snapshot) => (
                <article
                  key={snapshot.id}
                  className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(170px,0.6fr)_minmax(0,1fr)_auto]"
                >
                  <div>
                    <p className="text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink)]">
                      {formatDateTime(snapshot.checkedAt)}
                    </p>
                    <p className="mt-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
                      {getSourceLabel(snapshot.source)}
                    </p>
                  </div>
                  <p className="text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
                    Prezzo rilevato: {formatCurrency(snapshot.price)}
                  </p>
                  <span className="text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
                    {snapshot.isAvailable
                      ? "Annuncio disponibile"
                      : "Non disponibile"}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="px-5 py-5 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
              Non ci sono ancora controlli precedenti.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
