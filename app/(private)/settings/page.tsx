import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  Mail,
  MapPin,
  Puzzle,
  Settings2,
} from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Badge, type BadgeTone } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { LISTING_SOURCE_OPTIONS, REPORT_SCHEDULE } from "@/lib/constants";
import {
  getLastScrapeRun,
  getRecentScrapeErrors,
  getRecentScrapeRuns,
} from "@/lib/data/repository";
import { getEmailAlertsConfig } from "@/lib/email-alerts/config";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import { getRunStatusLabel, getSourceLabel } from "@/lib/labels";
import { SCRAPER_CONFIG, getScraperRuntimeConfig } from "@/lib/scrapers/config";
import type { ScrapeRun } from "@/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Impostazioni",
};

function ConfigRow({
  label,
  value,
}: Readonly<{
  label: string;
  value: ReactNode;
}>) {
  return (
    <div>
      <dt className="text-xs text-[var(--ink-subtle)]">{label}</dt>
      <dd className="mt-1 text-sm font-medium leading-6 text-[var(--ink-strong)]">
        {value}
      </dd>
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

function SystemCheck({
  icon: Icon,
  title,
  detail,
  ready,
}: Readonly<{
  icon: typeof Mail;
  title: string;
  detail: string;
  ready: boolean;
}>) {
  return (
    <article className="flex gap-4 border-b border-[var(--line-soft)] py-5 last:border-b-0 md:border-b-0 md:border-r md:px-5 md:first:pl-0 md:last:border-r-0 md:last:pr-0">
      <span
        className={
          ready
            ? "flex size-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]"
            : "flex size-10 shrink-0 items-center justify-center rounded-md bg-[oklch(0.23_0.035_80)] text-[var(--status-warning)]"
        }
      >
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--ink-strong)]">
            {title}
          </h2>
          <Badge tone={ready ? "green" : "amber"}>
            {ready ? "Pronto" : "Da controllare"}
          </Badge>
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">{detail}</p>
      </div>
    </article>
  );
}

function ScrapeRunRow({ run }: Readonly<{ run: ScrapeRun }>) {
  return (
    <article className="grid gap-4 border-b border-[var(--line-soft)] px-5 py-4 last:border-b-0 lg:grid-cols-[minmax(190px,0.8fr)_minmax(0,1fr)_auto]">
      <div className="space-y-2">
        <Badge tone={getRunTone(run.status)}>
          {getRunStatusLabel(run.status)}
        </Badge>
        <p className="text-sm text-[var(--ink-soft)]">
          {formatDateTime(run.startedAt)}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <ConfigRow label="Trovati" value={formatNumber(run.totalFound)} />
        <ConfigRow label="Nuovi" value={formatNumber(run.totalInserted)} />
        <ConfigRow label="Aggiornati" value={formatNumber(run.totalUpdated)} />
        <ConfigRow label="Problemi" value={formatNumber(run.errorCount)} />
      </dl>
      <p className="text-sm text-[var(--ink-soft)]">
        Fine: {formatDateTime(run.finishedAt)}
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
  const extensionEnabled = Boolean(process.env.EXTENSION_API_TOKEN);
  const sourcesReady = runtimeConfig.provider !== "mock";
  const lastRunHealthy = !lastScrapeRun || lastScrapeRun.errorCount === 0;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Controllo del sistema"
        title="Impostazioni"
        description="Qui puoi verificare se la raccolta automatica e pronta. I dettagli tecnici sono disponibili solo quando servono."
      />

      <section className="grid border-b border-[var(--line-soft)] md:grid-cols-2 xl:grid-cols-4">
        <SystemCheck
          icon={Mail}
          title="Ricezione email"
          detail={
            emailConfig.enabled
              ? `Casella ${emailConfig.mailbox}`
              : "La casella email non e configurata."
          }
          ready={emailConfig.enabled}
        />
        <SystemCheck
          icon={Puzzle}
          title="Estensione Chrome"
          detail={
            extensionEnabled
              ? "Pronta per completare le schede."
              : "Serve per importare i dati dalla pagina dell'annuncio."
          }
          ready={extensionEnabled}
        />
        <SystemCheck
          icon={Globe2}
          title="Siti monitorati"
          detail={
            sourcesReady
              ? runtimeConfig.provider === "all"
                ? "Tre siti locali attivi."
                : `${getSourceLabel(runtimeConfig.provider)} attivo.`
              : "Sono attivi soltanto i dati di prova."
          }
          ready={sourcesReady}
        />
        <SystemCheck
          icon={lastRunHealthy ? CheckCircle2 : AlertTriangle}
          title="Ultimo controllo"
          detail={
            lastScrapeRun
              ? `${getRunStatusLabel(lastScrapeRun.status)}: ${formatDateTime(lastScrapeRun.finishedAt ?? lastScrapeRun.startedAt)}`
              : "Nessun controllo dei siti registrato."
          }
          ready={lastRunHealthy}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5">
          <div className="flex items-center gap-3">
            <MapPin
              aria-hidden="true"
              className="size-5 text-[var(--surface-accent)]"
            />
            <h2 className="text-lg font-semibold text-[var(--ink-strong)]">
              Ricerca monitorata
            </h2>
          </div>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2">
            <ConfigRow label="Citta" value={SCRAPER_CONFIG.monitoredCity} />
            <ConfigRow
              label="Provincia e regione"
              value={`${SCRAPER_CONFIG.monitoredProvince}, ${SCRAPER_CONFIG.monitoredRegion}`}
            />
            <ConfigRow label="Tipo di immobile" value="Immobili" />
            <ConfigRow label="Tipo di annuncio" value="Vendita" />
          </dl>
        </article>

        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5">
          <h2 className="text-lg font-semibold text-[var(--ink-strong)]">
            Servizi facoltativi
          </h2>
          <dl className="mt-5 grid gap-5 sm:grid-cols-3">
            <ConfigRow
              label="Telegram"
              value={telegramEnabled ? "Attivo" : "Non configurato"}
            />
            <ConfigRow label="Riepilogo giornaliero" value={REPORT_SCHEDULE} />
            <ConfigRow
              label="Fonti disponibili"
              value={`${LISTING_SOURCE_OPTIONS.length} predisposte`}
            />
          </dl>
        </article>
      </section>

      <details className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 marker:hidden">
          <span className="flex items-center gap-3 text-sm font-semibold text-[var(--ink-strong)]">
            <Settings2
              aria-hidden="true"
              className="size-4 text-[var(--surface-accent)]"
            />
            Impostazioni avanzate
          </span>
          <span className="text-xs text-[var(--ink-subtle)]">
            Per manutenzione
          </span>
        </summary>
        <dl className="grid gap-5 border-t border-[var(--line-soft)] p-5 sm:grid-cols-2 xl:grid-cols-4">
          <ConfigRow
            label="Modalita fonti"
            value={getSourceLabel(runtimeConfig.provider)}
          />
          <ConfigRow
            label="Pagine di ricerca per controllo"
            value={formatNumber(runtimeConfig.maxSearchPages)}
          />
          <ConfigRow
            label="Schede aperte per controllo"
            value={formatNumber(runtimeConfig.maxDetailPages)}
          />
          <ConfigRow
            label="Pausa tra le richieste"
            value={`${formatNumber(runtimeConfig.detailDelayMs)} ms`}
          />
          <ConfigRow
            label="Email controllate"
            value={`${formatNumber(emailConfig.lookbackDays)} giorni, massimo ${formatNumber(emailConfig.maxMessages)} messaggi`}
          />
        </dl>
      </details>

      <details className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 marker:hidden">
          <span className="text-sm font-semibold text-[var(--ink-strong)]">
            Ultimi controlli automatici
          </span>
          <span className="text-xs text-[var(--ink-subtle)]">
            {recentScrapeRuns.length} registrati
          </span>
        </summary>
        <div className="border-t border-[var(--line-soft)]">
          {recentScrapeRuns.length ? (
            recentScrapeRuns.map((run) => (
              <ScrapeRunRow key={run.id} run={run} />
            ))
          ) : (
            <p className="px-5 py-5 text-sm text-[var(--ink-soft)]">
              Non ci sono ancora controlli registrati.
            </p>
          )}
        </div>
      </details>

      <details className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 marker:hidden">
          <span className="text-sm font-semibold text-[var(--ink-strong)]">
            Problemi tecnici recenti
          </span>
          <Badge tone={recentScrapeErrors.length ? "red" : "green"}>
            {recentScrapeErrors.length
              ? `${recentScrapeErrors.length} da controllare`
              : "Nessun problema"}
          </Badge>
        </summary>
        <div className="divide-y divide-[var(--line-soft)] border-t border-[var(--line-soft)]">
          {recentScrapeErrors.length ? (
            recentScrapeErrors.map((error) => (
              <article
                key={error.id}
                className="grid gap-3 px-5 py-4 lg:grid-cols-[160px_minmax(0,1fr)_190px]"
              >
                <div className="space-y-2">
                  <Badge tone="red">
                    {getSourceLabel(error.source ?? "Sistema")}
                  </Badge>
                  <p className="text-xs text-[var(--ink-subtle)]">
                    {formatDateTime(error.createdAt)}
                  </p>
                </div>
                <p className="text-sm leading-6 text-[var(--ink-strong)]">
                  {error.message}
                </p>
                <p className="break-words text-xs leading-5 text-[var(--ink-soft)]">
                  {typeof error.details?.url === "string"
                    ? error.details.url
                    : ""}
                </p>
              </article>
            ))
          ) : (
            <p className="px-5 py-5 text-sm text-[var(--ink-soft)]">
              Tutti i controlli recenti sono regolari.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
