import Link from "next/link";

import { Badge, getSellerTypeTone, getStatusTone } from "@/components/badge";
import { StatCard } from "@/components/stat-card";
import { getDashboardSummary } from "@/lib/data/repository";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/formatting";
import { HIGH_PRIORITY_THRESHOLD } from "@/lib/listings/scoring";

export default async function DashboardPage() {
  const summary = await getDashboardSummary();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
          Dashboard
        </p>
        <h2 className="text-3xl font-semibold text-[var(--ink-strong)]">
          Overview operativo su Bitonto
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">
          Vista compatta dei segnali che meritano controllo manuale prioritario.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Nuovi oggi" value={summary.newToday} />
        <StatCard label="Privati probabili" value={summary.probablePrivate} />
        <StatCard label="Agenzie" value={summary.agencies} />
        <StatCard label="Da verificare" value={summary.toVerify} />
        <StatCard label="Ribassi" value={summary.priceDrops} />
        <StatCard label="Annunci vecchi caldi" value={summary.hotOld} />
        <StatCard
          label="Priorità alta"
          value={summary.highPriority}
          hint={`Soglia score ${HIGH_PRIORITY_THRESHOLD}+`}
        />
      </section>

      <section className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] shadow-[var(--shadow-panel)]">
        <div className="border-b border-[var(--line-soft)] px-5 py-4">
          <h3 className="text-lg font-semibold text-[var(--ink-strong)]">
            Da guardare subito
          </h3>
        </div>
        <div className="divide-y divide-[var(--line-soft)]">
          {summary.watchlist.map((listing) => (
            <article
              key={listing.id}
              className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={getSellerTypeTone(listing.sellerType)}>
                      {listing.sellerType}
                    </Badge>
                    <Badge tone={getStatusTone(listing.status)}>{listing.status}</Badge>
                    {listing.isPriceDropped ? <Badge tone="red">ribasso</Badge> : null}
                  </div>
                  <h4 className="text-lg font-semibold text-[var(--ink-strong)]">
                    <Link href={`/listings/${listing.id}`} className="hover:underline">
                      {listing.title}
                    </Link>
                  </h4>
                  <p className="text-sm text-[var(--ink-soft)]">
                    {listing.source} · {listing.zone ?? "Zona n/d"} ·{" "}
                    {formatNumber(listing.minimumDaysOnline)} giorni online minimi
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                      Prezzo
                    </p>
                    <p className="mt-1 text-sm font-medium text-[var(--ink-strong)]">
                      {formatCurrency(listing.price)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                      MQ
                    </p>
                    <p className="mt-1 text-sm font-medium text-[var(--ink-strong)]">
                      {formatNumber(listing.sqm)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                      Fatigue
                    </p>
                    <p className="mt-1 text-sm font-medium text-[var(--ink-strong)]">
                      {formatNumber(listing.sellerFatigueScore)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                      Ultimo controllo
                    </p>
                    <p className="mt-1 text-sm font-medium text-[var(--ink-strong)]">
                      {formatDateTime(listing.lastSeenAt)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-start justify-between gap-6 lg:flex-col lg:items-end">
                <div className="text-right">
                  <p className="text-xs uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                    Priority score
                  </p>
                  <p className="mt-1 text-3xl font-semibold text-[var(--ink-strong)]">
                    {listing.priorityScore}
                  </p>
                </div>
                <Link
                  href={`/listings/${listing.id}`}
                  className="text-sm font-medium text-[var(--surface-accent)] hover:underline"
                >
                  Apri scheda
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
