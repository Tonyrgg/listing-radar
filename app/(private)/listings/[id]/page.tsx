import {
  ArrowLeft,
  Clock3,
  ExternalLink,
  Layers3,
  MapPin,
  Phone,
  Ruler,
  UserRound,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Badge, getSellerTypeTone, getStatusTone } from "@/components/badge";
import { ListingPhotoGallery } from "@/components/listing-photo-gallery";
import { ListingScoreBreakdown } from "@/components/listing-score";
import { getListingById } from "@/lib/data/repository";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPlainText,
} from "@/lib/formatting";
import {
  getListingStatusLabel,
  getSellerTypeLabel,
  getSourceLabel,
} from "@/lib/labels";
import { getOperationalSuggestion } from "@/lib/listings/operational";

export const metadata: Metadata = {
  title: "Scheda annuncio",
};

function DetailItem({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div>
      <dt className="text-xs font-medium text-[var(--ink-subtle)]">{label}</dt>
      <dd className="mt-1 text-sm font-semibold leading-6 text-[var(--ink-strong)]">
        {value}
      </dd>
    </div>
  );
}

function KeyFact({
  icon,
  label,
  value,
}: Readonly<{
  icon: ReactNode;
  label: string;
  value: string;
}>) {
  return (
    <div className="flex min-w-0 gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--surface-accent)]">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-[var(--ink-subtle)]">{label}</p>
        <p className="mt-1 text-sm font-semibold leading-5 text-[var(--ink-strong)]">
          {value}
        </p>
      </div>
    </div>
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

  const operationalSuggestion = getOperationalSuggestion(listing);

  return (
    <div className="space-y-6">
      <Link
        href="/listings"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--ink-soft)] transition-colors hover:text-[var(--ink-strong)]"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Torna all&apos;archivio
      </Link>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="order-2 min-w-0 space-y-6 xl:order-1">
          <ListingPhotoGallery
            title={listing.title}
            imageUrls={listing.imageUrls}
          />

          <article className="border-t border-[var(--line-soft)] pt-5">
            <h2 className="text-lg font-semibold text-[var(--ink-strong)]">
              Descrizione
            </h2>
            <p className="mt-4 max-w-4xl whitespace-pre-wrap text-sm leading-7 text-[var(--ink-soft)]">
              {formatPlainText(listing.description)}
            </p>
          </article>
        </div>

        <article className="order-1 min-w-0 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] xl:sticky xl:top-7 xl:order-2 xl:self-start">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={getSellerTypeTone(listing.sellerType)}>
                {getSellerTypeLabel(listing.sellerType)}
              </Badge>
              <Badge tone={getStatusTone(listing.status)}>
                {getListingStatusLabel(listing.status)}
              </Badge>
              {listing.isPriceDropped ? (
                <Badge tone="red">Prezzo ridotto</Badge>
              ) : null}
            </div>

            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-subtle)]">
              {getSourceLabel(listing.source)}
            </p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight text-[var(--ink-strong)]">
              {listing.title}
            </h1>

            <div className="mt-5 border-y border-[var(--line-soft)] py-5">
              <p className="text-3xl font-semibold tabular-nums text-[var(--ink-strong)]">
                {formatCurrency(listing.price)}
              </p>
              {listing.pricePerSqm != null ? (
                <p className="mt-1 text-sm text-[var(--ink-soft)]">
                  {formatCurrency(listing.pricePerSqm)} al mq
                </p>
              ) : null}
            </div>

            <ListingScoreBreakdown listing={listing} />

            <div className="grid grid-cols-2 gap-5 py-5 xl:grid-cols-1 2xl:grid-cols-2">
              <KeyFact
                icon={<Ruler aria-hidden="true" className="size-4" />}
                label="Superficie"
                value={
                  listing.sqm != null
                    ? `${formatNumber(listing.sqm)} mq`
                    : "Non disponibile"
                }
              />
              <KeyFact
                icon={<Layers3 aria-hidden="true" className="size-4" />}
                label="Locali e piano"
                value={[
                  listing.rooms != null
                    ? `${formatNumber(listing.rooms)} locali`
                    : null,
                  listing.floor,
                ]
                  .filter(Boolean)
                  .join(", ") || "Non disponibile"}
              />
              <KeyFact
                icon={<MapPin aria-hidden="true" className="size-4" />}
                label="Zona"
                value={formatPlainText(listing.zone)}
              />
              <KeyFact
                icon={<Clock3 aria-hidden="true" className="size-4" />}
                label="Online da almeno"
                value={`${formatNumber(listing.minimumDaysOnline)} giorni`}
              />
            </div>

            <div className="rounded-md bg-[var(--surface-accent-soft)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--surface-accent)]">
                Perche merita attenzione
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-strong)]">
                {operationalSuggestion}
              </p>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <div className="flex gap-3">
                <UserRound
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-[var(--surface-accent)]"
                />
                <div>
                  <p className="text-xs text-[var(--ink-subtle)]">Venditore</p>
                  <p className="mt-1 text-sm font-medium text-[var(--ink-strong)]">
                    {formatPlainText(listing.sellerName)}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Phone
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-[var(--surface-accent)]"
                />
                <div>
                  <p className="text-xs text-[var(--ink-subtle)]">Telefono</p>
                  <p className="mt-1 text-sm font-medium text-[var(--ink-strong)]">
                    {formatPlainText(listing.phone)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <a
            href={listing.url}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-14 items-center justify-center gap-2 border-t border-[var(--line-soft)] px-5 text-sm font-semibold text-[var(--surface-accent)] transition-colors hover:bg-[var(--surface-muted)]"
          >
            Vedi annuncio originale
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
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
