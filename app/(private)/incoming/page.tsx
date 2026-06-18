import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";

import { Badge, type BadgeTone } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { RefreshEmailButton } from "@/app/(private)/incoming/refresh-email-button";
import { getIncomingListings } from "@/lib/incoming/repository";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
} from "@/lib/formatting";
import {
  getIncomingStatusLabel,
  getSourceLabel,
} from "@/lib/labels";
import type { IncomingListing, IncomingListingStatus } from "@/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Annunci da completare",
};

const FILTERS: Array<{
  value: IncomingListingStatus | "all";
  label: string;
}> = [
  { value: "pending", label: "In attesa" },
  { value: "enriched", label: "Completati" },
  { value: "dismissed", label: "Messi da parte" },
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
    <article className="grid gap-4 border-b border-[var(--line-soft)] py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="blue">{getSourceLabel(listing.source)}</Badge>
          <Badge tone={getIncomingTone(listing.status)}>
            {getIncomingStatusLabel(listing.status)}
          </Badge>
          <span className="text-xs text-[var(--ink-subtle)]">
            {formatDateTime(listing.emailReceivedAt ?? listing.createdAt)}
          </span>
        </div>
        <h3 className="mt-2 text-base font-semibold text-[var(--ink-strong)]">
          {listing.title}
        </h3>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--ink-soft)]">
          <span className="font-semibold text-[var(--ink-strong)]">
            {formatCurrency(listing.price)}
          </span>
          {listing.sqm != null ? (
            <span>{formatNumber(listing.sqm)} mq</span>
          ) : null}
          {listing.rooms != null ? (
            <span>{formatNumber(listing.rooms)} locali</span>
          ) : null}
          {listing.zone ? <span>{listing.zone}</span> : null}
        </div>
        {listing.emailSubject ? (
          <p className="mt-4 line-clamp-2 text-xs leading-5 text-[var(--ink-subtle)]">
            Segnalazione ricevuta: {listing.emailSubject}
          </p>
        ) : null}
      </div>

      <div className="flex items-center">
        {isEnriched ? (
          <Link
            href={`/listings/${listing.listingId}`}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[6px] border border-[var(--line-strong)] px-4 text-sm font-medium text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)] md:w-auto"
          >
            Vedi scheda completa
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        ) : (
          <a
            href={getPortalImportUrl(listing)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[6px] bg-[var(--surface-accent)] px-4 text-sm font-semibold text-[var(--button-ink)] transition-colors hover:bg-[var(--surface-accent-hover)] md:w-auto"
          >
            Apri e completa la scheda
            <ArrowRight aria-hidden="true" className="size-4" />
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
    <div className="space-y-6">
      <div className="space-y-5">
        <PageHeader
          eyebrow="Passaggio 1"
          title="Annunci da completare"
          description={`${listings.length} annunci nella sezione selezionata.`}
          actions={<RefreshEmailButton />}
        />

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
                  ? "rounded-md bg-[var(--surface-accent-soft)] px-3 py-2 text-center text-sm font-medium text-[var(--surface-accent)]"
                  : "rounded-md border border-[var(--line-soft)] bg-[var(--surface-panel)] px-3 py-2 text-center text-sm font-medium text-[var(--ink-soft)]"
              }
            >
              {filter.label}
            </Link>
          ))}
        </nav>
      </div>

      <section className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)] px-4">
        {listings.length ? (
          listings.map((listing) => (
            <IncomingCard key={listing.id} listing={listing} />
          ))
        ) : (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-medium text-[var(--ink-strong)]">
              Non ci sono annunci in questa sezione
            </p>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              Prova un&apos;altra sezione oppure cerca nuovi annunci.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
