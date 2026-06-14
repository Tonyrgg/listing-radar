import {
  ArrowRight,
  Building2,
  Clock3,
  Database,
  Inbox,
  MailCheck,
  Target,
  TrendingDown,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RefreshEmailButton } from "@/app/(private)/incoming/refresh-email-button";
import { Badge, getSellerTypeTone } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import {
  getDashboardSummary,
  getLastScrapeRun,
} from "@/lib/data/repository";
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
import { getScraperRuntimeConfig } from "@/lib/scrapers/config";
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
  if (listing.isPriceDropped) {
    return "Prezzo ridotto";
  }

  if (listing.sellerType === "private") {
    return "Privato probabile";
  }

  if (listing.minimumDaysOnline >= 60) {
    return `Online da almeno ${listing.minimumDaysOnline} giorni`;
  }

  if (listing.isNewToday) {
    return "Pubblicato oggi";
  }

  if (listing.phone) {
    return "Telefono visibile";
  }

  return "Segnali operativi rilevanti";
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: Readonly<{
  icon: typeof Inbox;
  label: string;
  value: number;
  detail: string;
}>) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-4 first:pl-0 last:pr-0">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--surface-accent)]">
        <Icon aria-hidden="true" className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tabular-nums text-[var(--ink-strong)]">
            {formatNumber(value)}
          </span>
          <span className="truncate text-sm font-medium text-[var(--ink-strong)]">
            {label}
          </span>
        </div>
        <p className="truncate text-xs text-[var(--ink-subtle)]">{detail}</p>
      </div>
    </div>
  );
}

function IncomingRow({ listing }: Readonly<{ listing: IncomingListing }>) {
  return (
    <article className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 border-t border-[var(--line-soft)] py-4 first:border-t-0 first:pt-0 sm:grid-cols-[112px_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div
        className="aspect-[4/3] w-full rounded-md border border-[var(--line-soft)] bg-[var(--surface-muted)] bg-cover bg-center"
        style={
          listing.imageUrl
            ? { backgroundImage: `url("${listing.imageUrl}")` }
            : undefined
        }
        role={listing.imageUrl ? "img" : undefined}
        aria-label={listing.imageUrl ? listing.title : undefined}
      />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="blue">{getSourceLabel(listing.source)}</Badge>
          <span className="text-xs text-[var(--ink-subtle)]">
            {formatDateTime(listing.emailReceivedAt ?? listing.createdAt)}
          </span>
        </div>
        <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-[var(--ink-strong)] sm:truncate sm:text-base">
          {listing.title}
        </h3>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--ink-soft)]">
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
      </div>

      <a
        href={getPortalImportUrl(listing)}
        target="_blank"
        rel="noreferrer"
        className="col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--surface-accent)] px-4 text-sm font-semibold text-[var(--button-ink)] transition-colors hover:bg-[var(--surface-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] sm:col-span-1"
      >
        Apri e completa
        <ArrowRight aria-hidden="true" className="size-4" />
      </a>
    </article>
  );
}

function WorkflowStep({
  number,
  title,
  detail,
  active = false,
}: Readonly<{
  number: number;
  title: string;
  detail: string;
  active?: boolean;
}>) {
  return (
    <div className="flex min-w-0 gap-3 px-4 py-4 first:pl-0 last:pr-0">
      <span
        className={
          active
            ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-accent)] text-sm font-semibold text-[var(--button-ink)]"
            : "flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-sm font-semibold text-[var(--ink-soft)]"
        }
      >
        {number}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--ink-strong)]">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-subtle)]">{detail}</p>
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const [summary, incoming, lastScrapeRun] = await Promise.all([
    getDashboardSummary(),
    getIncomingDashboardData(),
    getLastScrapeRun(),
  ]);
  const emailConfig = getEmailAlertsConfig();
  const scraperConfig = getScraperRuntimeConfig();
  const opportunities = summary.watchlist.slice(0, 5);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Il tuo lavoro"
        title="Da qui inizi"
        description="Prima completa gli annunci ricevuti. Poi passa alle occasioni che meritano attenzione."
        actions={<RefreshEmailButton />}
      />

      <section
        className="grid divide-y divide-[var(--line-soft)] border-b border-[var(--line-soft)] lg:grid-cols-3 lg:divide-x lg:divide-y-0"
        aria-label="Percorso di lavoro"
      >
        <WorkflowStep
          number={1}
          title="Cerca le novita"
          detail="Il controllo email raccoglie le nuove segnalazioni."
        />
        <WorkflowStep
          number={2}
          title="Completa le schede"
          detail={`${formatNumber(incoming.pendingCount)} annunci aspettano i dati completi.`}
          active={incoming.pendingCount > 0}
        />
        <WorkflowStep
          number={3}
          title="Valuta le occasioni"
          detail={`${formatNumber(summary.highPriority)} annunci sono in evidenza.`}
          active={incoming.pendingCount === 0 && summary.highPriority > 0}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.65fr)]">
        <section className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
          <div className="flex flex-col gap-4 border-b border-[var(--line-soft)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold text-[var(--ink-strong)]">
                  1. Annunci da completare
                </h2>
                <Badge tone={incoming.pendingCount ? "amber" : "green"}>
                  {incoming.pendingCount} in attesa
                </Badge>
              </div>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                Parti dal primo annuncio e procedi in ordine.
              </p>
            </div>
            <Link
              href="/incoming"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[var(--line-strong)] px-4 text-sm font-medium text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              Vedi tutti
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>

          <div className="px-5 py-5">
            {incoming.pendingListings.length ? (
              incoming.pendingListings.map((listing) => (
                <IncomingRow key={listing.id} listing={listing} />
              ))
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center text-center">
                <MailCheck
                  aria-hidden="true"
                  className="size-7 text-[var(--surface-accent)]"
                />
                <p className="mt-4 text-sm font-semibold text-[var(--ink-strong)]">
                  Coda completata
                </p>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">
                  Non ci sono segnalazioni in attesa.
                </p>
              </div>
            )}
          </div>
        </section>

        <aside className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
          <div className="border-b border-[var(--line-soft)] px-5 py-5">
            <h2 className="text-lg font-semibold text-[var(--ink-strong)]">
              Tutto funziona?
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Stato dei controlli automatici.
            </p>
          </div>

          <dl className="divide-y divide-[var(--line-soft)] px-5">
            <div className="flex gap-3 py-4">
              <MailCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-[var(--surface-accent)]"
              />
              <div>
                <dt className="text-sm font-medium text-[var(--ink-strong)]">
                  Controllo email
                </dt>
                <dd className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                  {emailConfig.enabled
                    ? incoming.lastEmailCheck
                      ? `Ultimo controllo: ${formatDateTime(incoming.lastEmailCheck.processedAt)}`
                      : "Pronto, in attesa del primo controllo"
                    : "Da configurare nelle impostazioni"}
                </dd>
              </div>
            </div>

            <div className="flex gap-3 py-4">
              <Database
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-[var(--surface-accent)]"
              />
              <div>
                <dt className="text-sm font-medium text-[var(--ink-strong)]">
                  Controllo siti locali
                </dt>
                <dd className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                  {lastScrapeRun
                    ? `${getRunStatusLabel(lastScrapeRun.status)}: ${formatDateTime(lastScrapeRun.finishedAt ?? lastScrapeRun.startedAt)}`
                    : "Nessun controllo registrato"}
                </dd>
              </div>
            </div>

            <div className="flex gap-3 py-4">
              <Building2
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-[var(--surface-accent)]"
              />
              <div>
                <dt className="text-sm font-medium text-[var(--ink-strong)]">
                  Fonti attive
                </dt>
                <dd className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                  {scraperConfig.provider === "all"
                    ? "Email e 3 siti locali"
                    : getSourceLabel(scraperConfig.provider)}
                </dd>
              </div>
            </div>

            <div className="flex gap-3 py-4">
              <Target
                aria-hidden="true"
                className={
                  lastScrapeRun?.errorCount
                    ? "mt-0.5 size-4 shrink-0 text-[var(--status-error)]"
                    : "mt-0.5 size-4 shrink-0 text-[var(--surface-accent)]"
                }
              />
              <div>
                <dt className="text-sm font-medium text-[var(--ink-strong)]">
                  Ultimo risultato
                </dt>
                <dd className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                  {lastScrapeRun
                    ? lastScrapeRun.errorCount
                      ? `${formatNumber(lastScrapeRun.errorCount)} problemi da controllare`
                      : "Tutto regolare"
                    : "In attesa del primo controllo"}
                </dd>
              </div>
            </div>
          </dl>

          <div className="border-t border-[var(--line-soft)] px-5 py-4">
            <Link
              href="/settings"
              className="inline-flex items-center gap-2 text-sm font-medium text-[var(--surface-accent)] hover:text-[var(--surface-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--focus-ring)]"
            >
              Apri impostazioni
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </aside>
      </div>

      <section className="grid divide-y divide-[var(--line-soft)] border-b border-[var(--line-soft)] md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
        <Metric
          icon={Inbox}
          label="annunci da completare"
          value={incoming.pendingCount}
          detail="Il lavoro da fare ora"
        />
        <Metric
          icon={Clock3}
          label="arrivati oggi"
          value={incoming.recentCount}
          detail="Nelle ultime 24 ore"
        />
        <Metric
          icon={TrendingDown}
          label="prezzi scesi"
          value={summary.priceDrops}
          detail="Da ricontrollare"
        />
        <Metric
          icon={Target}
          label="in evidenza"
          value={summary.highPriority}
          detail="Occasioni da valutare"
        />
      </section>

      <section className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        <div className="flex flex-col gap-3 border-b border-[var(--line-soft)] px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink-strong)]">
              2. Occasioni da valutare
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Schede complete con segnali che meritano attenzione.
            </p>
          </div>
          <Link
            href="/listings?onlyHighPriority=on"
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--surface-accent)] hover:text-[var(--surface-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--focus-ring)]"
          >
            Vedi tutte le occasioni
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>

        <div className="divide-y divide-[var(--line-soft)]">
          {opportunities.map((listing) => (
            <article
              key={listing.id}
              className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.35fr)_auto] md:items-center"
            >
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
                  className="mt-2 block truncate text-sm font-semibold text-[var(--ink-strong)] hover:text-[var(--surface-accent)]"
                >
                  {listing.title}
                </Link>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--ink-soft)]">
                <span className="font-semibold tabular-nums text-[var(--ink-strong)]">
                  {formatCurrency(listing.price)}
                </span>
                <span>{formatNumber(listing.sqm)} mq</span>
                <span>{formatPlainText(listing.zone)}</span>
              </div>

              <Link
                href={`/listings/${listing.id}`}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--line-strong)] px-3 text-sm font-medium text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                Apri scheda
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
