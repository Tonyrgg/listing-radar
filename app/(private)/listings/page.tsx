import Link from "next/link";
import { Image as ImageIcon } from "lucide-react";

import { Badge, getSellerTypeTone, getStatusTone } from "@/components/badge";
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
import type { ListingFilters, SellerType } from "@/types";

function readSearchParam(
  value: string | string[] | undefined,
  fallback: string,
) {
  if (Array.isArray(value)) {
    return value[0] ?? fallback;
  }

  return value ?? fallback;
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
    source: source === "all" || LISTING_SOURCE_OPTIONS.includes(source as (typeof LISTING_SOURCE_OPTIONS)[number])
      ? source
      : "all",
    minDaysOnline:
      typeof minDaysOnline === "number" && !Number.isNaN(minDaysOnline)
        ? minDaysOnline
        : null,
    onlyHighPriority: readSearchParam(params.onlyHighPriority, "") === "on",
  };

  const listings = await getListings(filters);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
          Archivio annunci
        </p>
        <h2 className="text-3xl font-semibold text-[var(--ink-strong)]">
          Elenco operativo
        </h2>
        <p className="text-sm leading-6 text-[var(--ink-soft)]">
          {listings.length} risultati nel perimetro corrente.
        </p>
      </header>

      <section className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[var(--shadow-panel)]">
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <label className="space-y-2 text-sm text-[var(--ink-soft)]">
            <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Seller type
            </span>
            <select
              name="sellerType"
              defaultValue={filters.sellerType}
              className="h-11 w-full rounded-md border border-[var(--line-soft)] bg-[var(--surface-canvas)] px-3 text-[var(--ink-strong)]"
            >
              {SELLER_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm text-[var(--ink-soft)]">
            <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Status
            </span>
            <select
              name="status"
              defaultValue={filters.status}
              className="h-11 w-full rounded-md border border-[var(--line-soft)] bg-[var(--surface-canvas)] px-3 text-[var(--ink-strong)]"
            >
              {LISTING_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm text-[var(--ink-soft)]">
            <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Fonte
            </span>
            <select
              name="source"
              defaultValue={filters.source}
              className="h-11 w-full rounded-md border border-[var(--line-soft)] bg-[var(--surface-canvas)] px-3 text-[var(--ink-strong)]"
            >
              <option value="all">all</option>
              {LISTING_SOURCE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm text-[var(--ink-soft)]">
            <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Min days online
            </span>
            <input
              type="number"
              name="minDaysOnline"
              min="0"
              defaultValue={filters.minDaysOnline ?? ""}
              className="h-11 w-full rounded-md border border-[var(--line-soft)] bg-[var(--surface-canvas)] px-3 text-[var(--ink-strong)]"
            />
          </label>

          <label className="flex items-end gap-3 rounded-md border border-[var(--line-soft)] bg-[var(--surface-canvas)] px-3 py-3 text-sm text-[var(--ink-soft)]">
            <input
              type="checkbox"
              name="onlyHighPriority"
              defaultChecked={filters.onlyHighPriority}
              className="size-4 rounded border-[var(--line-strong)]"
            />
            <span>Only high priority</span>
          </label>

          <div className="flex items-end gap-3">
            <button
              type="submit"
              className="h-11 rounded-md bg-[var(--surface-strong)] px-4 text-sm font-medium text-white"
            >
              Applica filtri
            </button>
            <Link
              href="/listings"
              className="h-11 rounded-md border border-[var(--line-soft)] px-4 text-sm font-medium leading-[44px] text-[var(--ink-soft)]"
            >
              Reset
            </Link>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] shadow-[var(--shadow-panel)]">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--surface-muted)] text-xs uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Foto</th>
                <th className="px-4 py-3 font-semibold">Titolo</th>
                <th className="px-4 py-3 font-semibold">Fonte</th>
                <th className="px-4 py-3 font-semibold">Prezzo</th>
                <th className="px-4 py-3 font-semibold">MQ</th>
                <th className="px-4 py-3 font-semibold">Prezzo/MQ</th>
                <th className="px-4 py-3 font-semibold">Zona</th>
                <th className="px-4 py-3 font-semibold">Seller type</th>
                <th className="px-4 py-3 font-semibold">Giorni online minimi</th>
                <th className="px-4 py-3 font-semibold">Priority score</th>
                <th className="px-4 py-3 font-semibold">Seller fatigue</th>
                <th className="px-4 py-3 font-semibold">Stato</th>
                <th className="px-4 py-3 font-semibold">Ultimo controllo</th>
                <th className="px-4 py-3 font-semibold">Link dettaglio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line-soft)]">
              {listings.map((listing) => (
                <tr key={listing.id} className="align-top">
                  <td className="px-4 py-3">
                    <Link
                      href={`/listings/${listing.id}`}
                      className="flex size-16 items-center justify-center overflow-hidden rounded-md border border-[var(--line-soft)] bg-[var(--surface-muted)] bg-cover bg-center"
                      style={
                        listing.imageUrls[0]
                          ? {
                              backgroundImage: `url("${listing.imageUrls[0]}")`,
                            }
                          : undefined
                      }
                      aria-label={`Apri ${listing.title}`}
                    >
                      {!listing.imageUrls[0] ? (
                        <ImageIcon
                          aria-hidden="true"
                          className="size-5 text-[var(--ink-subtle)]"
                        />
                      ) : null}
                    </Link>
                  </td>
                  <td className="px-4 py-4">
                    <Link
                      href={`/listings/${listing.id}`}
                      className="font-medium text-[var(--ink-strong)] hover:underline"
                    >
                      {listing.title}
                    </Link>
                  </td>
                  <td className="px-4 py-4 text-[var(--ink-soft)]">{listing.source}</td>
                  <td className="px-4 py-4 text-[var(--ink-strong)]">
                    {formatCurrency(listing.price)}
                  </td>
                  <td className="px-4 py-4 text-[var(--ink-soft)]">
                    {formatNumber(listing.sqm)}
                  </td>
                  <td className="px-4 py-4 text-[var(--ink-soft)]">
                    {formatCurrency(listing.pricePerSqm)}
                  </td>
                  <td className="px-4 py-4 text-[var(--ink-soft)]">
                    {formatPlainText(listing.zone)}
                  </td>
                  <td className="px-4 py-4">
                    <Badge tone={getSellerTypeTone(listing.sellerType)}>
                      {listing.sellerType}
                    </Badge>
                  </td>
                  <td className="px-4 py-4 text-[var(--ink-soft)]">
                    {formatNumber(listing.minimumDaysOnline)}
                  </td>
                  <td className="px-4 py-4 text-[var(--ink-strong)]">
                    {formatNumber(listing.priorityScore)}
                  </td>
                  <td className="px-4 py-4 text-[var(--ink-soft)]">
                    {formatNumber(listing.sellerFatigueScore)}
                  </td>
                  <td className="px-4 py-4">
                    <Badge tone={getStatusTone(listing.status)}>{listing.status}</Badge>
                  </td>
                  <td className="px-4 py-4 text-[var(--ink-soft)]">
                    {formatDateTime(listing.lastSeenAt)}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-2">
                      <Link
                        href={`/listings/${listing.id}`}
                        className="font-medium text-[var(--surface-accent)] hover:underline"
                      >
                        Apri scheda
                      </Link>
                      <a
                        href={listing.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--ink-soft)] hover:underline"
                      >
                        Fonte
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
