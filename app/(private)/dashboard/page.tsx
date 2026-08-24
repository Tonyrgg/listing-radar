import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { RefreshEmailButton } from "@/app/(private)/incoming/refresh-email-button";
import { Badge, getSellerTypeTone } from "@/components/badge";
import { ListingScoreSummary } from "@/components/listing-score";
import { PageHeader } from "@/components/page-header";
import { QuickRequestButton } from "@/components/matching/quick-request";
import {
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Label,
  Meta,
  Stripe,
  buttonClass,
} from "@/components/ui/primitives";
import { getDashboardSummary, getLastScrapeRun } from "@/lib/data/repository";
import { getEmailAlertsConfig } from "@/lib/email-alerts/config";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPlainText,
} from "@/lib/formatting";
import { getIncomingDashboardData } from "@/lib/incoming/repository";
import { getSellerTypeLabel, getSourceLabel } from "@/lib/labels";
import { getListingAttentionReason } from "@/lib/listings/operational";
import { readNow } from "@/lib/clock";
import { getNextAction } from "@/lib/next-action";
import { getPersistedScoringConfig } from "@/lib/settings/scoring-config-repository";
import type { IncomingListing, Listing } from "@/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Oggi" };

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

  if (Number.isNaN(time)) return "arrivato di recente";

  const days = Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000));

  if (days <= 0) return "arrivato oggi";
  if (days === 1) return "in attesa da ieri";
  return `in attesa da ${days} giorni`;
}

function QueueRow({
  listing,
  now,
}: Readonly<{ listing: IncomingListing; now: number }>) {
  const receivedAt = listing.emailReceivedAt ?? listing.createdAt;
  const receivedTime = receivedAt ? new Date(receivedAt).getTime() : Number.NaN;
  const days = Number.isNaN(receivedTime)
    ? 0
    : Math.floor((now - receivedTime) / (24 * 60 * 60 * 1000));

  return (
    <div className="flex items-start gap-3 border-t border-[var(--lr-line-quiet)] p-3 first:border-t-0">
      <Stripe tone={days >= 2 ? "warn" : "neutral"} />
      <div className="min-w-0 flex-1">
        <p className="text-[length:var(--lr-text-record)] font-[650] leading-snug tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
          <span className="line-clamp-2">{listing.title}</span>
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
          <b className="font-[650] text-[var(--lr-ink)]">{formatCurrency(listing.price)}</b>
          {listing.sqm != null ? <span>{formatNumber(listing.sqm)} mq</span> : null}
          {listing.zone ? <span>{formatPlainText(listing.zone)}</span> : null}
        </div>
        <Meta className="mt-1">
          {getSourceLabel(listing.source)} · {waitedFor(listing)}
        </Meta>
      </div>
      <a
        href={portalImportUrl(listing)}
        target="_blank"
        rel="noreferrer"
        className={buttonClass("secondary", { compact: true })}
      >
        Completa
      </a>
    </div>
  );
}

function OpportunityRow({
  listing,
  scoringConfig,
}: Readonly<{
  listing: Listing;
  scoringConfig: Awaited<ReturnType<typeof getPersistedScoringConfig>>;
}>) {
  return (
    <div className="flex items-start gap-3 border-t border-[var(--lr-line-quiet)] p-3 first:border-t-0">
      <Stripe tone={listing.isPriceDropped ? "warn" : "neutral"} />
      <Link
        href={`/listings/${listing.id}`}
        className="block h-16 w-24 shrink-0 overflow-hidden rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)]"
        aria-label={`Apri la scheda di ${listing.title}`}
      >
        {listing.imageUrls[0] ? (
          <span
            className="block size-full bg-cover bg-center"
            style={{ backgroundImage: `url("${listing.imageUrls[0]}")` }}
          />
        ) : (
          <span className="grid size-full place-items-center px-2 text-center text-[length:var(--lr-text-label)] text-[var(--lr-ink-3)]">
            Foto non disponibile
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={getSellerTypeTone(listing.sellerType)}>
            {getSellerTypeLabel(listing.sellerType)}
          </Badge>
          <Meta className="truncate">{getSourceLabel(listing.source)}</Meta>
        </div>
        <Link
          href={`/listings/${listing.id}`}
          className="mt-1 block truncate text-[length:var(--lr-text-record)] font-[650] tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)] hover:underline"
        >
          {listing.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
          <b className="font-[650] text-[var(--lr-ink)]">{formatCurrency(listing.price)}</b>
          {listing.sqm != null ? <span>{formatNumber(listing.sqm)} mq</span> : null}
          <span
            className={
              listing.isPriceDropped ? "text-[var(--lr-warn)]" : "text-[var(--lr-ink-3)]"
            }
          >
            {getListingAttentionReason(listing)}
          </span>
        </div>
      </div>
      <div className="shrink-0">
        <ListingScoreSummary listing={listing} scoringConfig={scoringConfig} />
      </div>
    </div>
  );
}

export default async function TodayPage() {
  await connection();

  const [summary, incoming, lastScrapeRun, scoringConfig, now] = await Promise.all([
    getDashboardSummary(),
    getIncomingDashboardData(),
    getLastScrapeRun(),
    getPersistedScoringConfig(),
    readNow(),
  ]);

  const emailConfig = getEmailAlertsConfig();
  const opportunities = summary.watchlist.slice(0, 4);
  const lastEmailCheckAt = incoming.lastEmailCheck?.processedAt ?? null;
  const lastRunHadErrors = Boolean(lastScrapeRun?.errorCount);

  const next = getNextAction({
    pendingListings: incoming.pendingListings,
    pendingCount: incoming.pendingCount,
    opportunities,
    lastEmailCheckAt,
    emailEnabled: emailConfig.enabled,
    lastRunHadErrors,
  });

  const today = new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(now));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={today.charAt(0).toUpperCase() + today.slice(1)}
        title="Oggi"
        actions={
          <>
            <Chip tone={lastRunHadErrors ? "warn" : "neutral"} dot>
              {lastRunHadErrors ? "Una fonte da controllare" : "Tutto in funzione"}
            </Chip>
            <RefreshEmailButton />
            <QuickRequestButton />
          </>
        }
      />

      {/* Una sola cosa grida per schermata: è questa. */}
      <Card className="p-5">
        <Label tone="action">Da fare adesso</Label>
        <h2 className="mt-2 max-w-2xl text-[length:var(--lr-text-section)] font-[650] leading-tight tracking-[var(--lr-tracking-title)] text-balance text-[var(--lr-ink)]">
          {next.title}
        </h2>
        <p className="mt-2 max-w-prose text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
          {next.reason}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={next.href} className={buttonClass("primary")}>
            {next.actionLabel}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          {next.secondaryHref && next.secondaryLabel ? (
            <Link href={next.secondaryHref} className={buttonClass("quiet")}>
              {next.secondaryLabel}
            </Link>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
        <Card>
          <CardHeader
            title="La coda"
            meta={
              incoming.pendingCount
                ? `${incoming.pendingCount} in attesa · ${incoming.recentCount} arrivati oggi`
                : "Nessuna segnalazione in attesa"
            }
            action={
              incoming.pendingListings.length ? (
                <Link href="/incoming" className={buttonClass("quiet", { compact: true })}>
                  Vedi tutti
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              ) : null
            }
          />
          {incoming.pendingListings.length ? (
            <div>
              {incoming.pendingListings.slice(0, 5).map((listing) => (
                <QueueRow key={listing.id} listing={listing} now={now} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="La coda è vuota"
              description={
                lastEmailCheckAt
                  ? `Nessuna segnalazione da completare. L'ultimo controllo delle email è delle ${new Intl.DateTimeFormat(
                      "it-IT",
                      { hour: "2-digit", minute: "2-digit" },
                    ).format(new Date(lastEmailCheckAt))} e il prossimo parte da solo.`
                  : "Nessuna segnalazione da completare. Il controllo automatico parte da solo."
              }
              action={<RefreshEmailButton />}
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Occasioni da valutare"
            meta={`${summary.highPriority} in evidenza`}
            action={
              opportunities.length ? (
                <Link
                  href="/listings?onlyHighPriority=on&sortBy=score_desc"
                  className={buttonClass("quiet", { compact: true })}
                >
                  Tutte
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              ) : null
            }
          />
          {opportunities.length ? (
            <div>
              {opportunities.map((listing) => (
                <OpportunityRow
                  key={listing.id}
                  listing={listing}
                  scoringConfig={scoringConfig}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nessuna occasione in evidenza"
              description="Nessuna scheda supera oggi la soglia di appetibilità. La soglia si regola dalle impostazioni."
              action={
                <Link href="/settings" className={buttonClass("secondary", { compact: true })}>
                  Regola la soglia
                </Link>
              }
            />
          )}
        </Card>
      </div>

      {/* Le statistiche rassicurano, non decidono: stanno in fondo, su una riga. */}
      <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
          <Meta>
            Email{" "}
            {emailConfig.enabled
              ? lastEmailCheckAt
                ? formatDateTime(lastEmailCheckAt)
                : "attive"
              : "non configurate"}
          </Meta>
          <Meta>
            Siti locali{" "}
            {lastScrapeRun
              ? formatDateTime(lastScrapeRun.finishedAt ?? lastScrapeRun.startedAt)
              : "mai controllati"}
          </Meta>
          <Meta className={lastRunHadErrors ? "text-[var(--lr-warn)]" : undefined}>
            {lastRunHadErrors
              ? `${formatNumber(lastScrapeRun?.errorCount ?? 0)} problemi nell'ultimo giro`
              : "Nessun problema rilevato"}
          </Meta>
        </div>
        <Link href="/settings" className={buttonClass("quiet", { compact: true })}>
          Dettagli
        </Link>
      </Card>
    </div>
  );
}
