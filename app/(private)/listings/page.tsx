import type { Metadata } from "next";
import Link from "next/link";
import { clsx } from "clsx";
import { Archive, ExternalLink, LayoutGrid, List, RotateCcw } from "lucide-react";

import { AutoSubmitFiltersForm } from "@/components/auto-submit-filters-form";
import { Badge, getSellerTypeTone } from "@/components/badge";
import {
  LoadingAnchor,
  LoadingLink,
  PendingSubmitButton,
} from "@/components/loading-controls";
import { ListingScoreSummary } from "@/components/listing-score";
import { PageHeader } from "@/components/page-header";
import {
  archiveListing,
  updateListingCrmStatus,
} from "@/app/(private)/listings/[id]/actions";
import {
  LISTING_SOURCE_OPTIONS,
  LISTING_STATUS_OPTIONS,
  SELLER_TYPE_OPTIONS,
} from "@/lib/constants";
import { getListings } from "@/lib/data/repository";
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
import { normalizeListingSource } from "@/lib/listing-sources";
import { getListingAttentionReason } from "@/lib/listings/operational";
import type { ScoringConfig } from "@/lib/listings/scoring-config";
import { getPersistedScoringConfig } from "@/lib/settings/scoring-config-repository";
import type { Listing, ListingFilters, SellerType } from "@/types";

export const metadata: Metadata = {
  title: "Archivio annunci",
};

type ListingViewMode = "list" | "grid";

const LISTING_SORT_OPTIONS = [
  "score_desc",
  "score_asc",
  "newest",
  "checked_oldest",
  "first_seen_desc",
  "oldest",
  "price_asc",
  "price_desc",
  "price_per_sqm_asc",
  "price_per_sqm_desc",
  "private_first",
  "price_drop_first",
  "phone_first",
  "incomplete_first",
] satisfies ListingFilters["sortBy"][];

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

function buildViewHref(
  params: Record<string, string | string[] | undefined>,
  view: ListingViewMode,
) {
  const nextParams = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(params)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];

    for (const value of values) {
      if (value != null && value !== "" && key !== "view") {
        nextParams.append(key, value);
      }
    }
  }

  if (view !== "list") {
    nextParams.set("view", view);
  }

  const query = nextParams.toString();
  return query ? `/listings?${query}` : "/listings";
}

function listingMainFacts(listing: Listing) {
  return [
    { label: formatCurrency(listing.price), strong: true },
    listing.sqm != null ? { label: `${formatNumber(listing.sqm)} mq` } : null,
    listing.rooms != null
      ? { label: `${formatNumber(listing.rooms)} locali` }
      : null,
  ].filter(
    (fact): fact is { label: string; strong?: boolean } => Boolean(fact),
  );
}

function listingLocationText(listing: Listing) {
  const location = listing.addressRaw?.trim() || listing.zone?.trim();
  return location ? formatPlainText(location) : null;
}

function checkedDateKey(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function groupListingsByCheckedDate(listings: Listing[]) {
  const groups: Array<{
    key: string;
    label: string;
    listings: Listing[];
  }> = [];
  const groupByKey = new Map<string, (typeof groups)[number]>();

  for (const listing of listings) {
    const key = checkedDateKey(listing.lastSeenAt);
    let group = groupByKey.get(key);

    if (!group) {
      group = {
        key,
        label: formatDate(listing.lastSeenAt),
        listings: [],
      };
      groupByKey.set(key, group);
      groups.push(group);
    }

    group.listings.push(listing);
  }

  return groups;
}

function shouldGroupByCheckedDate(sortBy: ListingFilters["sortBy"]) {
  return sortBy === "newest" || sortBy === "checked_oldest";
}

function ListingDateSeparator({
  label,
  count,
}: Readonly<{ label: string; count: number }>) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px min-w-6 flex-1 bg-[var(--line-soft)]" aria-hidden="true" />
      <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-subtle)]">
        Controllo: {label}
      </p>
      <span className="shrink-0 text-[11px] text-[var(--ink-subtle)]">
        {count === 1 ? "1 annuncio" : `${count} annunci`}
      </span>
      <div className="h-px min-w-6 flex-1 bg-[var(--line-soft)]" aria-hidden="true" />
    </div>
  );
}

function ListingActions({
  listing,
  isTreated,
  compact = false,
}: Readonly<{
  listing: Listing;
  isTreated: boolean;
  compact?: boolean;
}>) {
  const toggleCrmStatus = updateListingCrmStatus.bind(
    null,
    listing.id,
    isTreated ? "untreated" : "treated",
  );
  const archiveAction = archiveListing.bind(null, listing.id);

  return (
    <>
      <form action={toggleCrmStatus} className={compact ? "" : "sm:min-w-32 lg:w-full"}>
        <PendingSubmitButton
          type="submit"
          pendingLabel="Aggiorno"
          className={clsx(
            "inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-[6px] border px-4 text-sm font-semibold transition-colors",
            isTreated
              ? "border-[oklch(0.62_0.11_150)] bg-[oklch(0.42_0.09_150)] text-[oklch(0.92_0.1_150)] hover:bg-[oklch(0.48_0.1_150)]"
              : "border-[oklch(0.42_0.07_28)] bg-[oklch(0.235_0.035_28)] text-[var(--status-error)] hover:bg-[oklch(0.28_0.05_28)]",
          )}
        >
          {isTreated ? "Trattato" : "Non trattato"}
        </PendingSubmitButton>
      </form>
      <LoadingLink
        href={`/listings/${listing.id}`}
        pendingLabel="Apertura"
        className={clsx(
          "inline-flex h-10 items-center justify-center gap-2 rounded-[6px] px-4 text-sm font-semibold transition-colors",
          compact ? "w-full" : "sm:min-w-32 lg:w-full",
          isTreated
            ? "border border-[oklch(0.5_0.07_150)] bg-transparent text-[oklch(0.86_0.08_150)] hover:bg-[oklch(0.3_0.055_150)]"
            : "bg-[var(--surface-accent)] text-[var(--button-ink)] hover:bg-[var(--surface-accent-hover)]",
        )}
      >
        Apri scheda
      </LoadingLink>
      <div className={clsx("grid grid-cols-2 gap-2", compact ? "" : "sm:min-w-32 lg:w-full")}>
        <LoadingAnchor
          href={listing.url}
          target="_blank"
          rel="noreferrer"
          aria-label="Apri annuncio originale"
          title="Apri annuncio originale"
          pendingLabel=""
          className="inline-flex h-10 items-center justify-center rounded-[6px] border border-[var(--line-strong)] text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--surface-accent)]"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
        </LoadingAnchor>
        <form action={archiveAction}>
          <PendingSubmitButton
            type="submit"
            aria-label="Archivia annuncio"
            title="Archivia annuncio"
            pendingLabel=""
            icon={<Archive className="size-4" aria-hidden="true" />}
            className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-[6px] border border-[oklch(0.46_0.05_80)] bg-[oklch(0.18_0.025_80)] text-[oklch(0.82_0.08_80)] transition-colors hover:bg-[oklch(0.24_0.04_80)] focus:outline-none focus:ring-2 focus:ring-[var(--surface-accent)]"
          >
            <span className="sr-only">Archivia</span>
          </PendingSubmitButton>
        </form>
      </div>
    </>
  );
}

function ListingRow({
  listing,
  scoringConfig,
}: Readonly<{ listing: Listing; scoringConfig: ScoringConfig }>) {
  const isTreated = listing.crmStatus === "treated";
  const shouldShowStatus =
    listing.status !== "new" || listing.isNewToday || isRecentListing(listing.firstSeenAt);
  const mainFacts = listingMainFacts(listing);
  const locationText = listingLocationText(listing);

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
        target="_blank"
        rel="noreferrer"
        className="absolute inset-0 z-0 rounded-[10px]"
        aria-label={`Apri la scheda di ${listing.title}`}
      />
      <Link
        href={`/listings/${listing.id}`}
        target="_blank"
        rel="noreferrer"
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
          target="_blank"
          rel="noreferrer"
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

        <div className="mt-3 space-y-2">
          {!isTreated && mainFacts.length ? (
            <div className="flex flex-wrap gap-2">
              {mainFacts.map((fact) => (
                <span
                  key={`${listing.id}-${fact.label}`}
                  className={clsx(
                    "rounded-full border border-[var(--line-soft)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--ink-soft)]",
                    fact.strong && "font-semibold text-[var(--ink-strong)]",
                  )}
                >
                  {fact.label}
                </span>
              ))}
            </div>
          ) : null}
          {locationText ? (
            <p
              className={clsx(
                "line-clamp-2 max-w-[76ch] text-xs leading-5 text-[var(--ink-soft)]",
                isTreated && "text-[oklch(0.8_0.05_150)]",
              )}
            >
              {locationText}
            </p>
          ) : null}
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
        <ListingActions listing={listing} isTreated={isTreated} />
      </div>
    </article>
  );
}

function ListingGridCard({
  listing,
  scoringConfig,
}: Readonly<{ listing: Listing; scoringConfig: ScoringConfig }>) {
  const isTreated = listing.crmStatus === "treated";
  const shouldShowStatus =
    listing.status !== "new" || listing.isNewToday || isRecentListing(listing.firstSeenAt);
  const mainFacts = listingMainFacts(listing);
  const locationText = listingLocationText(listing);

  return (
    <article
      className={clsx(
        "group relative flex min-h-[520px] cursor-pointer flex-col overflow-hidden rounded-[10px] border transition-colors",
        isTreated
          ? "border-[oklch(0.66_0.11_150)] bg-[color-mix(in_oklch,var(--surface-panel)_64%,var(--surface-accent-soft))] shadow-[inset_0_0_0_2px_oklch(0.58_0.09_150/0.24)] hover:border-[var(--surface-accent)]"
          : "border-[var(--line-soft)] bg-[var(--surface-panel)] hover:border-[var(--line-strong)]",
      )}
    >
      <Link
        href={`/listings/${listing.id}`}
        target="_blank"
        rel="noreferrer"
        className="absolute inset-0 z-0 rounded-[10px]"
        aria-label={`Apri la scheda di ${listing.title}`}
      />

      <Link
        href={`/listings/${listing.id}`}
        target="_blank"
        rel="noreferrer"
        className={clsx(
          "relative z-10 flex aspect-[4/3] w-full items-center justify-center overflow-hidden border-b bg-[var(--surface-muted)] text-center text-[11px] font-medium leading-4 text-[var(--ink-subtle)]",
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

      <div className="relative z-10 flex min-h-0 flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center gap-2">
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
              <Badge tone="slate">{getSourceLabel(listing.source)}</Badge>
            </>
          ) : (
            <span className="inline-flex rounded-full border border-[oklch(0.62_0.11_150)] bg-[oklch(0.42_0.09_150)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[oklch(0.9_0.11_150)]">
              Trattato
            </span>
          )}
        </div>

        <Link
          href={`/listings/${listing.id}`}
          target="_blank"
          rel="noreferrer"
          className={clsx(
            "mt-3 line-clamp-2 min-h-11 text-[15px] font-semibold leading-[22px] transition-colors group-hover:text-[var(--surface-accent)]",
            isTreated ? "text-[oklch(0.88_0.08_150)]" : "text-[var(--ink-strong)]",
          )}
        >
          {listing.title}
        </Link>

        <div className="mt-4 space-y-2">
          {!isTreated && mainFacts.length ? (
            <div className="flex flex-wrap gap-1.5">
              {mainFacts.map((fact) => (
                <span
                  key={`${listing.id}-grid-${fact.label}`}
                  className={clsx(
                    "rounded-full border border-[var(--line-soft)] bg-[var(--surface-muted)] px-2.5 py-1 text-[11px] text-[var(--ink-soft)]",
                    fact.strong && "font-semibold text-[var(--ink-strong)]",
                  )}
                >
                  {fact.label}
                </span>
              ))}
            </div>
          ) : null}
          {locationText ? (
            <p
              className={clsx(
                "line-clamp-2 text-xs leading-[18px] text-[var(--ink-soft)]",
                isTreated && "text-[oklch(0.8_0.05_150)]",
              )}
            >
              {locationText}
            </p>
          ) : null}
        </div>

        <div className="mt-4 space-y-1">
          {!isTreated ? (
            <p className="line-clamp-1 text-xs font-semibold text-[var(--status-warning)]">
              {getListingAttentionReason(listing)}
            </p>
          ) : null}
          <p className="text-xs text-[var(--ink-subtle)]">
            Controllato {formatDateTime(listing.lastSeenAt)}
          </p>
        </div>

        <div className="mt-auto space-y-2 pt-4">
          <ListingScoreSummary listing={listing} scoringConfig={scoringConfig} />
          <ListingActions listing={listing} isTreated={isTreated} compact />
        </div>
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
  const sortBy = readSearchParam(params.sortBy, "newest");
  const viewMode: ListingViewMode =
    readSearchParam(params.view, "list") === "grid" ? "grid" : "list";
  const normalizedSource =
    source === "all" ? "all" : normalizeListingSource(source);
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
      normalizedSource === "all" ||
      LISTING_SOURCE_OPTIONS.includes(
        normalizedSource as (typeof LISTING_SOURCE_OPTIONS)[number],
      )
        ? normalizedSource
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
    sortBy: LISTING_SORT_OPTIONS.includes(sortBy as ListingFilters["sortBy"])
      ? (sortBy as ListingFilters["sortBy"])
      : "newest",
  };

  const [listings, scoringConfig] = await Promise.all([
    getListings(filters),
    getPersistedScoringConfig(),
  ]);
  const groupByCheckedDate = shouldGroupByCheckedDate(filters.sortBy);
  const listingGroups = groupByCheckedDate
    ? groupListingsByCheckedDate(listings)
    : [{ key: "all", label: "", listings }];
  const hasActiveFilters =
    filters.sellerType !== "all" ||
    filters.status !== "all" ||
    filters.crmStatus !== "all" ||
    filters.source !== "all" ||
    filters.minDaysOnline !== null ||
    filters.minScore !== null ||
    filters.maxScore !== null ||
    filters.sortBy !== "newest" ||
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
          <input type="hidden" name="view" value={viewMode} />

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
              <optgroup label="Operativo">
                <option value="newest">Ultimo controllo, recente</option>
                <option value="checked_oldest">Da ricontrollare</option>
                <option value="incomplete_first">Dati mancanti prima</option>
                <option value="private_first">Privati prima</option>
                <option value="price_drop_first">Ribassi prima</option>
                <option value="phone_first">Telefono disponibile</option>
              </optgroup>
              <optgroup label="Valore">
                <option value="score_desc">Appetibilita, piu alta</option>
                <option value="score_asc">Appetibilita, piu bassa</option>
                <option value="price_asc">Prezzo crescente</option>
                <option value="price_desc">Prezzo decrescente</option>
                <option value="price_per_sqm_asc">Prezzo/mq crescente</option>
                <option value="price_per_sqm_desc">Prezzo/mq decrescente</option>
              </optgroup>
              <optgroup label="Tempo">
                <option value="first_seen_desc">Prima segnalazione recente</option>
                <option value="oldest">Online da piu tempo</option>
              </optgroup>
            </select>
          </label>

        </AutoSubmitFiltersForm>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4 border-t border-[var(--line-soft)] pt-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-subtle)]">
              Risultati
            </p>
            <p className="mt-1 text-2xl font-semibold leading-none text-[var(--ink-strong)]">
              {listings.length} schede complete
            </p>
          </div>
          <div className="relative z-10 grid grid-cols-2 gap-1 rounded-[8px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-1">
            <Link
              href={buildViewHref(params, "list")}
              aria-label="Vista lista"
              title="Vista lista"
              className={clsx(
                "inline-flex size-9 items-center justify-center rounded-[6px] text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]",
                viewMode === "list" &&
                  "bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]",
              )}
            >
              <List className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href={buildViewHref(params, "grid")}
              aria-label="Vista griglia"
              title="Vista griglia"
              className={clsx(
                "inline-flex size-9 items-center justify-center rounded-[6px] text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]",
                viewMode === "grid" &&
                  "bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]",
              )}
            >
              <LayoutGrid className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {listings.length ? (
          viewMode === "grid" ? (
            <div className="space-y-5">
              {listingGroups.map((group) => (
                <section key={group.key} className="space-y-3">
                  {groupByCheckedDate ? (
                    <ListingDateSeparator
                      label={group.label}
                      count={group.listings.length}
                    />
                  ) : null}
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {group.listings.map((listing) => (
                      <ListingGridCard
                        key={listing.id}
                        listing={listing}
                        scoringConfig={scoringConfig}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-5">
              {listingGroups.map((group) => (
                <section key={group.key} className="space-y-3">
                  {groupByCheckedDate ? (
                    <ListingDateSeparator
                      label={group.label}
                      count={group.listings.length}
                    />
                  ) : null}
                  <div className="space-y-4">
                    {group.listings.map((listing) => (
                      <ListingRow
                        key={listing.id}
                        listing={listing}
                        scoringConfig={scoringConfig}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )
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
