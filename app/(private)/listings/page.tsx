import { SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge, getSellerTypeTone } from "@/components/badge";
import { ListingScoreSummary } from "@/components/listing-score";
import { PageHeader } from "@/components/page-header";
import {
  LISTING_SOURCE_OPTIONS,
  LISTING_STATUS_OPTIONS,
  SELLER_TYPE_OPTIONS,
} from "@/lib/constants";
import { getListings } from "@/lib/data/repository";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPlainText,
} from "@/lib/formatting";
import {
  getListingStatusLabel,
  getSellerTypeLabel,
  getSourceLabel,
} from "@/lib/labels";
import { getListingAttentionReason } from "@/lib/listings/operational";
import type { Listing, ListingFilters, SellerType } from "@/types";

export const metadata: Metadata = {
  title: "Archivio annunci",
};

function readSearchParam(
  value: string | string[] | undefined,
  fallback: string,
) {
  if (Array.isArray(value)) {
    return value[0] ?? fallback;
  }

  return value ?? fallback;
}

function ListingRow({ listing }: Readonly<{ listing: Listing }>) {
  return (
    <article className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 border-b border-[var(--line-soft)] px-4 py-4 last:border-b-0 sm:px-5 md:grid-cols-[120px_minmax(0,1fr)_auto] md:items-center md:gap-4">
      <Link
        href={`/listings/${listing.id}`}
        className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[6px] border border-[var(--line-soft)] bg-[var(--surface-muted)] bg-cover bg-center"
        style={
          listing.imageUrls[0]
            ? { backgroundImage: `url("${listing.imageUrls[0]}")` }
            : undefined
        }
        aria-label={`Apri la scheda di ${listing.title}`}
      >
      </Link>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={getSellerTypeTone(listing.sellerType)}>
            {getSellerTypeLabel(listing.sellerType)}
          </Badge>
          <span className="text-xs text-[var(--ink-subtle)]">
            {getListingStatusLabel(listing.status)} - {getSourceLabel(listing.source)}
          </span>
        </div>

        <Link
          href={`/listings/${listing.id}`}
          className="mt-2 line-clamp-2 block text-sm font-semibold leading-5 text-[var(--ink-strong)] transition-colors hover:text-[var(--surface-accent)] md:mt-3 md:text-base md:leading-6"
        >
          {listing.title}
        </Link>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--ink-soft)] md:mt-3 md:gap-x-5 md:gap-y-2">
          <span className="font-semibold text-[var(--ink-strong)]">
            {formatCurrency(listing.price)}
          </span>
          <span>{formatNumber(listing.sqm)} mq</span>
          <span>{formatNumber(listing.rooms)} locali</span>
          <span>{formatPlainText(listing.zone)}</span>
        </div>

        <p className="col-span-2 mt-3 text-xs font-medium text-[var(--status-warning)] md:col-span-1">
          {getListingAttentionReason(listing)}
        </p>
        <p className="col-span-2 mt-1 text-xs text-[var(--ink-subtle)] md:col-span-1">
          Ultimo controllo: {formatDateTime(listing.lastSeenAt)}
        </p>
      </div>

      <div className="col-span-2 flex flex-col items-start gap-2 sm:flex-row md:col-span-1 md:w-40 md:flex-col">
        <ListingScoreSummary listing={listing} />
        <Link
          href={`/listings/${listing.id}`}
          className="inline-flex h-10 w-full items-center justify-center rounded-[6px] bg-[var(--surface-accent)] px-4 text-sm font-semibold text-[var(--button-ink)] transition-colors hover:bg-[var(--surface-accent-hover)]"
        >
          Apri scheda
        </Link>
        <a
          href={listing.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 w-full items-center justify-center rounded-[6px] border border-[var(--line-strong)] px-4 text-sm font-medium text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]"
        >
          Originale
        </a>
      </div>
    </article>
  );
}

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sellerType = readSearchParam(params.sellerType, "all");
  const status = readSearchParam(params.status, "all");
  const source = readSearchParam(params.source, "all");
  const minDaysOnlineRaw = readSearchParam(params.minDaysOnline, "");
  const minScoreRaw = readSearchParam(params.minScore, "");
  const maxScoreRaw = readSearchParam(params.maxScore, "");
  const sortBy = readSearchParam(params.sortBy, "score_desc");
  const minDaysOnline =
    minDaysOnlineRaw.trim() === "" ? null : Number(minDaysOnlineRaw);

  const filters: ListingFilters = {
    sellerType: SELLER_TYPE_OPTIONS.includes(sellerType as "all" | SellerType)
      ? (sellerType as "all" | SellerType)
      : "all",
    status: LISTING_STATUS_OPTIONS.includes(
      status as (typeof LISTING_STATUS_OPTIONS)[number],
    )
      ? status
      : "all",
    source:
      source === "all" ||
      LISTING_SOURCE_OPTIONS.includes(
        source as (typeof LISTING_SOURCE_OPTIONS)[number],
      )
        ? source
        : "all",
    minDaysOnline:
      typeof minDaysOnline === "number" && !Number.isNaN(minDaysOnline)
        ? minDaysOnline
        : null,
    onlyHighPriority: readSearchParam(params.onlyHighPriority, "") === "on",
    minScore:
      minScoreRaw !== "" && Number.isFinite(Number(minScoreRaw))
        ? Number(minScoreRaw)
        : null,
    maxScore:
      maxScoreRaw !== "" && Number.isFinite(Number(maxScoreRaw))
        ? Number(maxScoreRaw)
        : null,
    sortBy: [
      "score_desc",
      "score_asc",
      "newest",
      "oldest",
      "price_asc",
      "price_desc",
    ].includes(sortBy)
      ? (sortBy as ListingFilters["sortBy"])
      : "score_desc",
  };

  const listings = await getListings(filters);
  const hasActiveFilters =
    filters.sellerType !== "all" ||
    filters.status !== "all" ||
    filters.source !== "all" ||
    filters.minDaysOnline !== null ||
    filters.minScore !== null ||
    filters.maxScore !== null ||
    filters.sortBy !== "score_desc" ||
    filters.onlyHighPriority;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Archivio"
        title="Archivio annunci"
        description={`${listings.length} schede complete.`}
      />

      <details
        className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]"
        open={hasActiveFilters}
      >
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 text-sm font-semibold text-[var(--ink-strong)] marker:hidden">
          <span className="flex items-center gap-3">
            <SlidersHorizontal
              aria-hidden="true"
              className="size-4 text-[var(--surface-accent)]"
            />
            Filtra gli annunci
          </span>
          <span className="text-xs font-normal text-[var(--ink-subtle)]">
            {hasActiveFilters ? "Filtri attivi" : "Facoltativo"}
          </span>
        </summary>

        <form className="grid gap-4 border-t border-[var(--line-soft)] p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2 text-sm text-[var(--ink-soft)]">
            <span className="block font-medium text-[var(--ink-strong)]">
              Pubblicato da
            </span>
            <select
              name="sellerType"
              defaultValue={filters.sellerType}
              className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3 text-[var(--ink-strong)]"
            >
              {SELLER_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {getSellerTypeLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm text-[var(--ink-soft)]">
            <span className="block font-medium text-[var(--ink-strong)]">
              Situazione
            </span>
            <select
              name="status"
              defaultValue={filters.status}
              className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3 text-[var(--ink-strong)]"
            >
              {LISTING_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {getListingStatusLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm text-[var(--ink-soft)]">
            <span className="block font-medium text-[var(--ink-strong)]">
              Sito di origine
            </span>
            <select
              name="source"
              defaultValue={filters.source}
              className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3 text-[var(--ink-strong)]"
            >
              <option value="all">Tutti</option>
              {LISTING_SOURCE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {getSourceLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm text-[var(--ink-soft)]">
            <span className="block font-medium text-[var(--ink-strong)]">
              Online da almeno
            </span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                name="minDaysOnline"
                min="0"
                placeholder="es. 30"
                defaultValue={filters.minDaysOnline ?? ""}
                className="h-11 min-w-0 flex-1 rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3 text-[var(--ink-strong)]"
              />
              <span className="text-sm text-[var(--ink-soft)]">giorni</span>
            </div>
          </label>

          <div className="flex flex-col justify-end gap-3">
            <label className="flex min-h-11 items-center gap-3 rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3 text-sm text-[var(--ink-strong)]">
              <input
                type="checkbox"
                name="onlyHighPriority"
                defaultChecked={filters.onlyHighPriority}
                className="size-4"
              />
              Solo annunci in evidenza
            </label>
          </div>

          <label className="space-y-2 text-sm text-[var(--ink-soft)]">
            <span className="block font-medium text-[var(--ink-strong)]">
              Appetibilita minima
            </span>
            <input
              type="number"
              name="minScore"
              defaultValue={filters.minScore ?? ""}
              className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3 text-[var(--ink-strong)]"
            />
          </label>

          <label className="space-y-2 text-sm text-[var(--ink-soft)]">
            <span className="block font-medium text-[var(--ink-strong)]">
              Appetibilita massima
            </span>
            <input
              type="number"
              name="maxScore"
              defaultValue={filters.maxScore ?? ""}
              className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3 text-[var(--ink-strong)]"
            />
          </label>

          <label className="space-y-2 text-sm text-[var(--ink-soft)]">
            <span className="block font-medium text-[var(--ink-strong)]">
              Ordina per
            </span>
            <select
              name="sortBy"
              defaultValue={filters.sortBy}
              className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-canvas)] px-3 text-[var(--ink-strong)]"
            >
              <option value="score_desc">Appetibilita, piu alta</option>
              <option value="score_asc">Appetibilita, piu bassa</option>
              <option value="newest">Piu recenti</option>
              <option value="oldest">Online da piu tempo</option>
              <option value="price_asc">Prezzo crescente</option>
              <option value="price_desc">Prezzo decrescente</option>
            </select>
          </label>

          <div className="flex flex-col gap-3 md:col-span-2 md:flex-row xl:col-span-4">
            <button
              type="submit"
              className="h-11 rounded-md bg-[var(--surface-accent)] px-5 text-sm font-semibold text-[var(--button-ink)] transition-colors hover:bg-[var(--surface-accent-hover)]"
            >
              Mostra risultati
            </button>
            <Link
              href="/listings"
              className="inline-flex h-11 items-center justify-center rounded-md border border-[var(--line-strong)] px-5 text-sm font-medium text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              Azzera filtri
            </Link>
          </div>
        </form>
      </details>

      <section className="overflow-hidden rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        {listings.length ? (
          listings.map((listing) => (
            <ListingRow key={listing.id} listing={listing} />
          ))
        ) : (
          <div className="px-6 py-16 text-center">
            <p className="text-base font-semibold text-[var(--ink-strong)]">
              Nessun annuncio con questi filtri
            </p>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              Azzera i filtri per tornare a vedere tutto l&apos;archivio.
            </p>
            <Link
              href="/listings"
              className="mt-5 inline-flex h-11 items-center rounded-md border border-[var(--line-strong)] px-4 text-sm font-medium text-[var(--ink-strong)]"
            >
              Mostra tutti gli annunci
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
