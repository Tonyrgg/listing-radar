import {
  ClipboardList,
  Flag,
  Home,
  MailCheck,
  MapPinned,
  Newspaper,
  Send,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RefreshEmailButton } from "@/app/(private)/incoming/refresh-email-button";
import { Badge, getSellerTypeTone } from "@/components/badge";
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
  if (listing.isPriceDropped) return "Prezzo ridotto";
  if (listing.sellerType === "private") return "Privato probabile";
  if (listing.minimumDaysOnline >= 60) {
    return `${listing.minimumDaysOnline} giorni online`;
  }
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
          style={{ width: `${92 - index * 12}%` }}
        />
      ))}
    </div>
  );
}

function SoftIllustration({
  variant,
}: Readonly<{ variant: "map" | "list" | "person" | "flag" }>) {
  return (
    <div className="pointer-events-none absolute bottom-3 right-4 hidden h-28 w-36 opacity-60 sm:block">
      <div className="absolute bottom-0 right-0 size-24 rounded-full bg-[var(--surface-accent-soft)]" />
      {variant === "map" ? (
        <>
          <div className="absolute bottom-7 right-10 size-16 rounded-full border-4 border-[var(--ink-subtle)]" />
          <div className="absolute bottom-3 right-7 h-14 w-2 rotate-[-42deg] rounded-full bg-[var(--ink-subtle)]" />
          <div className="absolute bottom-12 right-17 size-3 rounded-full bg-[var(--status-warning)]" />
          <div className="absolute bottom-10 right-14 size-8 rounded-full border-2 border-[var(--status-warning)]" />
        </>
      ) : variant === "list" ? (
        <>
          <div className="absolute bottom-4 right-8 h-24 w-20 rounded-md border-4 border-[var(--ink-subtle)] bg-[var(--surface-panel)]" />
          <div className="absolute bottom-[5.35rem] right-[3.35rem] h-3 w-10 rounded-full bg-[oklch(0.78_0.12_60)]" />
          <span className="absolute bottom-[4.35rem] right-[4.8rem] size-3 rounded-sm border-2 border-[var(--surface-accent)]" />
          <span className="absolute bottom-[3.1rem] right-[4.8rem] size-3 rounded-sm border-2 border-[var(--surface-accent)]" />
          <span className="absolute bottom-[4.55rem] right-11 h-1 w-8 rounded-full bg-[var(--ink-subtle)]" />
          <span className="absolute bottom-[3.3rem] right-11 h-1 w-8 rounded-full bg-[var(--ink-subtle)]" />
        </>
      ) : variant === "person" ? (
        <>
          <div className="absolute bottom-5 right-8 size-12 rounded-full bg-[oklch(0.78_0.12_60)]" />
          <div className="absolute bottom-3 right-7 h-10 w-16 rounded-t-full bg-[var(--ink-subtle)]" />
          <div className="absolute bottom-12 right-23 h-20 w-14 rotate-[-12deg] rounded-md border border-[var(--line-strong)] bg-[var(--surface-panel)]" />
          <span className="absolute bottom-[5.4rem] right-[6.4rem] h-1 w-8 rounded-full bg-[var(--surface-accent)]" />
          <span className="absolute bottom-[4.65rem] right-[6.4rem] h-1 w-6 rounded-full bg-[var(--ink-subtle)]" />
        </>
      ) : (
        <>
          <Flag className="absolute bottom-12 right-[4.8rem] size-11 text-[var(--surface-accent)]" />
          <div className="absolute bottom-4 right-20 h-16 w-1 rounded-full bg-[var(--ink-subtle)]" />
          <div className="absolute bottom-4 right-8 h-16 w-20 rounded-md border border-[var(--line-strong)] bg-[var(--surface-panel)]" />
          <span className="absolute bottom-14 right-[3.25rem] h-1 w-10 rounded-full bg-[var(--ink-subtle)]" />
          <span className="absolute bottom-10 right-[3.25rem] h-1 w-8 rounded-full bg-[var(--ink-subtle)]" />
        </>
      )}
    </div>
  );
}

function StatCard({
  value,
  label,
  hint,
}: Readonly<{
  value: number;
  label: string;
  hint: string;
}>) {
  return (
    <article className="grid min-h-28 grid-cols-[54px_minmax(0,1fr)] overflow-hidden rounded-md border border-[var(--line-soft)] bg-[var(--surface-panel)] shadow-[var(--shadow-panel)]">
      <div className="flex items-center justify-center bg-[oklch(0.63_0.14_148)] text-3xl font-semibold text-[var(--button-ink)]">
        {formatNumber(value)}
      </div>
      <div className="p-4">
        <p className="text-sm font-semibold text-[var(--ink-strong)]">{label}</p>
        <p className="mt-1 text-xs text-[var(--surface-accent)]">ultimi 5 giorni</p>
        <div className="mt-4 max-w-[210px]">
          <TextLines rows={4} />
        </div>
        <p className="sr-only">{hint}</p>
      </div>
    </article>
  );
}

function ModuleCard({
  icon: Icon,
  title,
  children,
  variant,
  href,
  action,
}: Readonly<{
  icon: typeof Home;
  title: string;
  children: React.ReactNode;
  variant: "map" | "list" | "person" | "flag";
  href?: string;
  action?: React.ReactNode;
}>) {
  return (
    <section className="relative min-h-44 overflow-hidden rounded-md border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4 shadow-[var(--shadow-panel)]">
      <div className="relative z-10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-[var(--surface-accent)] text-[var(--button-ink)]">
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <h2 className="text-sm font-semibold text-[var(--ink-strong)]">{title}</h2>
        </div>
        {href ? (
          <Link
            href={href}
            className="text-xs font-semibold text-[var(--surface-accent)] hover:text-[var(--surface-accent-hover)]"
          >
            Apri
          </Link>
        ) : null}
      </div>
      <div className="relative z-10 mt-4 max-w-[65%] text-sm text-[var(--ink-soft)]">
        {children}
      </div>
      {action ? <div className="relative z-10 mt-4">{action}</div> : null}
      <SoftIllustration variant={variant} />
    </section>
  );
}

function IncomingItem({ listing }: Readonly<{ listing: IncomingListing }>) {
  return (
    <article className="grid gap-2 border-t border-[var(--line-soft)] py-3 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
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
        {listing.sqm ? ` · ${formatNumber(listing.sqm)} mq` : ""}
        {listing.zone ? ` · ${listing.zone}` : ""}
      </p>
    </article>
  );
}

function OpportunityItem({ listing }: Readonly<{ listing: Listing }>) {
  return (
    <article className="grid gap-2 border-t border-[var(--line-soft)] py-3 first:border-t-0 first:pt-0">
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
        className="line-clamp-2 text-sm font-semibold leading-5 text-[var(--ink-strong)] hover:text-[var(--surface-accent)]"
      >
        {listing.title}
      </Link>
      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ink-soft)]">
        <span className="font-semibold text-[var(--ink-strong)]">
          {formatCurrency(listing.price)}
        </span>
        <span>{formatNumber(listing.sqm)} mq</span>
        <span>{formatPlainText(listing.zone)}</span>
      </div>
      <span className="text-xs font-semibold text-[var(--surface-accent)]">
        {formatNumber(listing.priorityScore)} punti
      </span>
    </article>
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
  const opportunities = summary.watchlist.slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="flex min-h-12 items-center justify-between gap-4">
        <div>
          <p className="text-xs text-[var(--ink-soft)]">
            Bentornato, Listing Radar
          </p>
          <h1 className="mt-1 text-xl font-semibold text-[var(--ink-strong)]">
            Cruscotto
          </h1>
        </div>
        <RefreshEmailButton />
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          value={incoming.pendingCount}
          label="Annunci da completare"
          hint="Annunci da completare"
        />
        <StatCard
          value={summary.highPriority}
          label="Occasioni in evidenza"
          hint="Occasioni in evidenza"
        />
        <StatCard
          value={incoming.recentCount}
          label="Arrivi nelle ultime 24 ore"
          hint="Arrivi recenti"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ModuleCard
          icon={MapPinned}
          title="Zona"
          variant="map"
          href="/incoming"
        >
          <p>Attivita di ricerca</p>
          <p className="mt-3 text-xs text-[var(--ink-subtle)]">
            {incoming.pendingCount
              ? `${formatNumber(incoming.pendingCount)} nuovi arrivi da aprire`
              : "Nessun nuovo arrivo in coda"}
          </p>
        </ModuleCard>

        <ModuleCard
          icon={Newspaper}
          title="Notizie"
          variant="list"
          href="/settings"
        >
          <p>Appuntamenti di acquisizione</p>
          <p className="mt-1">Tutte le notizie</p>
          <p className="mt-3 text-xs text-[var(--ink-subtle)]">
            {emailConfig.enabled
              ? incoming.lastEmailCheck
                ? `Email: ${formatDateTime(incoming.lastEmailCheck.processedAt)}`
                : "Email attiva"
              : "Email da configurare"}
          </p>
        </ModuleCard>

        <ModuleCard
          icon={ClipboardList}
          title="Incarichi"
          variant="person"
          href="/listings"
        >
          {opportunities.length ? (
            <div className="max-w-full">
              {opportunities.map((listing) => (
                <OpportunityItem key={listing.id} listing={listing} />
              ))}
            </div>
          ) : (
            <>
              <p>Appuntamenti di gestione</p>
              <p className="mt-1">Appuntamenti di vendita</p>
              <p className="mt-1">Incarichi in scadenza 30 gg</p>
            </>
          )}
        </ModuleCard>

        <ModuleCard
          icon={Send}
          title="Richieste"
          variant="flag"
          href="/reports"
        >
          {incoming.pendingListings.length ? (
            <div className="max-w-full">
              {incoming.pendingListings.slice(0, 3).map((listing) => (
                <IncomingItem key={listing.id} listing={listing} />
              ))}
            </div>
          ) : (
            <>
              <p>Attivita di proposta</p>
              <p className="mt-1">Attivita di aggiornamento</p>
              <p className="mt-1">Richieste da gestire</p>
            </>
          )}
        </ModuleCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <ModuleCard icon={MailCheck} title="Email" variant="list">
          <p>
            {emailConfig.enabled
              ? "Casella collegata e controllata dal cron."
              : "Casella non configurata."}
          </p>
        </ModuleCard>
        <ModuleCard icon={Home} title="Portali" variant="map">
          <p>
            {scraperConfig.provider === "all"
              ? "Email e siti locali attivi."
              : getSourceLabel(scraperConfig.provider)}
          </p>
        </ModuleCard>
        <ModuleCard icon={Flag} title="Sistema" variant="flag">
          <p>
            {lastScrapeRun
              ? `${getRunStatusLabel(lastScrapeRun.status)} · ${formatDateTime(lastScrapeRun.finishedAt ?? lastScrapeRun.startedAt)}`
              : "In attesa del primo controllo."}
          </p>
        </ModuleCard>
      </section>
    </div>
  );
}
