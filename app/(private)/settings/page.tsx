import type { ReactNode } from "react";

import { Badge } from "@/components/badge";
import { LISTING_SOURCE_OPTIONS, REPORT_SCHEDULE } from "@/lib/constants";
import { getLastScrapeRun } from "@/lib/data/repository";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import { SCRAPER_CONFIG, getScraperRuntimeConfig } from "@/lib/scrapers/config";

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

export default async function SettingsPage() {
  const runtimeConfig = getScraperRuntimeConfig();
  const lastScrapeRun = await getLastScrapeRun();
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
            <Badge tone="amber">subito opt-in</Badge>
          </div>
        </article>
      </section>
    </div>
  );
}
