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
import type { ScoringConfig } from "@/lib/listings/scoring-config";
import { getPersistedScoringConfig } from "@/lib/settings/scoring-config-repository";
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

function ListingRow({
  listing,
  scoringConfig,
}: Readonly<{ listing: Listing; scoringConfig: ScoringConfig }>) {
  const mainFacts = [
    formatCurrency(listing.price),
    listing.sqm != null ? `${formatNumber(listing.sqm)} mq` : null,
    listing.rooms != null ? `${formatNumber(listing.rooms)} locali` : null,
    formatPlainText(listing.zone),
  ].filter(Boolean);

  return (
    <article className="group grid gap-4 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4 shadow-[var(--shadow-panel)] transition-colors hover:border-[var(--line-strong)] sm:grid-cols-[170px_minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)_156px] lg:items-stretch">
      <Link
        href={`/listings/${listing.id}`}
        className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[6px] border border-[var(--line-soft)] bg-[var(--surface-muted)] bg-cover bg-center text-center text-[11px] font-medium leading-4 text-[var(--ink-subtle)] sm:aspect-auto sm:h-full sm:min-h-[154px]"
        style={
          listing.imageUrls[0]
            ? { backgroundImage: `url("${listing.imageUrls[0]}")` }
            : undefined
        }
        aria-label={`Apri la scheda di ${listing.title}`}
      >
        {listing.imageUrls[0] ? null : "Foto non disponibile"}
      </Link>

      <div className="min-w-0 self-start lg:self-center">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge tone={getSellerTypeTone(listing.sellerType)}>
            {getSellerTypeLabel(listing.sellerType)}
          </Badge>
          <span className="text-xs font-medium text-[var(--ink-subtle)]">
            {getListingStatusLabel(listing.status)}
          </span>
          <span className="text-xs text-[var(--ink-subtle)]">
            {getSourceLabel(listing.source)}
          </span>
        </div>

        <Link
          href={`/listings/${listing.id}`}
          className="mt-2 line-clamp-2 block text-base font-semibold leading-6 text-[var(--ink-strong)] transition-colors group-hover:text-[var(--surface-accent)]"
        >
          {listing.title}
        </Link>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--ink-soft)]">
          {mainFacts.map((fact, index) => (
            <span
              key={`${listing.id}-${fact}`}
              className={index === 0 ? "font-semibold text-[var(--ink-strong)]" : ""}
            >
              {fact}
            </span>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="text-xs font-semibold text-[var(--status-warning)]">
            {getListingAttentionReason(listing)}
          </p>
          <p className="text-xs text-[var(--ink-subtle)]">
            Controllato {formatDateTime(listing.lastSeenAt)}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:col-start-2 sm:flex-row lg:col-start-auto lg:w-full lg:flex-col">
        <ListingScoreSummary listing={listing} scoringConfig={scoringConfig} />
        <Link
          href={`/listings/${listing.id}`}
          className="inline-flex h-10 items-center justify-center rounded-[6px] bg-[var(--surface-accent)] px-4 text-sm font-semibold text-[var(--button-ink)] transition-colors hover:bg-[var(--surface-accent-hover)] sm:min-w-32 lg:w-full"
        >
          Apri scheda
        </Link>
        <a
          href={listing.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 items-center justify-center rounded-[6px] border border-[var(--line-strong)] px-4 text-sm font-medium text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)] sm:min-w-32 lg:w-full"
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

  const [listings, scoringConfig] = await Promise.all([
    getListings(filters),
    getPersistedScoringConfig(),
  ]);
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
        className="rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-panel)]"
        open={hasActiveFilters}
      >
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 text-sm font-semibold text-[var(--ink-strong)] marker:hidden">
          <span>Filtra gli annunci</span>
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

      <section className="space-y-3">
        {listings.length ? (
          listings.map((listing) => (
            <ListingRow
              key={listing.id}
              listing={listing}
              scoringConfig={scoringConfig}
            />
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
