import type { Metadata } from "next";

import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getReports } from "@/lib/data/repository";
import { formatDate, formatNumber } from "@/lib/formatting";

export const metadata: Metadata = {
  title: "Riepiloghi giornalieri",
};

type ParsedReportContent = {
  title: string | null;
  stats: Array<{ label: string; value: string }>;
  topListings: Array<{
    position: string;
    title: string;
    score: string;
    source: string;
    zone: string;
  }>;
  providers: Array<{ name: string; details: string[] }>;
  notes: string[];
};

const reportStatLabels = new Set([
  "Totale annunci",
  "Nuovi annunci",
  "Privati",
  "Agenzie",
  "Unknown",
  "Ribassi",
  "Vecchi caldi",
  "Priorita alta",
]);

function parseReportContent(content: string | null): ParsedReportContent {
  const parsed: ParsedReportContent = {
    title: null,
    stats: [],
    topListings: [],
    providers: [],
    notes: [],
  };

  if (!content) return parsed;

  let section: "top" | "providers" | null = null;
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("Report ")) {
      parsed.title = line;
      continue;
    }

    if (line === "Top 5 priorita alta:") {
      section = "top";
      continue;
    }

    if (line === "Provider eseguiti:") {
      section = "providers";
      continue;
    }

    const statMatch = line.match(/^([^:]+):\s*(.+)$/);
    if (statMatch && reportStatLabels.has(statMatch[1])) {
      parsed.stats.push({ label: statMatch[1], value: statMatch[2] });
      continue;
    }

    if (section === "top") {
      const listingMatch = line.match(
        /^(\d+)\.\s+(.+?)\s+\|\s+score\s+(-?\d+)\s+\|\s+([^|]+)\s+\|\s+(.+)$/i,
      );

      if (listingMatch) {
        parsed.topListings.push({
          position: listingMatch[1],
          title: listingMatch[2],
          score: listingMatch[3],
          source: listingMatch[4].trim(),
          zone: listingMatch[5].trim(),
        });
        continue;
      }
    }

    if (section === "providers") {
      const providerMatch = line.match(/^([^:]+):\s*(.+)$/);

      if (providerMatch) {
        parsed.providers.push({
          name: providerMatch[1],
          details: providerMatch[2].split(", ").filter(Boolean),
        });
        continue;
      }
    }

    parsed.notes.push(line);
  }

  return parsed;
}

function ReportContent({ content }: Readonly<{ content: string | null }>) {
  const parsed = parseReportContent(content);

  if (!content) return null;

  return (
    <div className="border-t border-[var(--line-soft)] p-5">
      {parsed.title ? (
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
          {parsed.title}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.3fr]">
        {parsed.stats.length ? (
          <section className="rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] p-4">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">
              Sintesi del controllo
            </h3>
            <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
              {parsed.stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-[6px] border border-[var(--line-soft)] bg-[var(--surface-panel)] px-3 py-2.5"
                >
                  <dt className="text-[11px] text-[var(--ink-subtle)]">
                    {stat.label}
                  </dt>
                  <dd className="mt-1 text-lg font-semibold leading-none text-[var(--ink-strong)]">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <section className="rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">
              Annunci più interessanti
            </h3>
            <span className="text-xs text-[var(--ink-subtle)]">
              {formatNumber(parsed.topListings.length)} in evidenza
            </span>
          </div>

          {parsed.topListings.length ? (
            <ol className="mt-4 divide-y divide-[var(--line-soft)]">
              {parsed.topListings.map((listing) => (
                <li
                  key={`${listing.position}-${listing.title}`}
                  className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[2rem_minmax(0,1fr)_auto]"
                >
                  <span className="flex size-8 items-center justify-center rounded-md bg-[var(--surface-accent-soft)] text-sm font-bold text-[var(--surface-accent)]">
                    {listing.position}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold leading-5 text-[var(--ink-strong)]">
                      {listing.title}
                    </p>
                    <p className="mt-1 text-xs text-[var(--ink-subtle)]">
                      {listing.source} · {listing.zone}
                    </p>
                  </div>
                  <div className="w-fit rounded-md border border-[var(--line-soft)] bg-[var(--surface-panel)] px-3 py-2 text-right">
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                      Score
                    </p>
                    <p className="text-base font-semibold leading-none text-[var(--ink-strong)]">
                      {listing.score}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 rounded-[6px] border border-dashed border-[var(--line-strong)] px-4 py-6 text-sm text-[var(--ink-soft)]">
              Nessun annuncio prioritario in questo riepilogo.
            </p>
          )}
        </section>
      </div>

      {parsed.providers.length ? (
        <section className="mt-4 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] p-4">
          <h3 className="text-sm font-semibold text-[var(--ink-strong)]">
            Fonti controllate
          </h3>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {parsed.providers.map((provider) => (
              <div
                key={provider.name}
                className="rounded-[6px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-3"
              >
                <p className="text-sm font-semibold capitalize text-[var(--ink-strong)]">
                  {provider.name}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {provider.details.map((detail) => (
                    <span
                      key={detail}
                      className="rounded-md border border-[var(--line-soft)] bg-[var(--surface-muted)] px-2 py-1 text-[11px] leading-4 text-[var(--ink-soft)]"
                    >
                      {detail}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {parsed.notes.length ? (
        <section className="mt-4 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] p-4">
          <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Note</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--ink-soft)]">
            {parsed.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default async function ReportsPage() {
  const reports = await getReports();

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Andamento nel tempo"
        title="Riepiloghi giornalieri"
        description="Una fotografia semplice di quello che il radar ha trovato ogni giorno."
      />

      <section className="space-y-4">
        {reports.length ? (
          reports.map((report, index) => (
            <article
              key={report.id}
              className="overflow-hidden rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]"
            >
              <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs text-[var(--ink-subtle)]">Giornata</p>
                  <h2 className="mt-1 text-xl font-semibold text-[var(--ink-strong)]">
                    {formatDate(report.reportDate)}
                  </h2>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge tone="slate">
                    {formatNumber(report.totalFound)} trovati
                  </Badge>
                  <Badge tone="green">
                    {formatNumber(report.newCount)} nuovi
                  </Badge>
                  <Badge tone="green">
                    {formatNumber(report.privateCount)} privati
                  </Badge>
                  <Badge tone="blue">
                    {formatNumber(report.agencyCount)} agenzie
                  </Badge>
                  <Badge tone="amber">
                    {formatNumber(report.unknownCount)} da verificare
                  </Badge>
                  <Badge tone="red">
                    {formatNumber(report.priceDropsCount)} ribassi
                  </Badge>
                </div>
              </div>

              {report.content ? (
                <details className="border-t border-[var(--line-soft)]" open={index === 0}>
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-5 text-sm font-semibold text-[var(--ink-strong)] marker:hidden">
                    <span>Leggi il riepilogo completo</span>
                    <span className="text-xs font-medium text-[var(--ink-subtle)]">
                      Analisi, classifica e fonti
                    </span>
                  </summary>
                  <ReportContent content={report.content} />
                </details>
              ) : null}
            </article>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--line-strong)] px-6 py-16 text-center">
            <p className="text-base font-semibold text-[var(--ink-strong)]">
              Nessun riepilogo disponibile
            </p>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              Il primo riepilogo comparira dopo un controllo completo.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
