import type { Metadata } from "next";
import Link from "next/link";
import { clsx } from "clsx";
import { RotateCcw } from "lucide-react";

import { AutoSubmitFiltersForm } from "@/components/auto-submit-filters-form";
import { Badge, getSellerTypeTone } from "@/components/badge";
import { ListingScoreSummary } from "@/components/listing-score";
import { PageHeader } from "@/components/page-header";
import { updateListingCrmStatus } from "@/app/(private)/listings/[id]/actions";
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

/* External listing images come from dynamic portal hosts. */
/* eslint-disable @next/next/no-img-element */

function readSearchParam(
  value: string | string[] | undefined,
  fallback: string,
) {
  if (Array.isArray(value)) {
    return value[0] ?? fallback;
  }

  return value ?? fallback;
}

function isRecentListing(value: string) {
  const firstSeenAt = new Date(value).getTime();

  if (Number.isNaN(firstSeenAt)) {
    return false;
  }

  const threeDays = 1000 * 60 * 60 * 24 * 3;
  return Date.now() - firstSeenAt <= threeDays;
}

function ListingRow({
  listing,
  scoringConfig,
}: Readonly<{ listing: Listing; scoringConfig: ScoringConfig }>) {
  const isTreated = listing.crmStatus === "treated";
  const shouldShowStatus =
    listing.status !== "new" || listing.isNewToday || isRecentListing(listing.firstSeenAt);
  const toggleCrmStatus = updateListingCrmStatus.bind(
    null,
    listing.id,
    isTreated ? "untreated" : "treated",
  );
  const mainFacts = [
    { label: formatCurrency(listing.price), strong: true },
    listing.sqm != null ? { label: `${formatNumber(listing.sqm)} mq` } : null,
    listing.rooms != null
      ? { label: `${formatNumber(listing.rooms)} locali` }
      : null,
    { label: formatPlainText(listing.zone) },
  ].filter(
    (fact): fact is { label: string; strong?: boolean } => Boolean(fact),
  );

  return (
    <article
      className={clsx(
        "group relative grid cursor-pointer gap-4 rounded-[10px] border p-4 transition-colors sm:grid-cols-[190px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)_156px] lg:items-stretch",
        isTreated
          ? "border-[oklch(0.66_0.11_150)] bg-[color-mix(in_oklch,var(--surface-panel)_64%,var(--surface-accent-soft))] shadow-[inset_0_0_0_2px_oklch(0.58_0.09_150/0.24)] hover:border-[var(--surface-accent)]"
          : "border-[var(--line-soft)] bg-[var(--surface-panel)] hover:border-[var(--line-strong)]",
      )}
    >
      <Link
        href={`/listings/${listing.id}`}
        className="absolute inset-0 z-0 rounded-[10px]"
        aria-label={`Apri la scheda di ${listing.title}`}
      />
      <Link
        href={`/listings/${listing.id}`}
        className={clsx(
          "relative z-10 flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[8px] border bg-[var(--surface-muted)] text-center text-[11px] font-medium leading-4 text-[var(--ink-subtle)] sm:aspect-auto sm:h-full sm:min-h-[174px]",
          isTreated
            ? "border-[oklch(0.52_0.08_150)] bg-[oklch(0.245_0.03_150)]"
            : "border-[var(--line-soft)]",
        )}
        aria-label={`Apri la scheda di ${listing.title}`}
      >
        {listing.imageUrls[0] ? (
          <img
            src={listing.imageUrls[0]}
            alt=""
            className={clsx(
              "size-full object-cover transition-transform duration-200 group-hover:scale-[1.015]",
              isTreated && "saturate-[0.45] contrast-[0.88] opacity-70",
            )}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          "Foto non disponibile"
        )}
      </Link>

      <div className="relative z-10 min-w-0 self-start lg:self-center">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {!isTreated ? (
            <>
              <Badge tone={getSellerTypeTone(listing.sellerType)}>
                {getSellerTypeLabel(listing.sellerType)}
              </Badge>
              {shouldShowStatus ? (
                <Badge tone={listing.status === "new" ? "green" : "slate"}>
                  {getListingStatusLabel(listing.status)}
                </Badge>
              ) : null}
              <Badge tone="slate">
                {getSourceLabel(listing.source)}
              </Badge>
            </>
          ) : null}
        </div>

        <Link
          href={`/listings/${listing.id}`}
          className={clsx(
            "mt-2 block text-base font-semibold leading-6 transition-colors group-hover:text-[var(--surface-accent)]",
            isTreated ? "text-[oklch(0.88_0.08_150)]" : "text-[var(--ink-strong)]",
          )}
        >
          <span className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
            <span className="line-clamp-2 min-w-0">{listing.title}</span>
            {isTreated ? (
              <span className="inline-flex shrink-0 rounded-full border border-[oklch(0.62_0.11_150)] bg-[oklch(0.42_0.09_150)] px-3 py-1.5 text-[10px] font-bold leading-none uppercase tracking-[0.08em] text-[oklch(0.9_0.11_150)]">
                Trattato
              </span>
            ) : null}
          </span>
        </Link>

        <div className="mt-3 flex flex-wrap gap-2">
          {isTreated ? (
            <span className="rounded-full border border-[oklch(0.45_0.065_150)] bg-[oklch(0.285_0.045_150)] px-2.5 py-1 text-xs text-[oklch(0.82_0.055_150)]">
              {formatPlainText(listing.addressRaw ?? listing.zone)}
            </span>
          ) : (
            mainFacts.map((fact) => (
              <span
                key={`${listing.id}-${fact.label}`}
                className={clsx(
                  "rounded-full border border-[var(--line-soft)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--ink-soft)]",
                  fact.strong && "font-semibold text-[var(--ink-strong)]",
                )}
              >
                {fact.label}
              </span>
            ))
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          {!isTreated ? (
            <p className="text-xs font-semibold text-[var(--status-warning)]">
              {getListingAttentionReason(listing)}
            </p>
          ) : null}
          <p className="text-xs text-[var(--ink-subtle)]">
            Controllato {formatDateTime(listing.lastSeenAt)}
          </p>
        </div>
      </div>

      <div className="relative z-10 flex flex-col gap-2 sm:col-start-2 sm:flex-row lg:col-start-auto lg:w-full lg:flex-col">
        <ListingScoreSummary listing={listing} scoringConfig={scoringConfig} />
        <form action={toggleCrmStatus} className="sm:min-w-32 lg:w-full">
          <button
            type="submit"
            className={clsx(
              "inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-[6px] border px-4 text-sm font-semibold transition-colors",
              isTreated
                ? "border-[oklch(0.62_0.11_150)] bg-[oklch(0.42_0.09_150)] text-[oklch(0.92_0.1_150)] hover:bg-[oklch(0.48_0.1_150)]"
                : "border-[oklch(0.42_0.07_28)] bg-[oklch(0.235_0.035_28)] text-[var(--status-error)] hover:bg-[oklch(0.28_0.05_28)]",
            )}
          >
            {isTreated ? "Trattato" : "Non trattato"}
          </button>
        </form>
        <Link
          href={`/listings/${listing.id}`}
          className={clsx(
            "inline-flex h-10 items-center justify-center rounded-[6px] px-4 text-sm font-semibold transition-colors sm:min-w-32 lg:w-full",
            isTreated
              ? "border border-[oklch(0.5_0.07_150)] bg-transparent text-[oklch(0.86_0.08_150)] hover:bg-[oklch(0.3_0.055_150)]"
              : "bg-[var(--surface-accent)] text-[var(--button-ink)] hover:bg-[var(--surface-accent-hover)]",
          )}
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
  const onlyTreated = readSearchParam(params.onlyTreated, "") === "on";
  const onlyUntreated = readSearchParam(params.onlyUntreated, "") === "on";
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
    crmStatus:
      onlyTreated === onlyUntreated
        ? "all"
        : onlyTreated
          ? "treated"
          : "untreated",
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
    filters.crmStatus !== "all" ||
    filters.source !== "all" ||
    filters.minDaysOnline !== null ||
    filters.minScore !== null ||
    filters.maxScore !== null ||
    filters.sortBy !== "score_desc" ||
    filters.onlyHighPriority ||
    onlyTreated ||
    onlyUntreated;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Archivio"
        title="Archivio annunci"
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--ink-strong)]">
            Filtri archivio
          </p>
          <Link
            href="/listings"
            aria-label="Azzera filtri"
            title="Azzera filtri"
            className={clsx(
              "inline-flex size-10 items-center justify-center rounded-md border border-[var(--line-strong)] text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]",
              !hasActiveFilters && "pointer-events-none opacity-45",
            )}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
          </Link>
        </div>

        <AutoSubmitFiltersForm className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="grid h-[68px] rounded-[8px] border border-[var(--line-soft)] bg-[color-mix(in_oklch,var(--surface-canvas)_72%,transparent)] px-3 py-2 transition-colors focus-within:border-[var(--surface-accent)] hover:border-[var(--line-strong)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Pubblicato da
            </span>
            <select
              name="sellerType"
              defaultValue={filters.sellerType}
              className="h-8 w-full bg-transparent text-sm font-semibold text-[var(--ink-strong)] outline-none"
            >
              {SELLER_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {getSellerTypeLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="grid h-[68px] rounded-[8px] border border-[var(--line-soft)] bg-[color-mix(in_oklch,var(--surface-canvas)_72%,transparent)] px-3 py-2 transition-colors focus-within:border-[var(--surface-accent)] hover:border-[var(--line-strong)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Situazione
            </span>
            <select
              name="status"
              defaultValue={filters.status}
              className="h-8 w-full bg-transparent text-sm font-semibold text-[var(--ink-strong)] outline-none"
            >
              {LISTING_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {getListingStatusLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="grid h-[68px] rounded-[8px] border border-[var(--line-soft)] bg-[color-mix(in_oklch,var(--surface-canvas)_72%,transparent)] px-3 py-2 transition-colors focus-within:border-[var(--surface-accent)] hover:border-[var(--line-strong)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Sito di origine
            </span>
            <select
              name="source"
              defaultValue={filters.source}
              className="h-8 w-full bg-transparent text-sm font-semibold text-[var(--ink-strong)] outline-none"
            >
              <option value="all">Tutti</option>
              {LISTING_SOURCE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {getSourceLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="grid h-[68px] rounded-[8px] border border-[var(--line-soft)] bg-[color-mix(in_oklch,var(--surface-canvas)_72%,transparent)] px-3 py-2 transition-colors focus-within:border-[var(--surface-accent)] hover:border-[var(--line-strong)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Online da almeno
            </span>
            <span className="flex h-8 items-center gap-2">
              <input
                type="number"
                name="minDaysOnline"
                min="0"
                placeholder="es. 30"
                defaultValue={filters.minDaysOnline ?? ""}
                className="h-8 min-w-0 flex-1 bg-transparent text-sm font-semibold text-[var(--ink-strong)] outline-none placeholder:text-[var(--ink-subtle)]"
              />
              <span className="text-xs text-[var(--ink-soft)]">giorni</span>
            </span>
          </label>

          <label className="grid h-[68px] cursor-pointer rounded-[8px] border border-[var(--line-soft)] bg-[color-mix(in_oklch,var(--surface-canvas)_72%,transparent)] px-3 py-2 transition-colors hover:border-[var(--line-strong)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Evidenza
            </span>
            <span className="flex h-8 items-center justify-between gap-3 text-sm font-semibold text-[var(--ink-strong)]">
              <span className="truncate">Solo in evidenza</span>
              <input
                type="checkbox"
                name="onlyHighPriority"
                defaultChecked={filters.onlyHighPriority}
                className="size-4 accent-[var(--surface-accent)]"
              />
            </span>
          </label>

          <label className="grid h-[68px] cursor-pointer rounded-[8px] border border-[var(--line-soft)] bg-[color-mix(in_oklch,var(--surface-canvas)_72%,transparent)] px-3 py-2 transition-colors hover:border-[var(--line-strong)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Trattati
            </span>
            <span className="group flex h-8 items-center justify-between gap-3 text-sm font-semibold text-[var(--ink-strong)]">
              <span className="truncate">Solo trattati</span>
              <input
                type="checkbox"
                name="onlyTreated"
                defaultChecked={onlyTreated}
                className="peer sr-only"
              />
              <span className="relative h-5 w-10 shrink-0 rounded-full border border-[var(--line-strong)] bg-[oklch(0.18_0.025_145)] transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-[var(--ink-subtle)] after:transition-transform peer-checked:border-[oklch(0.62_0.11_150)] peer-checked:bg-[oklch(0.42_0.09_150)] peer-checked:after:translate-x-5 peer-checked:after:bg-[oklch(0.9_0.11_150)]" />
            </span>
          </label>

          <label className="grid h-[68px] cursor-pointer rounded-[8px] border border-[var(--line-soft)] bg-[color-mix(in_oklch,var(--surface-canvas)_72%,transparent)] px-3 py-2 transition-colors hover:border-[var(--line-strong)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Non trattati
            </span>
            <span className="group flex h-8 items-center justify-between gap-3 text-sm font-semibold text-[var(--ink-strong)]">
              <span className="truncate">Solo non trattati</span>
              <input
                type="checkbox"
                name="onlyUntreated"
                defaultChecked={onlyUntreated}
                className="peer sr-only"
              />
              <span className="relative h-5 w-10 shrink-0 rounded-full border border-[var(--line-strong)] bg-[oklch(0.18_0.025_145)] transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-[var(--ink-subtle)] after:transition-transform peer-checked:border-[oklch(0.62_0.11_150)] peer-checked:bg-[oklch(0.42_0.09_150)] peer-checked:after:translate-x-5 peer-checked:after:bg-[oklch(0.9_0.11_150)]" />
            </span>
          </label>

          <label className="grid h-[68px] rounded-[8px] border border-[var(--line-soft)] bg-[color-mix(in_oklch,var(--surface-canvas)_72%,transparent)] px-3 py-2 transition-colors focus-within:border-[var(--surface-accent)] hover:border-[var(--line-strong)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Appetibilita minima
            </span>
            <input
              type="number"
              name="minScore"
              defaultValue={filters.minScore ?? ""}
              className="h-8 w-full bg-transparent text-sm font-semibold text-[var(--ink-strong)] outline-none"
            />
          </label>

          <label className="grid h-[68px] rounded-[8px] border border-[var(--line-soft)] bg-[color-mix(in_oklch,var(--surface-canvas)_72%,transparent)] px-3 py-2 transition-colors focus-within:border-[var(--surface-accent)] hover:border-[var(--line-strong)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Appetibilita massima
            </span>
            <input
              type="number"
              name="maxScore"
              defaultValue={filters.maxScore ?? ""}
              className="h-8 w-full bg-transparent text-sm font-semibold text-[var(--ink-strong)] outline-none"
            />
          </label>

          <label className="grid h-[68px] rounded-[8px] border border-[var(--line-soft)] bg-[color-mix(in_oklch,var(--surface-canvas)_72%,transparent)] px-3 py-2 transition-colors focus-within:border-[var(--surface-accent)] hover:border-[var(--line-strong)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Ordina per
            </span>
            <select
              name="sortBy"
              defaultValue={filters.sortBy}
              className="h-8 w-full bg-transparent text-sm font-semibold text-[var(--ink-strong)] outline-none"
            >
              <option value="score_desc">Appetibilita, piu alta</option>
              <option value="score_asc">Appetibilita, piu bassa</option>
              <option value="newest">Piu recenti</option>
              <option value="oldest">Online da piu tempo</option>
              <option value="price_asc">Prezzo crescente</option>
              <option value="price_desc">Prezzo decrescente</option>
            </select>
          </label>

        </AutoSubmitFiltersForm>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4 border-t border-[var(--line-soft)] pt-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-subtle)]">
              Risultati
            </p>
            <p className="mt-1 text-2xl font-semibold leading-none text-[var(--ink-strong)]">
              {listings.length} schede complete
            </p>
          </div>
        </div>

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
