import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { RefreshEmailButton } from "@/app/(private)/incoming/refresh-email-button";
import { Badge, getSellerTypeTone } from "@/components/badge";
import { ListingScoreSummary } from "@/components/listing-score";
import { PageHeader } from "@/components/page-header";
import { QuickRequestButton } from "@/components/matching/quick-request";
import { getDashboardSummary, getLastScrapeRun } from "@/lib/data/repository";
import { getEmailAlertsConfig } from "@/lib/email-alerts/config";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPlainText,
} from "@/lib/formatting";
import { getIncomingDashboardData } from "@/lib/incoming/repository";
import {
  getRunStatusLabel,
  getSellerTypeLabel,
  getSourceLabel,
} from "@/lib/labels";
import type { ScoringConfig } from "@/lib/listings/scoring-config";
import { getScraperRuntimeConfig } from "@/lib/scrapers/config";
import { getPersistedScoringConfig } from "@/lib/settings/scoring-config-repository";
import type { IncomingListing, Listing } from "@/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Inizio",
};

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

function getOpportunityReason(listing: Listing) {
  if (listing.isPriceDropped) return "Prezzo ridotto";
  if (listing.sellerType === "private") return "Privato probabile";
  if (listing.minimumDaysOnline >= 60) return `${listing.minimumDaysOnline} giorni online`;
  if (listing.isNewToday) return "Nuovo oggi";
  if (listing.phone) return "Telefono visibile";
  return "Da valutare";
}

function TextLines({ rows = 4 }: Readonly<{ rows?: number }>) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <span
          key={index}
          className="block h-1.5 rounded-full bg-[var(--line-soft)]"
          style={{ width: `${92 - index * 11}%` }}
        />
      ))}
    </div>
  );
}

function SummaryCard({
  value,
  label,
  detail,
}: Readonly<{
  value: number;
  label: string;
  detail: string;
}>) {
  return (
    <article className="rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4">
      <p className="text-3xl font-semibold tracking-[-0.03em] text-[var(--ink-strong)]">
        {formatNumber(value)}
      </p>
      <div className="mt-3 min-w-0">
        <p className="text-sm font-semibold text-[var(--ink-strong)]">{label}</p>
        <p className="mt-1 text-xs font-medium text-[var(--surface-accent)]">
          {detail}
        </p>
      </div>
    </article>
  );
}

function SectionCard({
  title,
  action,
  children,
}: Readonly<{
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}>) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface-panel)]">
      <div className="flex min-h-12 items-center justify-between gap-4 border-b border-[var(--line-soft)] px-4">
        <h2 className="text-sm font-semibold text-[var(--ink-strong)]">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyState({ text }: Readonly<{ text: string }>) {
  return (
    <div className="min-h-36 rounded-[6px] bg-[var(--surface-muted)] p-4">
      <div className="max-w-xs">
        <p className="text-sm font-medium text-[var(--ink-strong)]">{text}</p>
        <div className="mt-5 max-w-64">
          <TextLines rows={5} />
        </div>
      </div>
    </div>
  );
}

function IncomingRow({ listing }: Readonly<{ listing: IncomingListing }>) {
  return (
    <article className="grid gap-2 border-t border-[var(--line-soft)] py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="blue">{getSourceLabel(listing.source)}</Badge>
        <span className="text-xs text-[var(--ink-subtle)]">
          {formatDateTime(listing.emailReceivedAt ?? listing.createdAt)}
        </span>
      </div>
      <Link
        href={getPortalImportUrl(listing)}
        target="_blank"
        className="line-clamp-2 text-sm font-semibold leading-5 text-[var(--ink-strong)] hover:text-[var(--surface-accent)]"
      >
        {listing.title}
      </Link>
      <p className="text-xs text-[var(--ink-soft)]">
        {formatCurrency(listing.price)}
        {listing.sqm ? ` - ${formatNumber(listing.sqm)} mq` : ""}
        {listing.zone ? ` - ${listing.zone}` : ""}
      </p>
    </article>
  );
}

function OpportunityRow({
  listing,
  scoringConfig,
}: Readonly<{ listing: Listing; scoringConfig: ScoringConfig }>) {
  return (
    <article className="grid gap-3 border-t border-[var(--line-soft)] py-3 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="grid min-w-0 gap-3 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-center">
        <Link
          href={`/listings/${listing.id}`}
          target="_blank"
          rel="noreferrer"
          className="block h-24 overflow-hidden rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] transition-colors hover:border-[var(--line-strong)]"
          aria-label={`Apri scheda ${listing.title}`}
        >
          {listing.imageUrls[0] ? (
            <span
              className="block size-full bg-cover bg-center"
              style={{ backgroundImage: `url("${listing.imageUrls[0]}")` }}
            />
          ) : (
            <span className="flex size-full items-center justify-center px-3 text-center text-[11px] font-medium leading-4 text-[var(--ink-subtle)]">
              Foto non disponibile
            </span>
          )}
        </Link>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={getSellerTypeTone(listing.sellerType)}>
              {getSellerTypeLabel(listing.sellerType)}
            </Badge>
            <span className="text-xs font-medium text-[var(--status-warning)]">
              {getOpportunityReason(listing)}
            </span>
          </div>
          <Link
            href={`/listings/${listing.id}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block truncate text-sm font-semibold text-[var(--ink-strong)] hover:text-[var(--surface-accent)]"
          >
            {listing.title}
          </Link>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-soft)]">
            <span className="font-semibold text-[var(--ink-strong)]">
              {formatCurrency(listing.price)}
            </span>
            <span>{formatNumber(listing.sqm)} mq</span>
            <span>{formatPlainText(listing.zone)}</span>
          </div>
          <p className="mt-1 text-xs text-[var(--ink-subtle)]">
            Aggiunto il {formatDateTime(listing.firstSeenAt)}
          </p>
        </div>
      </div>
      <ListingScoreSummary listing={listing} scoringConfig={scoringConfig} />
    </article>
  );
}

function SystemRow({
  label,
  value,
  ok = true,
}: Readonly<{
  label: string;
  value: string;
  ok?: boolean;
}>) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-[var(--line-soft)] py-3 first:border-t-0 first:pt-0">
      <div>
        <p className="text-sm font-semibold text-[var(--ink-strong)]">{label}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{value}</p>
      </div>
      <span
        className={
          ok
            ? "mt-1 size-2.5 rounded-full bg-[var(--surface-accent)]"
            : "mt-1 size-2.5 rounded-full bg-[var(--status-error)]"
        }
      />
    </div>
  );
}

export default async function DashboardPage() {
  await connection();

  const [summary, incoming, lastScrapeRun, scoringConfig] = await Promise.all([
    getDashboardSummary(),
    getIncomingDashboardData(),
    getLastScrapeRun(),
    getPersistedScoringConfig(),
  ]);
  const emailConfig = getEmailAlertsConfig();
  const scraperConfig = getScraperRuntimeConfig();
  const opportunities = summary.watchlist.slice(0, 5);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Dashboard"
        title="Pannello operativo"
        description="Solo lavoro aperto, automazioni e opportunita da valutare."
        actions={<div className="flex flex-wrap gap-2"><RefreshEmailButton /><QuickRequestButton /></div>}
      />

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          value={incoming.pendingCount}
          label="Annunci da completare"
          detail="ultimi 5 giorni"
        />
        <SummaryCard
          value={incoming.recentCount}
          label="Nuovi arrivi"
          detail="ultime 24 ore"
        />
        <SummaryCard
          value={summary.highPriority}
          label="Occasioni in evidenza"
          detail="priorita alta"
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.7fr)]">
        <SectionCard
          title="Nuovi arrivi da completare"
          action={
            <Link
              href="/incoming"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--surface-accent)] hover:text-[var(--surface-accent-hover)]"
            >
              Vedi tutti
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          }
        >
          {incoming.pendingListings.length ? (
            incoming.pendingListings.map((listing) => (
              <IncomingRow key={listing.id} listing={listing} />
            ))
          ) : (
            <EmptyState text="Non ci sono annunci in attesa di import." />
          )}
        </SectionCard>

        <SectionCard
          title="Stato automazioni"
          action={
            <Link
              href="/settings"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--surface-accent)] hover:text-[var(--surface-accent-hover)]"
            >
              Dettagli
            </Link>
          }
        >
          <SystemRow
            label="Email"
            ok={emailConfig.enabled}
            value={
              emailConfig.enabled
                ? incoming.lastEmailCheck
                  ? `Ultimo controllo: ${formatDateTime(incoming.lastEmailCheck.processedAt)}`
                  : "Controllo email attivo"
                : "Email non configurata"
            }
          />
          <SystemRow
            label="Siti locali"
            value={
              lastScrapeRun
                ? `${getRunStatusLabel(lastScrapeRun.status)} - ${formatDateTime(lastScrapeRun.finishedAt ?? lastScrapeRun.startedAt)}`
                : "Nessun controllo registrato"
            }
          />
          <SystemRow
            label="Fonti"
            value={
              scraperConfig.provider === "all"
                ? "Email e siti locali"
                : getSourceLabel(scraperConfig.provider)
            }
          />
          <SystemRow
            label="Errori ultimo run"
            ok={!lastScrapeRun?.errorCount}
            value={
              lastScrapeRun?.errorCount
                ? `${formatNumber(lastScrapeRun.errorCount)} problemi`
                : "Nessun problema rilevato"
            }
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Occasioni da valutare"
        action={
          <Link
            href="/listings?onlyHighPriority=on"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--surface-accent)] hover:text-[var(--surface-accent-hover)]"
          >
            Archivio
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        }
      >
        {opportunities.length ? (
          opportunities.map((listing) => (
            <OpportunityRow
              key={listing.id}
              listing={listing}
              scoringConfig={scoringConfig}
            />
          ))
        ) : (
          <EmptyState text="Nessuna occasione in evidenza al momento." />
        )}
      </SectionCard>
    </div>
  );
}
