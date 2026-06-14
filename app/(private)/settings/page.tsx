import type { ReactNode } from "react";

import { Badge, type BadgeTone } from "@/components/badge";
import { LISTING_SOURCE_OPTIONS, REPORT_SCHEDULE } from "@/lib/constants";
import {
  getLastScrapeRun,
  getRecentScrapeErrors,
  getRecentScrapeRuns,
} from "@/lib/data/repository";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import { SCRAPER_CONFIG, getScraperRuntimeConfig } from "@/lib/scrapers/config";
import { getEmailAlertsConfig } from "@/lib/email-alerts/config";
import type { ScrapeRun } from "@/types";

export const dynamic = "force-dynamic";

function ConfigRow({
  label,
  value,
}: Readonly<{
  label: string;
  value: ReactNode;
}>) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
        {label}
      </p>
      <div className="mt-2 text-sm font-medium text-[var(--ink-strong)]">{value}</div>
    </div>
  );
}

function getRunTone(status: string): BadgeTone {
  switch (status) {
    case "success":
      return "green";
    case "completed_with_errors":
      return "amber";
    case "error":
      return "red";
    case "running":
      return "blue";
    default:
      return "slate";
  }
}

function RunMetric({
  label,
  value,
}: Readonly<{
  label: string;
  value: number;
}>) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-[var(--ink-strong)]">
        {formatNumber(value)}
      </p>
    </div>
  );
}

function ScrapeRunRow({ run }: Readonly<{ run: ScrapeRun }>) {
  return (
    <article className="grid gap-4 border-b border-[var(--line-soft)] px-5 py-4 last:border-b-0 lg:grid-cols-[minmax(190px,0.8fr)_minmax(0,1fr)_auto]">
      <div className="space-y-2">
        <Badge tone={getRunTone(run.status)}>{run.status}</Badge>
        <p className="text-sm text-[var(--ink-soft)]">
          {formatDateTime(run.startedAt)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <RunMetric label="Trovati" value={run.totalFound} />
        <RunMetric label="Inseriti" value={run.totalInserted} />
        <RunMetric label="Aggiornati" value={run.totalUpdated} />
        <RunMetric label="Errori" value={run.errorCount} />
      </div>
      <p className="text-sm text-[var(--ink-soft)]">
        Fine {formatDateTime(run.finishedAt)}
      </p>
    </article>
  );
}

export default async function SettingsPage() {
  const runtimeConfig = getScraperRuntimeConfig();
  const emailConfig = getEmailAlertsConfig();
  const [lastScrapeRun, recentScrapeRuns, recentScrapeErrors] = await Promise.all([
    getLastScrapeRun(),
    getRecentScrapeRuns(),
    getRecentScrapeErrors(),
  ]);
  const telegramEnabled = Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
  );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
          Settings
        </p>
        <h2 className="text-3xl font-semibold text-[var(--ink-strong)]">
          Configurazione corrente
        </h2>
      </header>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[var(--shadow-panel)]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
            Monitoraggio
          </p>
          <div className="mt-4 space-y-4">
            <ConfigRow
              label="Provider attivo"
              value={
                <Badge tone={runtimeConfig.provider === "mock" ? "amber" : "green"}>
                  {runtimeConfig.provider}
                </Badge>
              }
            />
            <ConfigRow label="Citta monitorata" value={SCRAPER_CONFIG.monitoredCity} />
            <ConfigRow
              label="Provincia / Regione"
              value={`${SCRAPER_CONFIG.monitoredProvince} / ${SCRAPER_CONFIG.monitoredRegion}`}
            />
            <ConfigRow
              label="Categoria / contratto"
              value={`${SCRAPER_CONFIG.category} / ${SCRAPER_CONFIG.contractType}`}
            />
            <ConfigRow label="Orario report" value={REPORT_SCHEDULE} />
          </div>
        </article>

        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[var(--shadow-panel)]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
            Runtime scraper
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ConfigRow
              label="Limite pagine ricerca"
              value={formatNumber(runtimeConfig.maxSearchPages)}
            />
            <ConfigRow
              label="Limite annunci dettaglio"
              value={formatNumber(runtimeConfig.maxDetailPages)}
            />
            <ConfigRow
              label="Delay richieste"
              value={`${formatNumber(runtimeConfig.detailDelayMs)} ms`}
            />
            <ConfigRow
              label="Telegram"
              value={
                <Badge tone={telegramEnabled ? "green" : "amber"}>
                  {telegramEnabled ? "enabled" : "disabled"}
                </Badge>
              }
            />
            <ConfigRow
              label="Alert email"
              value={
                <Badge tone={emailConfig.enabled ? "green" : "amber"}>
                  {emailConfig.enabled ? "enabled" : "disabled"}
                </Badge>
              }
            />
            <ConfigRow
              label="Mailbox alert"
              value={emailConfig.enabled ? emailConfig.mailbox : "n/d"}
            />
            <ConfigRow
              label="Finestra email"
              value={`${formatNumber(emailConfig.lookbackDays)} giorni / ${formatNumber(emailConfig.maxMessages)} messaggi`}
            />
            <ConfigRow
              label="Estensione Chrome"
              value={
                <Badge tone={process.env.EXTENSION_API_TOKEN ? "green" : "amber"}>
                  {process.env.EXTENSION_API_TOKEN ? "configured" : "disabled"}
                </Badge>
              }
            />
            <ConfigRow
              label="Ultimo scrape_run"
              value={
                lastScrapeRun ? (
                  <span>
                    {lastScrapeRun.status} - {formatDateTime(lastScrapeRun.startedAt)}
                  </span>
                ) : (
                  "n/d"
                )
              }
            />
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[var(--shadow-panel)]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
            Fonti predisposte
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {LISTING_SOURCE_OPTIONS.map((source) => (
              <Badge key={source} tone="slate">
                {source}
              </Badge>
            ))}
          </div>
        </article>

        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[var(--shadow-panel)]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
            Stato fonti
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="green">mock default</Badge>
            <Badge tone="green">admaiora live</Badge>
            <Badge tone="green">futura live</Badge>
            <Badge tone="green">immobiliari riunite live</Badge>
            <Badge tone="green">all: 3 siti</Badge>
            <Badge tone="green">import ready</Badge>
            <Badge tone="green">feed ready</Badge>
            <Badge tone="amber">subito opt-in</Badge>
          </div>
        </article>
      </section>

      <section className="overflow-hidden rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] shadow-[var(--shadow-panel)]">
        <div className="border-b border-[var(--line-soft)] px-5 py-4">
          <h3 className="text-lg font-semibold text-[var(--ink-strong)]">
            Ultimi scrape run
          </h3>
        </div>
        <div>
          {recentScrapeRuns.length ? (
            recentScrapeRuns.map((run) => <ScrapeRunRow key={run.id} run={run} />)
          ) : (
            <p className="px-5 py-4 text-sm text-[var(--ink-soft)]">
              Nessun run salvato.
            </p>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] shadow-[var(--shadow-panel)]">
        <div className="border-b border-[var(--line-soft)] px-5 py-4">
          <h3 className="text-lg font-semibold text-[var(--ink-strong)]">
            Errori recenti provider
          </h3>
        </div>
        <div className="divide-y divide-[var(--line-soft)]">
          {recentScrapeErrors.length ? (
            recentScrapeErrors.map((error) => (
              <article key={error.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[160px_minmax(0,1fr)_190px]">
                <div className="space-y-2">
                  <Badge tone="red">{error.source ?? "system"}</Badge>
                  <p className="text-xs text-[var(--ink-subtle)]">
                    {formatDateTime(error.createdAt)}
                  </p>
                </div>
                <p className="text-sm leading-6 text-[var(--ink-strong)]">
                  {error.message}
                </p>
                <p className="break-words text-xs leading-5 text-[var(--ink-soft)]">
                  {typeof error.details?.url === "string" ? error.details.url : ""}
                </p>
              </article>
            ))
          ) : (
            <p className="px-5 py-4 text-sm text-[var(--ink-soft)]">
              Nessun errore recente.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
