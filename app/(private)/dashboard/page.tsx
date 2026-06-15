import {
  ArrowRight,
  Building2,
  CheckSquare,
  Clock3,
  Database,
  Flag,
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
import { ListingScoreSummary } from "@/components/listing-score";

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
    <div className="relative min-h-28 overflow-hidden rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4 shadow-[var(--shadow-panel)]">
      <div className="absolute inset-y-0 left-0 w-1 bg-[var(--surface-accent)]" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--ink-soft)]">
            {label}
          </p>
          <p className="mt-4 text-4xl font-semibold tabular-nums text-[var(--surface-accent)]">
            {formatNumber(value)}
          </p>
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]">
          <Icon aria-hidden="true" className="size-5" />
        </div>
      </div>
      <p className="mt-3 truncate text-xs text-[var(--ink-subtle)]">{detail}</p>
      <div className="pointer-events-none absolute bottom-3 right-3 h-9 w-24 opacity-20">
        <div className="absolute bottom-0 left-0 h-1 w-full rounded-full bg-[var(--ink-soft)]" />
        <div className="absolute bottom-2 left-2 h-1 w-16 rounded-full bg-[var(--ink-soft)]" />
        <div className="absolute bottom-4 left-2 h-1 w-20 rounded-full bg-[var(--ink-soft)]" />
      </div>
    </div>
  );
}

function ModuleIllustration({
  variant,
}: Readonly<{ variant: "map" | "checklist" | "flag" }>) {
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 hidden h-28 w-36 opacity-70 md:block">
      <div className="absolute bottom-0 right-0 size-24 rounded-full bg-[var(--surface-accent-soft)]" />
      {variant === "map" ? (
        <>
          <div className="absolute bottom-6 right-8 size-16 rounded-full border-4 border-[var(--ink-subtle)]" />
          <div className="absolute bottom-2 right-4 h-14 w-2 rotate-[-42deg] rounded-full bg-[var(--ink-subtle)]" />
          <div className="absolute bottom-12 right-16 size-3 rounded-full bg-[var(--status-warning)]" />
          <div className="absolute bottom-11 right-14 size-7 rounded-full border-2 border-[var(--status-warning)]" />
        </>
      ) : variant === "checklist" ? (
        <>
          <div className="absolute bottom-4 right-7 h-24 w-20 rounded-md border-4 border-[var(--ink-subtle)] bg-[var(--surface-panel)]" />
          <div className="absolute bottom-[5.4rem] right-[3.25rem] h-3 w-10 rounded-full bg-[oklch(0.78_0.12_60)]" />
          <CheckSquare className="absolute bottom-[4.5rem] right-20 size-4 text-[var(--surface-accent)]" />
          <CheckSquare className="absolute bottom-12 right-20 size-4 text-[var(--surface-accent)]" />
          <div className="absolute bottom-[4.75rem] right-10 h-1 w-8 rounded-full bg-[var(--ink-subtle)]" />
          <div className="absolute bottom-[3.25rem] right-10 h-1 w-8 rounded-full bg-[var(--ink-subtle)]" />
        </>
      ) : (
        <>
          <Flag className="absolute bottom-12 right-[4.75rem] size-12 text-[var(--surface-accent)]" />
          <div className="absolute bottom-4 right-20 h-16 w-1 rounded-full bg-[var(--ink-subtle)]" />
          <div className="absolute bottom-4 right-8 h-16 w-20 rounded-md border border-[var(--line-strong)] bg-[var(--surface-panel)]" />
          <div className="absolute bottom-14 right-[3.25rem] h-1 w-10 rounded-full bg-[var(--ink-subtle)]" />
          <div className="absolute bottom-10 right-[3.25rem] h-1 w-8 rounded-full bg-[var(--ink-subtle)]" />
        </>
      )}
    </div>
  );
}

function SystemTile({
  icon: Icon,
  title,
  detail,
  healthy = true,
}: Readonly<{
  icon: typeof Inbox;
  title: string;
  detail: string;
  healthy?: boolean;
}>) {
  return (
    <div className="flex gap-3 rounded-md border border-[var(--line-soft)] bg-[var(--surface-muted)] p-3">
      <span
        className={
          healthy
            ? "flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-accent)] text-[var(--button-ink)]"
            : "flex size-9 shrink-0 items-center justify-center rounded-md bg-[oklch(0.27_0.06_24)] text-[var(--status-error)]"
        }
      >
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div>
        <p className="text-sm font-semibold text-[var(--ink-strong)]">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-subtle)]">{detail}</p>
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
    <div className="flex min-w-0 gap-3 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4 shadow-[var(--shadow-panel)]">
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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Il tuo lavoro"
        title="Pannello operativo"
        description="Una vista semplice per controllare arrivi, import e opportunita senza cercare tra menu tecnici."
        actions={<RefreshEmailButton />}
      />

      <section
        className="grid gap-3 lg:grid-cols-3"
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={Inbox}
          label="Annunci da completare"
          value={incoming.pendingCount}
          detail="Il lavoro da fare ora"
        />
        <Metric
          icon={Clock3}
          label="Arrivati oggi"
          value={incoming.recentCount}
          detail="Nelle ultime 24 ore"
        />
        <Metric
          icon={TrendingDown}
          label="Prezzi scesi"
          value={summary.priceDrops}
          detail="Da ricontrollare"
        />
        <Metric
          icon={Target}
          label="In evidenza"
          value={summary.highPriority}
          detail="Occasioni da valutare"
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.65fr)]">
        <section className="relative overflow-hidden rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] shadow-[var(--shadow-panel)]">
          <ModuleIllustration variant="map" />
          <div className="relative flex flex-col gap-4 border-b border-[var(--line-soft)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
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

          <div className="relative px-5 py-5">
            {incoming.pendingListings.length ? (
              incoming.pendingListings.map((listing) => (
                <IncomingRow key={listing.id} listing={listing} />
              ))
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center text-center">
                <ModuleIllustration variant="checklist" />
                <MailCheck aria-hidden="true" className="size-7 text-[var(--surface-accent)]" />
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

        <aside className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4 shadow-[var(--shadow-panel)]">
          <div className="border-b border-[var(--line-soft)] px-5 py-5">
            <h2 className="text-lg font-semibold text-[var(--ink-strong)]">
              Tutto funziona?
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Stato dei controlli automatici.
            </p>
          </div>

          <div className="grid gap-3 pt-4">
            <SystemTile
              icon={MailCheck}
              title="Controllo email"
              healthy={emailConfig.enabled}
              detail={
                emailConfig.enabled
                  ? incoming.lastEmailCheck
                    ? `Ultimo controllo: ${formatDateTime(incoming.lastEmailCheck.processedAt)}`
                    : "Pronto, in attesa del primo controllo"
                  : "Da configurare nelle impostazioni"
              }
            />
            <SystemTile
              icon={Database}
              title="Controllo siti locali"
              detail={
                lastScrapeRun
                  ? `${getRunStatusLabel(lastScrapeRun.status)}: ${formatDateTime(lastScrapeRun.finishedAt ?? lastScrapeRun.startedAt)}`
                  : "Nessun controllo registrato"
              }
            />
            <SystemTile
              icon={Building2}
              title="Fonti attive"
              detail={
                scraperConfig.provider === "all"
                  ? "Email e 3 siti locali"
                  : getSourceLabel(scraperConfig.provider)
              }
            />
            <SystemTile
              icon={Target}
              title="Ultimo risultato"
              healthy={!lastScrapeRun?.errorCount}
              detail={
                lastScrapeRun
                  ? lastScrapeRun.errorCount
                    ? `${formatNumber(lastScrapeRun.errorCount)} problemi da controllare`
                    : "Tutto regolare"
                  : "In attesa del primo controllo"
              }
            />
          </div>

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

      <section className="relative overflow-hidden rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] shadow-[var(--shadow-panel)]">
        <ModuleIllustration variant="flag" />
        <div className="relative flex flex-col gap-3 border-b border-[var(--line-soft)] px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
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
                  <ListingScoreSummary listing={listing} />
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
