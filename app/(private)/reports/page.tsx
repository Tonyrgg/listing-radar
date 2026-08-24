import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Meta,
  buttonClass,
} from "@/components/ui/primitives";
import { getReports } from "@/lib/data/repository";
import { formatDate, formatNumber } from "@/lib/formatting";
import { getSourceLabel } from "@/lib/labels";
import type { Report } from "@/types";

export const metadata: Metadata = { title: "Riepiloghi" };

type TopListing = {
  position: string;
  title: string;
  score: string;
  source: string;
  zone: string;
};

/**
 * I numeri arrivano dalle colonne del riepilogo, non da un'analisi del testo.
 * Del blocco testuale resta da leggere soltanto la classifica.
 */
function parseTopListings(content: string | null): TopListing[] {
  if (!content) return [];

  const listings: TopListing[] = [];
  let inSection = false;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    if (!line) continue;

    if (/^Top \d+/i.test(line) || /priorit[aà] alta:$/i.test(line)) {
      inSection = true;
      continue;
    }

    if (!inSection) continue;

    const match = line.match(
      /^(\d+)\.\s+(.+?)\s+\|\s+score\s+(-?\d+)\s+\|\s+([^|]+)\s+\|\s+(.+)$/i,
    );

    if (match) {
      listings.push({
        position: match[1],
        title: match[2],
        score: match[3],
        source: match[4].trim(),
        zone: match[5].trim(),
      });
    }
  }

  return listings;
}

function statsFor(report: Report) {
  return [
    { label: "Annunci trovati", value: report.totalFound },
    { label: "Nuovi", value: report.newCount },
    { label: "Da privato", value: report.privateCount },
    { label: "Da agenzia", value: report.agencyCount },
    { label: "Venditore da verificare", value: report.unknownCount },
    { label: "Ribassi di prezzo", value: report.priceDropsCount },
    { label: "Online da molto tempo", value: report.hotOldCount },
  ];
}

function ReportCard({ report }: Readonly<{ report: Report }>) {
  const stats = statsFor(report);
  const top = parseTopListings(report.content);

  return (
    <Card>
      <CardHeader
        title={formatDate(report.reportDate)}
        meta={`${formatNumber(report.totalFound)} annunci controllati · ${formatNumber(report.newCount)} nuovi`}
        action={
          report.newCount ? <Chip tone="info">{report.newCount} nuovi</Chip> : null
        }
      />

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <p className="text-[length:var(--lr-text-label)] font-[650] uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
            Com&apos;è andato il controllo
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-[var(--lr-radius-control)] border border-[var(--lr-line-quiet)] px-3 py-2"
              >
                <dt className="text-[length:var(--lr-text-label)] text-[var(--lr-ink-3)]">
                  {stat.label}
                </dt>
                <dd className="mt-0.5 text-[length:var(--lr-text-section)] font-[650] leading-none tabular-nums text-[var(--lr-ink)]">
                  {formatNumber(stat.value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <p className="text-[length:var(--lr-text-label)] font-[650] uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
            Quelli che meritavano una telefonata
          </p>
          {top.length ? (
            <ol className="mt-3 divide-y divide-[var(--lr-line-quiet)]">
              {top.map((listing) => (
                <li
                  key={`${report.id}-${listing.position}`}
                  className="flex items-start gap-3 py-2.5 first:pt-0"
                >
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-[var(--lr-line)] text-[length:var(--lr-text-label)] tabular-nums text-[var(--lr-ink-3)]">
                    {listing.position}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink)]">
                      {listing.title}
                    </span>
                    <Meta className="truncate">
                      {getSourceLabel(listing.source)}
                      {listing.zone && listing.zone !== "zona n/d" ? ` · ${listing.zone}` : ""}
                    </Meta>
                  </span>
                  <span className="shrink-0 text-[length:var(--lr-text-body)] font-[650] tabular-nums text-[var(--lr-ink)]">
                    {listing.score}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
              Nessun annuncio ha superato la soglia di appetibilità in questa giornata.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export default async function ReportsPage() {
  const reports = await getReports();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Oggi"
        title="Riepiloghi giornalieri"
        description="Cosa hanno trovato i controlli automatici, giorno per giorno."
      />

      {reports.length ? (
        <div className="space-y-4">
          {reports.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            title="Nessun riepilogo registrato"
            description="I riepiloghi compaiono qui dopo il primo controllo automatico completato."
            action={
              <Link href="/settings" className={buttonClass("secondary", { compact: true })}>
                Vedi lo stato delle automazioni
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}
