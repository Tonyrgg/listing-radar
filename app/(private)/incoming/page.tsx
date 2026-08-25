import Link from "next/link";
import { Archive, ArchiveRestore, ArrowRight } from "lucide-react";
import type { Metadata } from "next";

import { Chip, Card, CardHeader, EmptyState, Meta, Stripe, buttonClass } from "@/components/ui/primitives";
import { PendingSubmitButton } from "@/components/loading-controls";
import { PageHeader } from "@/components/page-header";
import { RefreshEmailButton } from "@/app/(private)/incoming/refresh-email-button";
import {
  dismissIncomingListing,
  restoreIncomingListing,
} from "@/app/(private)/incoming/actions";
import { getIncomingListings } from "@/lib/incoming/repository";
import { formatCurrency, formatNumber, formatPlainText } from "@/lib/formatting";
import { getIncomingStatusLabel, getSourceLabel } from "@/lib/labels";
import type { IncomingListing, IncomingListingStatus } from "@/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Da completare" };

const FILTERS: Array<{ value: IncomingListingStatus | "all"; label: string }> = [
  { value: "pending", label: "Da completare" },
  { value: "enriched", label: "Già completati" },
  { value: "dismissed", label: "Messi da parte" },
  { value: "all", label: "Tutti" },
];

function readStatus(value: string | string[] | undefined) {
  const selected = Array.isArray(value) ? value[0] : value;
  return FILTERS.some((filter) => filter.value === selected)
    ? (selected as IncomingListingStatus | "all")
    : "pending";
}

function statusTone(status: IncomingListingStatus) {
  if (status === "enriched") return "action" as const;
  if (status === "error") return "danger" as const;
  if (status === "dismissed") return "neutral" as const;
  return "warn" as const;
}

function portalImportUrl(listing: IncomingListing) {
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

function waitedFor(listing: IncomingListing) {
  const value = listing.emailReceivedAt ?? listing.createdAt;
  const time = value ? new Date(value).getTime() : Number.NaN;

  if (Number.isNaN(time)) return { text: "arrivato di recente", days: 0 };

  const days = Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000));

  if (days <= 0) return { text: "arrivato oggi", days };
  if (days === 1) return { text: "in attesa da ieri", days };
  return { text: `in attesa da ${days} giorni`, days };
}

function IncomingRow({
  listing,
  mostraStato = true,
}: Readonly<{ listing: IncomingListing; mostraStato?: boolean }>) {
  const isEnriched = listing.status === "enriched" && listing.listingId;
  const canDismiss = listing.status !== "dismissed" && !isEnriched;
  const canRestore = listing.status === "dismissed";
  const waited = waitedFor(listing);

  return (
    <div className="flex items-start gap-3 border-t border-[var(--lr-line-quiet)] p-3 first:border-t-0">
      <Stripe tone={isEnriched ? "neutral" : waited.days >= 2 ? "warn" : "neutral"} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* Dentro il filtro «da completare», ripeterlo su ogni riga non
            * distingue niente: si scrive solo quando la lista è mista. */}
          {mostraStato ? (
            <Chip tone={statusTone(listing.status)} dot>
              {getIncomingStatusLabel(listing.status)}
            </Chip>
          ) : null}
          <Meta className="truncate">
            {getSourceLabel(listing.source)} · {waited.text}
          </Meta>
        </div>

        <h3 className="mt-1.5 text-[length:var(--lr-text-record)] font-[650] leading-snug tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
          {listing.title}
        </h3>

        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
          <b className="font-[650] text-[var(--lr-ink)]">{formatCurrency(listing.price)}</b>
          {listing.sqm != null ? <span>{formatNumber(listing.sqm)} mq</span> : null}
          {listing.rooms != null ? <span>{formatNumber(listing.rooms)} locali</span> : null}
          {listing.zone ? <span>{formatPlainText(listing.zone)}</span> : null}
        </div>


      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {isEnriched ? (
          <Link
            href={`/listings/${listing.listingId}`}
            className={buttonClass("secondary", { compact: true })}
          >
            Vedi la scheda
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        ) : (
          <>
            {canDismiss ? (
              <form action={dismissIncomingListing}>
                <input type="hidden" name="incomingId" value={listing.id} />
                <PendingSubmitButton
                  type="submit"
                  pendingLabel="Sposto"
                  aria-label="Metti da parte"
                  title="Metti da parte"
                  icon={<Archive aria-hidden="true" className="size-4" />}
                  className={buttonClass("quiet", { compact: true, icon: true })}
                >
                  <span className="sr-only">Metti da parte</span>
                </PendingSubmitButton>
              </form>
            ) : null}
            {canRestore ? (
              <form action={restoreIncomingListing}>
                <input type="hidden" name="incomingId" value={listing.id} />
                <PendingSubmitButton
                  type="submit"
                  pendingLabel="Ripristino"
                  icon={<ArchiveRestore aria-hidden="true" className="size-4" />}
                  className={buttonClass("secondary", { compact: true })}
                >
                  Rimetti in attesa
                </PendingSubmitButton>
              </form>
            ) : null}
            <a
              href={portalImportUrl(listing)}
              target="_blank"
              rel="noreferrer"
              className={buttonClass("primary", { compact: true })}
            >
              Apri e completa
            </a>
          </>
        )}
      </div>
    </div>
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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Oggi"
        title="Annunci da completare"
        description="Segnalazioni parziali arrivate dalle email e dai siti locali. Aprile sul portale e completa la scheda."
        backHref="/dashboard"
        backLabel="Torna a Oggi"
        actions={<RefreshEmailButton />}
        nav={
          <nav className="flex gap-1 overflow-x-auto pb-0.5" aria-label="Filtra i nuovi arrivi">
            {FILTERS.map((filter) => (
              <Link
                key={filter.value}
                href={`/incoming?status=${filter.value}`}
                aria-current={status === filter.value ? "page" : undefined}
                className={
                  status === filter.value
                    ? "inline-flex min-h-9 shrink-0 items-center rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)] px-3 text-[length:var(--lr-text-meta)] font-medium text-[var(--lr-ink)] shadow-[inset_0_0_0_1px_var(--lr-line)]"
                    : "inline-flex min-h-9 shrink-0 items-center rounded-[var(--lr-radius-control)] px-3 text-[length:var(--lr-text-meta)] font-medium text-[var(--lr-ink-2)] transition-colors hover:bg-[var(--lr-raised)] hover:text-[var(--lr-ink)]"
                }
              >
                {filter.label}
              </Link>
            ))}
          </nav>
        }
      />

      <Card>
        <CardHeader
          title={status === "pending" ? "In attesa" : FILTERS.find((f) => f.value === status)?.label ?? "Tutti"}
          meta={`${listings.length} ${listings.length === 1 ? "annuncio" : "annunci"}`}
        />
        {listings.length ? (
          <div>
            {listings.map((listing) => (
              <IncomingRow key={listing.id} listing={listing} mostraStato={status === "all"} />
            ))}
          </div>
        ) : (
          <EmptyState
            title={
              status === "pending"
                ? "Hai completato tutta la coda"
                : "Non c'è niente in questa sezione"
            }
            description={
              status === "pending"
                ? "Nessuna segnalazione da completare. Il controllo automatico parte da solo; puoi anche lanciarlo adesso."
                : "Prova un'altra sezione: gli annunci potrebbero trovarsi fra quelli in attesa o già completati."
            }
            action={
              status === "pending" ? (
                <RefreshEmailButton />
              ) : (
                <Link
                  href="/incoming?status=pending"
                  className={buttonClass("secondary", { compact: true })}
                >
                  Vai a quelli da completare
                </Link>
              )
            }
          />
        )}
      </Card>
    </div>
  );
}
