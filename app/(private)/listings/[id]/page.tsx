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
import { getDuplicateListings, getListingById } from "@/lib/data/repository";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPlainText,
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
          ? "rounded-[7px] border border-[oklch(0.42_0.07_80)] bg-[oklch(0.235_0.035_80)] px-3 py-2"
          : undefined
      }
    >
      <dt
        className={
          isUnavailable
            ? "text-xs font-medium text-[var(--status-warning)]"
            : "text-xs font-medium text-[var(--ink-subtle)]"
        }
      >
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold leading-6 text-[var(--ink-strong)]">
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
          ? "rounded-[7px] border border-[oklch(0.42_0.07_80)] bg-[oklch(0.235_0.035_80)] px-4 py-3"
          : "rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] px-4 py-3"
      }
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
        {label}
      </p>
      <p className="mt-2 truncate text-lg font-semibold leading-none text-[var(--ink-strong)]">
        {value}
      </p>
      {detail ? (
        <div
          className={
            tone === "warning"
              ? "mt-1 min-w-0 text-xs text-[var(--status-warning)]"
              : "mt-1 min-w-0 text-xs text-[var(--ink-soft)]"
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
            ? "block w-full cursor-pointer rounded-[7px] border border-[oklch(0.56_0.1_150)] bg-[oklch(0.31_0.055_150)] px-4 py-3 text-left transition-colors hover:bg-[oklch(0.36_0.065_150)]"
            : "block w-full cursor-pointer rounded-[7px] border border-[oklch(0.42_0.07_28)] bg-[oklch(0.235_0.035_28)] px-4 py-3 text-left transition-colors hover:bg-[oklch(0.28_0.05_28)]"
        }
      >
        <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
          CRM
        </span>
        <span className="mt-2 block truncate text-lg font-semibold leading-none text-[var(--ink-strong)]">
          {getListingCrmStatusLabel(crmStatus)}
        </span>
        <span className="mt-1 block truncate text-xs text-[var(--ink-soft)]">
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

  return (
    <div className="space-y-6">
      <Link
        href="/listings"
        className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--ink-soft)] transition-colors hover:text-[var(--ink-strong)]"
      >
        Torna all&apos;archivio
      </Link>

      <section className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
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
            </div>

            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-subtle)]">
              {getSourceLabel(listing.source)}
            </p>
            <h1 className="mt-2 max-w-5xl text-2xl font-semibold leading-tight text-[var(--ink-strong)]">
              {listing.title}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">
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
                label="Appetibilita"
                value={`${formatNumber(listing.priorityScore)} pt`}
                detail="Priorita di controllo"
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

            <dl className="grid gap-3 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] p-4 sm:grid-cols-4">
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
              <DetailItem
                label="Zona"
                tone={listing.zone?.trim() ? "default" : "warning"}
                value={formatPlainText(listing.zone)}
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
          className="flex min-h-12 items-center justify-center gap-2 border-t border-[var(--line-soft)] px-5 text-sm font-semibold text-[var(--surface-accent)] transition-colors hover:bg-[var(--surface-muted)]"
          pendingLabel="Apertura annuncio"
        >
          Vedi annuncio originale
        </LoadingAnchor>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="min-w-0">
          <ListingPhotoGallery title={listing.title} imageUrls={listing.imageUrls} />
        </div>

        <article className="min-w-0 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5">
          <h2 className="text-lg font-semibold text-[var(--ink-strong)]">
            Descrizione
          </h2>
          <p className="mt-4 max-h-[560px] overflow-auto whitespace-pre-wrap pr-2 text-sm leading-7 text-[var(--ink-soft)]">
            {formatPlainText(listing.description)}
          </p>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5">
          <ListingScoreBreakdown listing={listing} scoringConfig={scoringConfig} />
        </article>

        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-[var(--ink-strong)]">
              Completezza scheda
            </h2>
            <strong className="text-sm tabular-nums text-[var(--ink-strong)]">
              {completenessScore}%
            </strong>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface-canvas)]">
            <div
              className={
                hasMissingFields
                  ? "h-full rounded-full bg-[var(--status-warning)]"
                  : "h-full rounded-full bg-[var(--surface-accent)]"
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
                      ? "rounded-md border border-[oklch(0.4_0.07_24)] bg-[oklch(0.23_0.035_24)] px-2 py-1 text-[11px] font-semibold text-[var(--status-error)]"
                      : "rounded-md border border-[oklch(0.42_0.07_80)] bg-[oklch(0.235_0.035_80)] px-2 py-1 text-[11px] font-semibold text-[var(--status-warning)]"
                  }
                >
                  {field.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--ink-soft)]">
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
        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5">
          <h2 className="text-base font-semibold text-[var(--ink-strong)]">
            Note personali
          </h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--ink-soft)]">
            {formatPlainText(listing.note)}
          </p>
        </article>
      ) : null}

      {duplicateListings.length ? (
        <section className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
          <div className="border-b border-[var(--line-soft)] px-5 py-4">
            <h2 className="text-base font-semibold text-[var(--ink-strong)]">
              Possibili duplicati
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Lo stesso immobile potrebbe essere pubblicato da piu fonti.
            </p>
          </div>
          <div className="divide-y divide-[var(--line-soft)]">
            {duplicateListings.map((duplicate) => (
              <Link key={duplicate.id} href={`/listings/${duplicate.id}`} target="_blank" rel="noreferrer" className="flex min-h-14 items-center justify-between gap-4 px-5 py-3 hover:bg-[var(--surface-muted)]">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[var(--ink-strong)]">{duplicate.title}</span>
                  <span className="mt-1 block text-xs text-[var(--ink-subtle)]">{getSourceLabel(duplicate.source)}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-[var(--ink-strong)]">{formatCurrency(duplicate.price)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {priceHistory.length > 1 ? (
        <section className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
          <div className="border-b border-[var(--line-soft)] px-5 py-4">
            <h2 className="text-base font-semibold text-[var(--ink-strong)]">
              Storico prezzi
            </h2>
          </div>
          <div className="divide-y divide-[var(--line-soft)]">
            {priceHistory.map((snapshot) => (
              <div key={snapshot.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <span className="text-sm text-[var(--ink-soft)]">{formatDateTime(snapshot.checkedAt)}</span>
                <strong className="text-sm tabular-nums text-[var(--ink-strong)]">{formatCurrency(snapshot.price)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <details className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        <summary className="flex min-h-14 cursor-pointer list-none items-center px-5 text-sm font-semibold text-[var(--ink-strong)] marker:hidden">
          Modifica scheda
        </summary>
        <form action={updateAction} className="grid gap-4 border-t border-[var(--line-soft)] p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2 text-sm md:col-span-2">
            <span className="font-medium text-[var(--ink-strong)]">Titolo</span>
            <input name="title" defaultValue={listing.title} required className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-[var(--ink-strong)]">Prezzo</span>
            <input name="price" type="number" defaultValue={listing.price ?? ""} className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-[var(--ink-strong)]">Superficie mq</span>
            <input name="sqm" type="number" defaultValue={listing.sqm ?? ""} className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-[var(--ink-strong)]">Locali</span>
            <input name="rooms" type="number" step="0.5" defaultValue={listing.rooms ?? ""} className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-[var(--ink-strong)]">Piano</span>
            <input name="floor" defaultValue={listing.floor ?? ""} className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-[var(--ink-strong)]">Zona</span>
            <input name="zone" defaultValue={listing.zone ?? ""} className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-[var(--ink-strong)]">Indirizzo</span>
            <input name="addressRaw" defaultValue={listing.addressRaw ?? ""} className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-[var(--ink-strong)]">Venditore</span>
            <select name="sellerType" defaultValue={listing.sellerType} className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3">
              <option value="private">Privato</option>
              <option value="agency">Agenzia</option>
              <option value="unknown">Da verificare</option>
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-[var(--ink-strong)]">Nome venditore</span>
            <input name="sellerName" defaultValue={listing.sellerName ?? ""} className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-[var(--ink-strong)]">Telefono</span>
            <input name="phone" defaultValue={listing.phone ?? ""} className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3" />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-[var(--ink-strong)]">Stato</span>
            <select name="status" defaultValue={listing.status} className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3">
              {LISTING_STATUS_OPTIONS.filter((value) => value !== "all").map((value) => (
                <option key={value} value={value}>{getListingStatusLabel(value)}</option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-[var(--ink-strong)]">Trattamento CRM</span>
            <select name="crmStatus" defaultValue={listing.crmStatus} className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3">
              <option value="untreated">Non trattato</option>
              <option value="treated">Trattato</option>
            </select>
          </label>
          <label className="space-y-2 text-sm md:col-span-2 xl:col-span-4">
            <span className="font-medium text-[var(--ink-strong)]">Descrizione</span>
            <textarea name="description" defaultValue={listing.description ?? ""} rows={8} className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] p-3" />
          </label>
          <label className="space-y-2 text-sm md:col-span-2 xl:col-span-4">
            <span className="font-medium text-[var(--ink-strong)]">Nuova nota</span>
            <textarea name="note" rows={3} placeholder="Aggiungi una nota senza cancellare le precedenti" className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] p-3" />
          </label>
          <div className="flex flex-col gap-3 md:col-span-2 md:flex-row xl:col-span-4">
            <PendingSubmitButton type="submit" pendingLabel="Salvo" className="h-11 rounded-md bg-[var(--surface-accent)] px-5 text-sm font-semibold text-[var(--button-ink)]">
              Salva modifiche
            </PendingSubmitButton>
            <PendingSubmitButton formAction={archiveAction} type="submit" pendingLabel="Archivio" className="inline-flex h-11 items-center justify-center rounded-md border border-[var(--line-strong)] px-5 text-sm font-medium text-[var(--ink-strong)]">
              Archivia
            </PendingSubmitButton>
          </div>
        </form>
      </details>

      <details className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-5 text-sm font-semibold text-[var(--ink-strong)] marker:hidden">
          Altri dati della scheda
          <span className="text-xs font-normal text-[var(--ink-subtle)]">
            Facoltativo
          </span>
        </summary>
        <dl className="grid gap-5 border-t border-[var(--line-soft)] p-5 sm:grid-cols-2 xl:grid-cols-4">
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

      <details className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-5 text-sm font-semibold text-[var(--ink-strong)] marker:hidden">
          Cronologia dei controlli
          <span className="text-xs font-normal text-[var(--ink-subtle)]">
            {listing.snapshots?.length ?? 0} controlli
          </span>
        </summary>
        <div className="border-t border-[var(--line-soft)]">
          {(listing.snapshots ?? []).length ? (
            <div className="divide-y divide-[var(--line-soft)]">
              {(listing.snapshots ?? []).map((snapshot) => (
                <article
                  key={snapshot.id}
                  className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(170px,0.6fr)_minmax(0,1fr)_auto]"
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--ink-strong)]">
                      {formatDateTime(snapshot.checkedAt)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--ink-subtle)]">
                      {getSourceLabel(snapshot.source)}
                    </p>
                  </div>
                  <p className="text-sm text-[var(--ink-soft)]">
                    Prezzo rilevato: {formatCurrency(snapshot.price)}
                  </p>
                  <span className="text-sm text-[var(--ink-soft)]">
                    {snapshot.isAvailable
                      ? "Annuncio disponibile"
                      : "Non disponibile"}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="px-5 py-5 text-sm text-[var(--ink-soft)]">
              Non ci sono ancora controlli precedenti.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
