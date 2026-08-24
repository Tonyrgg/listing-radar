import { Archive, ExternalLink } from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";

import { Badge, getSellerTypeTone } from "@/components/badge";
import { ListingScoreSummary } from "@/components/listing-score";
import { LoadingAnchor, PendingSubmitButton } from "@/components/loading-controls";
import { ConfirmSubmit } from "@/components/ui/feedback";
import { Chip, Meta, Stripe, buttonClass, type Tone } from "@/components/ui/primitives";
import {
  archiveListing,
  updateListingCrmStatus,
} from "@/app/(private)/listings/[id]/actions";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPlainText,
} from "@/lib/formatting";
import { getListingStatusLabel, getSellerTypeLabel, getSourceLabel } from "@/lib/labels";
import { getListingAttentionReason } from "@/lib/listings/operational";
import type { ScoringConfig } from "@/lib/listings/scoring-config";
import type { Listing } from "@/types";

/* Le foto arrivano da host dinamici dei portali. */
/* eslint-disable @next/next/no-img-element */

export type ListingDensity = "list" | "grid";

/**
 * L'urgenza sta nella banda laterale, non nell'accento.
 * L'accento resta al solo bottone che porta avanti il lavoro.
 */
function attentionTone(listing: Listing, isTreated: boolean): Tone {
  if (isTreated) return "neutral";
  if (listing.isPriceDropped) return "warn";
  if (listing.minimumDaysOnline >= 60) return "warn";
  if (listing.sellerType === "private") return "info";
  return "neutral";
}

function pricePerSqm(listing: Listing) {
  if (listing.pricePerSqm != null) {
    return `${formatNumber(Math.round(listing.pricePerSqm))} €/mq`;
  }

  if (listing.price != null && listing.sqm) {
    return `${formatNumber(Math.round(listing.price / listing.sqm))} €/mq`;
  }

  return null;
}

function Thumb({
  listing,
  className,
}: Readonly<{ listing: Listing; className?: string }>) {
  return (
    <Link
      href={`/listings/${listing.id}`}
      className={clsx(
        "relative z-10 flex items-center justify-center overflow-hidden bg-[var(--lr-raised)]",
        "text-center text-[length:var(--lr-text-label)] text-[var(--lr-ink-3)]",
        className,
      )}
      aria-label={`Apri la scheda di ${listing.title}`}
    >
      {listing.imageUrls[0] ? (
        <img
          src={listing.imageUrls[0]}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : (
        "Foto non disponibile"
      )}
    </Link>
  );
}

function Actions({
  listing,
  isTreated,
}: Readonly<{ listing: Listing; isTreated: boolean }>) {
  const toggleCrmStatus = updateListingCrmStatus.bind(
    null,
    listing.id,
    isTreated ? "untreated" : "treated",
  );
  const archiveAction = archiveListing.bind(null, listing.id);

  return (
    <div className="relative z-10 flex flex-wrap items-center gap-2">
      <form action={toggleCrmStatus}>
        <PendingSubmitButton
          type="submit"
          pendingLabel="Aggiorno"
          className={buttonClass("quiet", { compact: true })}
        >
          {isTreated ? "Rimetti da lavorare" : "Segna trattato"}
        </PendingSubmitButton>
      </form>

      <Link
        href={`/listings/${listing.id}`}
        className={buttonClass(isTreated ? "secondary" : "primary", { compact: true })}
      >
        Apri scheda
      </Link>

      <LoadingAnchor
        href={listing.url}
        target="_blank"
        rel="noreferrer"
        aria-label="Apri l'annuncio originale sul portale"
        title="Apri l'annuncio originale sul portale"
        pendingLabel=""
        className={buttonClass("secondary", { compact: true, icon: true })}
      >
        <ExternalLink className="size-4" aria-hidden="true" />
      </LoadingAnchor>

      <form action={archiveAction}>
        <ConfirmSubmit
          title="Archiviare questo annuncio?"
          description="Sparirà dall'archivio attivo. Potrai ritrovarlo filtrando per «Archiviato», e subito dopo l'operazione avrai un «Annulla»."
          confirmLabel="Sì, archivia"
        >
          <PendingSubmitButton
            type="submit"
            aria-label="Archivia l'annuncio"
            title="Archivia l'annuncio"
            pendingLabel=""
            icon={<Archive className="size-4" aria-hidden="true" />}
            className={buttonClass("secondary", { compact: true, icon: true })}
          >
            <span className="sr-only">Archivia</span>
          </PendingSubmitButton>
        </ConfirmSubmit>
      </form>
    </div>
  );
}

/**
 * Una sola card per lista e griglia: cambia la densità, non la struttura.
 * Lo stato «trattato» si legge da tre segnali che non tolgono informazione.
 */
export function ListingCard({
  listing,
  scoringConfig,
  density = "list",
}: Readonly<{
  listing: Listing;
  scoringConfig: ScoringConfig;
  density?: ListingDensity;
}>) {
  const isTreated = listing.crmStatus === "treated";
  const tone = attentionTone(listing, isTreated);
  const location = listing.addressRaw?.trim() || listing.zone?.trim();
  const perSqm = pricePerSqm(listing);
  const isGrid = density === "grid";

  return (
    <article
      className={clsx(
        "group relative overflow-hidden rounded-[var(--lr-radius-container)] border",
        "border-[var(--lr-line)] bg-[var(--lr-surface)] transition-opacity",
        isTreated && "opacity-70 hover:opacity-100",
      )}
    >
      <Link
        href={`/listings/${listing.id}`}
        className="absolute inset-0 z-0"
        aria-label={`Apri la scheda di ${listing.title}`}
      />

      <div className={clsx("flex gap-3 p-3", isGrid && "flex-col")}>
        <Stripe tone={tone} />

        <div className={clsx("flex min-w-0 flex-1 gap-3", isGrid && "flex-col")}>
          <Thumb
            listing={listing}
            className={clsx(
              "shrink-0 rounded-[var(--lr-radius-control)]",
              isGrid ? "aspect-[4/3] w-full" : "h-24 w-32 sm:h-28 sm:w-40",
            )}
          />

          <div className="min-w-0 flex-1">
            <div className="relative z-10 flex flex-wrap items-center gap-2">
              {isTreated ? (
                <Chip tone="neutral">✓ Trattato</Chip>
              ) : (
                <Badge tone={getSellerTypeTone(listing.sellerType)}>
                  {getSellerTypeLabel(listing.sellerType)}
                </Badge>
              )}
              <Meta className="truncate">
                {getSourceLabel(listing.source)}
                {listing.status !== "new" ? ` · ${getListingStatusLabel(listing.status)}` : ""}
                {listing.isNewToday ? " · nuovo oggi" : ""}
              </Meta>
            </div>

            <Link
              href={`/listings/${listing.id}`}
              className="relative z-10 mt-1.5 block text-[length:var(--lr-text-record)] font-[650] leading-snug tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)] group-hover:underline"
            >
              <span className="line-clamp-2">{listing.title}</span>
            </Link>

            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
              <b className="font-[650] text-[var(--lr-ink)]">{formatCurrency(listing.price)}</b>
              {listing.sqm != null ? <span>{formatNumber(listing.sqm)} mq</span> : null}
              {listing.rooms != null ? <span>{formatNumber(listing.rooms)} locali</span> : null}
              {perSqm ? <span>{perSqm}</span> : null}
            </div>

            {/* Il motivo resta visibile anche a lavoro concluso: è quello che fa scegliere. */}
            <p
              className={clsx(
                "mt-1.5 text-[length:var(--lr-text-body)]",
                tone === "warn"
                  ? "text-[var(--lr-warn)]"
                  : tone === "info"
                    ? "text-[var(--lr-info)]"
                    : "text-[var(--lr-ink-3)]",
              )}
            >
              {getListingAttentionReason(listing)}
              {location ? ` · ${formatPlainText(location)}` : ""}
            </p>
          </div>

          {!isGrid ? (
            <div className="relative z-10 hidden shrink-0 xl:block">
              <ListingScoreSummary listing={listing} scoringConfig={scoringConfig} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--lr-line-quiet)] px-3 py-2">
        <Meta>Controllato {formatDateTime(listing.lastSeenAt)}</Meta>
        <div className="flex flex-wrap items-center gap-2">
          {isGrid ? (
            <div className="relative z-10">
              <ListingScoreSummary listing={listing} scoringConfig={scoringConfig} />
            </div>
          ) : null}
          <Actions listing={listing} isTreated={isTreated} />
        </div>
      </div>
    </article>
  );
}
