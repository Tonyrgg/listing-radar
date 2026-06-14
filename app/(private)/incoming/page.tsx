import Link from "next/link";
import { Image as ImageIcon } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/badge";
import { RefreshEmailButton } from "@/app/(private)/incoming/refresh-email-button";
import { getIncomingListings } from "@/lib/incoming/repository";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPlainText,
} from "@/lib/formatting";
import type { IncomingListing, IncomingListingStatus } from "@/types";

export const dynamic = "force-dynamic";

const FILTERS: Array<{
  value: IncomingListingStatus | "all";
  label: string;
}> = [
  { value: "pending", label: "Da completare" },
  { value: "enriched", label: "Completati" },
  { value: "dismissed", label: "Archiviati" },
  { value: "all", label: "Tutti" },
];

function readStatus(value: string | string[] | undefined) {
  const selected = Array.isArray(value) ? value[0] : value;
  return FILTERS.some((filter) => filter.value === selected)
    ? (selected as IncomingListingStatus | "all")
    : "pending";
}

function getIncomingTone(status: IncomingListingStatus): BadgeTone {
  switch (status) {
    case "enriched":
      return "green";
    case "error":
      return "red";
    case "dismissed":
      return "slate";
    default:
      return "amber";
  }
}

function getPortalImportUrl(listing: IncomingListing) {
  const value = listing.canonicalUrl ?? listing.url;

  try {
    const url = new URL(value);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    fragment.set("listing-radar", listing.id);
    url.hash = fragment.toString();
    return url.toString();
  } catch {
    return value;
  }
}

function IncomingCard({ listing }: Readonly<{ listing: IncomingListing }>) {
  const isEnriched = listing.status === "enriched" && listing.listingId;

  return (
    <article className="grid overflow-hidden rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] shadow-[var(--shadow-panel)] md:grid-cols-[180px_minmax(0,1fr)_auto]">
      <div
        className="flex min-h-40 items-center justify-center bg-[var(--surface-muted)] bg-cover bg-center bg-no-repeat md:min-h-full"
        style={
          listing.imageUrl
            ? { backgroundImage: `url("${listing.imageUrl}")` }
            : undefined
        }
        role={listing.imageUrl ? "img" : undefined}
        aria-label={listing.imageUrl ? listing.title : undefined}
      >
        {!listing.imageUrl ? (
          <ImageIcon
            aria-hidden="true"
            className="size-6 text-[var(--ink-subtle)]"
          />
        ) : null}
      </div>

      <div className="min-w-0 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="blue">{listing.source}</Badge>
          <Badge tone={getIncomingTone(listing.status)}>{listing.status}</Badge>
          <span className="text-xs text-[var(--ink-subtle)]">
            {formatDateTime(listing.emailReceivedAt ?? listing.createdAt)}
          </span>
        </div>
        <h3 className="mt-3 text-lg font-semibold text-[var(--ink-strong)]">
          {listing.title}
        </h3>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--ink-soft)]">
          <span className="font-semibold text-[var(--ink-strong)]">
            {formatCurrency(listing.price)}
          </span>
          <span>{formatNumber(listing.sqm)} mq</span>
          <span>{formatNumber(listing.rooms)} locali</span>
          <span>{formatPlainText(listing.zone)}</span>
        </div>
        {listing.emailSubject ? (
          <p className="mt-4 truncate text-xs text-[var(--ink-subtle)]">
            {listing.emailSubject}
          </p>
        ) : null}
      </div>

      <div className="flex items-center border-t border-[var(--line-soft)] p-5 md:border-l md:border-t-0">
        {isEnriched ? (
          <Link
            href={`/listings/${listing.listingId}`}
            className="inline-flex h-11 items-center rounded-md bg-[var(--surface-strong)] px-4 text-sm font-medium text-white"
          >
            Apri scheda
          </Link>
        ) : (
          <a
            href={getPortalImportUrl(listing)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center rounded-md bg-[var(--surface-strong)] px-4 text-sm font-medium text-white"
          >
            Apri e completa
          </a>
        )}
      </div>
    </article>
  );
}

export default async function IncomingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = readStatus(params.status);
  const listings = await getIncomingListings(status);

  return (
    <div className="space-y-8">
      <header className="space-y-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
              Inbox immobili
            </p>
            <h2 className="text-3xl font-semibold text-[var(--ink-strong)]">
              Nuovi arrivi
            </h2>
            <p className="text-sm text-[var(--ink-soft)]">
              {listings.length} segnalazioni nel filtro corrente.
            </p>
          </div>
          <RefreshEmailButton />
        </div>

        <nav
          className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap"
          aria-label="Filtra nuovi arrivi"
        >
          {FILTERS.map((filter) => (
            <Link
              key={filter.value}
              href={`/incoming?status=${filter.value}`}
              className={
                status === filter.value
                  ? "rounded-md bg-[var(--surface-strong)] px-3 py-2 text-center text-sm font-medium text-white"
                  : "rounded-md border border-[var(--line-soft)] bg-[var(--surface-panel)] px-3 py-2 text-center text-sm font-medium text-[var(--ink-soft)]"
              }
            >
              {filter.label}
            </Link>
          ))}
        </nav>
      </header>

      <section className="space-y-4">
        {listings.length ? (
          listings.map((listing) => (
            <IncomingCard key={listing.id} listing={listing} />
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--line-strong)] px-6 py-14 text-center">
            <p className="text-sm font-medium text-[var(--ink-strong)]">
              Nessun nuovo arrivo
            </p>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              Le segnalazioni email compariranno qui al prossimo controllo.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
