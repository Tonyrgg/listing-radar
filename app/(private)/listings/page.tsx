import type { Metadata } from "next";
import Link from "next/link";
import { clsx } from "clsx";
import { LayoutGrid, List, RotateCcw, SlidersHorizontal } from "lucide-react";

import { AutoSubmitFiltersForm } from "@/components/auto-submit-filters-form";
import { ListingCard } from "@/components/listing-card";
import { PageHeader } from "@/components/page-header";
import { Card, Chip, EmptyState, buttonClass } from "@/components/ui/primitives";
import {
  LISTING_SOURCE_OPTIONS,
  LISTING_STATUS_OPTIONS,
  SELLER_TYPE_OPTIONS,
} from "@/lib/constants";
import { getDuplicateSiblings, getListings } from "@/lib/data/repository";
import { formatDate } from "@/lib/formatting";
import {
  getListingStatusLabel,
  getSellerTypeLabel,
  getSourceLabel,
} from "@/lib/labels";
import { normalizeListingSource } from "@/lib/listing-sources";
import { getPersistedScoringConfig } from "@/lib/settings/scoring-config-repository";
import type { Listing, ListingFilters, SellerType } from "@/types";

export const metadata: Metadata = {
  title: "Immobili",
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

function readSearchParam(
  value: string | string[] | undefined,
  fallback: string,
) {
  if (Array.isArray(value)) {
    return value[0] ?? fallback;
  }

  return value ?? fallback;
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
      <div className="h-px min-w-6 flex-1 bg-[var(--lr-line-quiet)]" aria-hidden="true" />
      <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--lr-ink-3)]">
        Controllo: {label}
      </p>
      <span className="shrink-0 text-[11px] text-[var(--lr-ink-3)]">
        {count === 1 ? "1 annuncio" : `${count} annunci`}
      </span>
      <div className="h-px min-w-6 flex-1 bg-[var(--lr-line-quiet)]" aria-hidden="true" />
    </div>
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
  /* Un solo controllo al posto dei due interruttori che si annullavano a vicenda.
   * I vecchi parametri restano validi per non rompere i collegamenti salvati. */
  const legacyTreated = readSearchParam(params.onlyTreated, "") === "on";
  const legacyUntreated = readSearchParam(params.onlyUntreated, "") === "on";
  const workStateParam = readSearchParam(params.lavorazione, "");
  const workState: "all" | "treated" | "untreated" =
    workStateParam === "treated" || workStateParam === "untreated"
      ? workStateParam
      : legacyTreated === legacyUntreated
        ? "all"
        : legacyTreated
          ? "treated"
          : "untreated";
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
    crmStatus: workState,
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
  /* Una query sola per tutta la lista: chi ha la stessa casa altrove. */
  const duplicates = await getDuplicateSiblings(listings);
  const groupByCheckedDate = shouldGroupByCheckedDate(filters.sortBy);
  const listingGroups = groupByCheckedDate
    ? groupListingsByCheckedDate(listings)
    : [{ key: "all", label: "", listings }];
  /* «Altri filtri» si apre da solo solo se qualcosa dentro è davvero attivo. */
  const advancedCount = [
    filters.sellerType !== "all",
    filters.status !== "all",
    filters.source !== "all",
    filters.minDaysOnline !== null,
    filters.minScore !== null,
    filters.maxScore !== null,
    filters.onlyHighPriority,
  ].filter(Boolean).length;
  const hasActiveFilters =
    advancedCount > 0 || workState !== "all" || filters.sortBy !== "newest";
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Immobili"
        title="Archivio annunci"
        description={`${listings.length} schede complete, ordinate per ${sortLabel(filters.sortBy)}.`}
        actions={
          <div className="flex items-center gap-1 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] p-1">
            <Link
              href={buildViewHref(params, "list")}
              aria-label="Vista a lista"
              title="Vista a lista"
              aria-current={viewMode === "list" ? "true" : undefined}
              className={clsx(
                "inline-flex size-9 items-center justify-center rounded-[3px] transition-colors",
                viewMode === "list"
                  ? "bg-[var(--lr-raised)] text-[var(--lr-ink)]"
                  : "text-[var(--lr-ink-3)] hover:text-[var(--lr-ink)]",
              )}
            >
              <List className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href={buildViewHref(params, "grid")}
              aria-label="Vista a griglia"
              title="Vista a griglia"
              aria-current={viewMode === "grid" ? "true" : undefined}
              className={clsx(
                "inline-flex size-9 items-center justify-center rounded-[3px] transition-colors",
                viewMode === "grid"
                  ? "bg-[var(--lr-raised)] text-[var(--lr-ink)]"
                  : "text-[var(--lr-ink-3)] hover:text-[var(--lr-ink)]",
              )}
            >
              <LayoutGrid className="size-4" aria-hidden="true" />
            </Link>
          </div>
        }
      />

      {/* I filtri non precedono più il lavoro: due in vista, il resto a richiesta. */}
      <AutoSubmitFiltersForm className="space-y-3">
        <input type="hidden" name="view" value={viewMode} />

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Ordina per" className="min-w-56 flex-1">
            <select name="sortBy" defaultValue={filters.sortBy} className={fieldControl}>
              <optgroup label="Operativo">
                <option value="newest">Ultimo controllo, recente</option>
                <option value="checked_oldest">Da ricontrollare</option>
                <option value="incomplete_first">Dati mancanti prima</option>
                <option value="private_first">Privati prima</option>
                <option value="price_drop_first">Ribassi prima</option>
                <option value="phone_first">Con recapito prima</option>
              </optgroup>
              <optgroup label="Valore">
                <option value="score_desc">Appetibilità, più alta</option>
                <option value="score_asc">Appetibilità, più bassa</option>
                <option value="price_asc">Prezzo crescente</option>
                <option value="price_desc">Prezzo decrescente</option>
                <option value="price_per_sqm_asc">Prezzo al mq crescente</option>
                <option value="price_per_sqm_desc">Prezzo al mq decrescente</option>
              </optgroup>
              <optgroup label="Tempo">
                <option value="first_seen_desc">Prima segnalazione recente</option>
                <option value="oldest">Online da più tempo</option>
              </optgroup>
            </select>
          </Field>

          <Field label="Lavorazione" className="min-w-48 flex-1">
            <select name="lavorazione" defaultValue={workState} className={fieldControl}>
              <option value="all">Tutti</option>
              <option value="untreated">Solo da lavorare</option>
              <option value="treated">Solo trattati</option>
            </select>
          </Field>

          {hasActiveFilters ? (
            <Link href="/listings" className={buttonClass("quiet", { compact: true })}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Azzera filtri
            </Link>
          ) : null}
        </div>

        <details
          open={advancedCount > 0}
          className="rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)]"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink)] marker:hidden">
            <SlidersHorizontal className="size-4 text-[var(--lr-ink-3)]" aria-hidden="true" />
            Altri filtri
            {advancedCount ? <Chip tone="info">{advancedCount} attivi</Chip> : null}
          </summary>

          <div className="grid gap-3 border-t border-[var(--lr-line-quiet)] p-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Pubblicato da">
              <select name="sellerType" defaultValue={filters.sellerType} className={fieldControl}>
                {SELLER_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {getSellerTypeLabel(option)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Situazione">
              <select name="status" defaultValue={filters.status} className={fieldControl}>
                {LISTING_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {getListingStatusLabel(option)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Sito di origine">
              <select name="source" defaultValue={filters.source} className={fieldControl}>
                <option value="all">Tutti</option>
                {LISTING_SOURCE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {getSourceLabel(option)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Online da almeno" hint="giorni">
              <input
                type="number"
                name="minDaysOnline"
                min="0"
                placeholder="es. 30"
                defaultValue={filters.minDaysOnline ?? ""}
                className={fieldControl}
              />
            </Field>

            <Field label="Appetibilità minima" hint="da 0 a 100">
              <input
                type="number"
                name="minScore"
                min="0"
                max="100"
                defaultValue={filters.minScore ?? ""}
                className={fieldControl}
              />
            </Field>

            <Field label="Appetibilità massima" hint="da 0 a 100">
              <input
                type="number"
                name="maxScore"
                min="0"
                max="100"
                defaultValue={filters.maxScore ?? ""}
                className={fieldControl}
              />
            </Field>

            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] px-3">
              <input
                type="checkbox"
                name="onlyHighPriority"
                defaultChecked={filters.onlyHighPriority}
                className="size-4 accent-[var(--lr-accent)]"
              />
              <span className="text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
                Solo quelli in evidenza
              </span>
            </label>
          </div>
        </details>
      </AutoSubmitFiltersForm>

      {listings.length ? (
        <div className="space-y-5">
          {listingGroups.map((group) => (
            <section key={group.key} className="space-y-3">
              {groupByCheckedDate ? (
                <ListingDateSeparator label={group.label} count={group.listings.length} />
              ) : null}
              <div
                className={
                  viewMode === "grid"
                    ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                    : "space-y-3"
                }
              >
                {group.listings.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    scoringConfig={scoringConfig}
                    density={viewMode}
                    duplicate={duplicates.get(listing.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            title="Nessun annuncio con questi filtri"
            description="Prova ad allargare la ricerca: potrebbero esserci schede escluse da un filtro attivo."
            action={
              <Link href="/listings" className={buttonClass("primary", { compact: true })}>
                Mostra tutto l&apos;archivio
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}

const fieldControl =
  "min-h-11 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none";

function Field({
  label,
  hint,
  className,
  children,
}: Readonly<{
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}>) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 flex items-baseline gap-2">
        <span className="text-[length:var(--lr-text-label)] font-[650] uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
          {label}
        </span>
        {hint ? (
          <span className="text-[length:var(--lr-text-label)] text-[var(--lr-ink-3)]">{hint}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function sortLabel(sortBy: ListingFilters["sortBy"]) {
  const labels: Record<string, string> = {
    newest: "ultimo controllo",
    checked_oldest: "da ricontrollare",
    incomplete_first: "dati mancanti",
    private_first: "privati prima",
    price_drop_first: "ribassi prima",
    phone_first: "recapito disponibile",
    score_desc: "appetibilità più alta",
    score_asc: "appetibilità più bassa",
    price_asc: "prezzo crescente",
    price_desc: "prezzo decrescente",
    price_per_sqm_asc: "prezzo al mq crescente",
    price_per_sqm_desc: "prezzo al mq decrescente",
    first_seen_desc: "prima segnalazione",
    oldest: "anzianità",
  };

  return labels[String(sortBy ?? "newest")] ?? "ultimo controllo";
}
