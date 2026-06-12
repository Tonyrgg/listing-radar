import { Badge } from "@/components/badge";
import { getReports } from "@/lib/data/repository";
import { formatDate, formatNumber } from "@/lib/formatting";

export default async function ReportsPage() {
  const reports = await getReports();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
          Reports
        </p>
        <h2 className="text-3xl font-semibold text-[var(--ink-strong)]">
          Report giornalieri salvati
        </h2>
      </header>

      <div className="space-y-4">
        {reports.map((report) => (
          <article
            key={report.id}
            className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[var(--shadow-panel)]"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                  Report date
                </p>
                <h3 className="text-2xl font-semibold text-[var(--ink-strong)]">
                  {formatDate(report.reportDate)}
                </h3>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge tone="slate">Totale {formatNumber(report.totalFound)}</Badge>
                <Badge tone="green">Nuovi {formatNumber(report.newCount)}</Badge>
                <Badge tone="green">Privati {formatNumber(report.privateCount)}</Badge>
                <Badge tone="blue">Agenzie {formatNumber(report.agencyCount)}</Badge>
                <Badge tone="amber">Unknown {formatNumber(report.unknownCount)}</Badge>
                <Badge tone="red">Ribassi {formatNumber(report.priceDropsCount)}</Badge>
                <Badge tone="slate">Vecchi caldi {formatNumber(report.hotOldCount)}</Badge>
              </div>
            </div>

            <pre className="mt-5 whitespace-pre-wrap text-sm leading-7 text-[var(--ink-strong)]">
              {report.content}
            </pre>
          </article>
        ))}
      </div>
    </div>
  );
}
