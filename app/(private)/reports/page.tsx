import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getReports } from "@/lib/data/repository";
import { formatDate, formatNumber } from "@/lib/formatting";

export const metadata: Metadata = {
  title: "Riepiloghi giornalieri",
};

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
          reports.map((report) => (
            <article
              key={report.id}
              className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)]"
            >
              <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--surface-accent)]">
                    <CalendarDays aria-hidden="true" className="size-5" />
                  </span>
                  <div>
                    <p className="text-xs text-[var(--ink-subtle)]">Giornata</p>
                    <h2 className="mt-1 text-xl font-semibold text-[var(--ink-strong)]">
                      {formatDate(report.reportDate)}
                    </h2>
                  </div>
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
                <details className="border-t border-[var(--line-soft)]">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center px-5 text-sm font-medium text-[var(--ink-strong)] marker:hidden">
                    Leggi il riepilogo completo
                  </summary>
                  <p className="whitespace-pre-wrap border-t border-[var(--line-soft)] px-5 py-5 text-sm leading-7 text-[var(--ink-soft)]">
                    {report.content}
                  </p>
                </details>
              ) : null}
            </article>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--line-strong)] px-6 py-16 text-center">
            <CalendarDays
              aria-hidden="true"
              className="mx-auto size-7 text-[var(--surface-accent)]"
            />
            <p className="mt-4 text-base font-semibold text-[var(--ink-strong)]">
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
