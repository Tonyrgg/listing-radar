import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Download, FolderOpen, KeyRound, Puzzle, RefreshCw } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { ScoringRulesEditor } from "@/app/(private)/settings/scoring-rules-editor";
import extensionManifest from "@/extension/manifest.json";
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
import { getPersistedScoringConfig } from "@/lib/settings/scoring-config-repository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Impostazioni",
};

const extensionInstallSteps = [
  {
    title: "Scarica ed estrai",
    detail:
      "Scarica il pacchetto ZIP, poi estrailo in una cartella stabile del computer.",
    icon: Download,
  },
  {
    title: "Carica in Chrome",
    detail:
      "Apri chrome://extensions, abilita Modalita sviluppatore e scegli Carica estensione non pacchettizzata.",
    icon: FolderOpen,
  },
  {
    title: "Configura accesso",
    detail:
      "Apri la popup dell'estensione e inserisci l'URL di Listing Radar con il token EXTENSION_API_TOKEN.",
    icon: KeyRound,
  },
  {
    title: "Importa annuncio",
    detail:
      "Apri una scheda annuncio da Nuovi arrivi, premi Importa e completa eventuali dati mancanti nella scheda immobile.",
    icon: Puzzle,
  },
] as const;

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
  title,
  detail,
  ready,
}: Readonly<{
  title: string;
  detail: string;
  ready: boolean;
}>) {
  return (
    <article className="border-b border-[var(--line-soft)] py-5 last:border-b-0 md:border-b-0 md:border-r md:px-5 md:first:pl-0 md:last:border-r-0 md:last:pr-0">
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
  const scoring = await getPersistedScoringConfig();
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
          title="Ricezione email"
          detail={
            emailConfig.enabled
              ? `Casella ${emailConfig.mailbox}`
              : "La casella email non e configurata."
          }
          ready={emailConfig.enabled}
        />
        <SystemCheck
          title="Estensione Chrome"
          detail={
            extensionEnabled
              ? "Pronta per completare le schede."
              : "Serve per importare i dati dalla pagina dell'annuncio."
          }
          ready={extensionEnabled}
        />
        <SystemCheck
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
          title="Ultimo controllo"
          detail={
            lastScrapeRun
              ? `${getRunStatusLabel(lastScrapeRun.status)}: ${formatDateTime(lastScrapeRun.finishedAt ?? lastScrapeRun.startedAt)}`
              : "Nessun controllo dei siti registrato."
          }
          ready={lastRunHealthy}
        />
      </section>

      <section
        id="estensione"
        className="overflow-hidden rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]"
      >
        <div className="grid lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.75fr)]">
          <div className="p-5 lg:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex size-9 items-center justify-center rounded-md bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]">
                    <Puzzle aria-hidden="true" className="size-4.5" />
                  </span>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                      Pacchetto Chrome
                    </p>
                    <h2 className="mt-1 text-xl font-semibold text-[var(--ink-strong)]">
                      Estensione
                    </h2>
                  </div>
                  <Badge tone={extensionEnabled ? "green" : "amber"}>
                    {extensionEnabled ? "Token pronto" : "Token mancante"}
                  </Badge>
                </div>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">
                  Scarica il pacchetto dell&apos;estensione privata per completare
                  gli annunci direttamente dalla scheda aperta in Chrome.
                </p>
              </div>

              <a
                href="/api/extension/download"
                download
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-[var(--surface-accent)] px-4 text-sm font-semibold text-[var(--button-ink)] transition-colors hover:bg-[var(--surface-accent-hover)]"
              >
                <Download aria-hidden="true" className="size-4" />
                Scarica ZIP
              </a>
            </div>

            <dl className="mt-6 grid gap-4 border-y border-[var(--line-soft)] py-5 sm:grid-cols-2 xl:grid-cols-4">
              <ConfigRow label="Versione" value={`v${extensionManifest.version}`} />
              <ConfigRow label="Formato" value="Chrome Manifest V3" />
              <ConfigRow
                label="Autenticazione"
                value={extensionEnabled ? "Token configurato" : "Configura EXTENSION_API_TOKEN"}
              />
              <ConfigRow label="Import" value="/api/import/browser" />
            </dl>

            <div className="mt-5 grid gap-4 text-sm leading-6 text-[var(--ink-soft)] md:grid-cols-2">
              <div className="flex gap-3">
                <KeyRound
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 text-[var(--surface-accent)]"
                />
                <p>
                  Il token non e incluso nello ZIP: va inserito nella popup e
                  deve coincidere con il valore configurato sul server.
                </p>
              </div>
              <div className="flex gap-3">
                <RefreshCw
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 text-[var(--surface-accent)]"
                />
                <p>
                  Dopo ogni aggiornamento del pacchetto, premi Ricarica su
                  chrome://extensions e aggiorna la pagina dell&apos;annuncio.
                </p>
              </div>
            </div>
          </div>

          <aside className="border-t border-[var(--line-soft)] bg-[var(--surface-muted)] p-5 lg:border-l lg:border-t-0 lg:p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--ink-strong)]">
                Guida all&apos;uso
              </h3>
              <span className="text-xs font-medium text-[var(--ink-subtle)]">
                Installazione manuale
              </span>
            </div>
            <ol className="mt-5 space-y-4">
              {extensionInstallSteps.map((step, index) => {
                const Icon = step.icon;

                return (
                  <li
                    key={step.title}
                    className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b border-[var(--line-soft)] pb-4 last:border-b-0 last:pb-0"
                  >
                    <span className="relative inline-flex size-8 items-center justify-center rounded-md border border-[var(--line-strong)] bg-[var(--surface-panel)] text-[var(--surface-accent)]">
                      <Icon aria-hidden="true" className="size-3.5" />
                      <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-[var(--surface-accent)] text-[9px] font-bold text-[var(--button-ink)]">
                        {index + 1}
                      </span>
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-[var(--ink-strong)]">
                        {step.title}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-[var(--ink-soft)]">
                        {step.detail}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </aside>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5">
          <h2 className="text-lg font-semibold text-[var(--ink-strong)]">
            Ricerca monitorata
          </h2>
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
          <span className="text-sm font-semibold text-[var(--ink-strong)]">
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

      <ScoringRulesEditor initialConfig={scoring} />

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
