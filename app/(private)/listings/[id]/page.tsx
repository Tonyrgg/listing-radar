import { notFound } from "next/navigation";

import { Badge, getSellerTypeTone, getStatusTone } from "@/components/badge";
import { getListingById } from "@/lib/data/repository";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPlainText,
} from "@/lib/formatting";
import { getOperationalSuggestion } from "@/lib/listings/operational";

function DetailItem({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
        {label}
      </p>
      <p className="mt-2 text-sm leading-6 text-[var(--ink-strong)]">{value}</p>
    </div>
  );
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await getListingById(id);

  if (!listing) {
    notFound();
  }

  const operationalSuggestion = getOperationalSuggestion(listing);

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={getSellerTypeTone(listing.sellerType)}>
            {listing.sellerType}
          </Badge>
          <Badge tone={getStatusTone(listing.status)}>{listing.status}</Badge>
          {listing.isPriceDropped ? <Badge tone="red">ribasso</Badge> : null}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
            Dettaglio annuncio
          </p>
          <h2 className="text-3xl font-semibold text-[var(--ink-strong)]">
            {listing.title}
          </h2>
          <p className="text-sm leading-6 text-[var(--ink-soft)]">
            {listing.source} · {formatPlainText(listing.zone)} · score{" "}
            {formatNumber(listing.priorityScore)}
          </p>
        </div>
        <a
          href={listing.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex text-sm font-medium text-[var(--surface-accent)] hover:underline"
        >
          Apri annuncio originale
        </a>
      </header>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[var(--shadow-panel)]">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            <DetailItem label="Prezzo" value={formatCurrency(listing.price)} />
            <DetailItem label="MQ" value={formatNumber(listing.sqm)} />
            <DetailItem
              label="Prezzo/MQ"
              value={formatCurrency(listing.pricePerSqm)}
            />
            <DetailItem label="Zona" value={formatPlainText(listing.zone)} />
            <DetailItem label="Locali" value={formatNumber(listing.rooms)} />
            <DetailItem label="Piano" value={formatPlainText(listing.floor)} />
            <DetailItem label="Fonte" value={listing.source} />
            <DetailItem
              label="Seller name"
              value={formatPlainText(listing.sellerName)}
            />
            <DetailItem label="Telefono" value={formatPlainText(listing.phone)} />
            <DetailItem
              label="First seen at"
              value={formatDateTime(listing.firstSeenAt)}
            />
            <DetailItem
              label="Last seen at"
              value={formatDateTime(listing.lastSeenAt)}
            />
            <DetailItem
              label="Portal declared date"
              value={formatDate(listing.portalDeclaredDate)}
            />
            <DetailItem
              label="Metadata date published"
              value={formatDate(listing.metadataDatePublished)}
            />
            <DetailItem
              label="Metadata date modified"
              value={formatDate(listing.metadataDateModified)}
            />
            <DetailItem
              label="Giorni online minimi"
              value={formatNumber(listing.minimumDaysOnline)}
            />
            <DetailItem
              label="Priority score"
              value={formatNumber(listing.priorityScore)}
            />
            <DetailItem
              label="Seller fatigue score"
              value={formatNumber(listing.sellerFatigueScore)}
            />
          </div>
        </article>

        <aside className="space-y-4">
          <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[var(--shadow-panel)]">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Suggerimento operativo
            </p>
            <p className="mt-3 text-sm leading-7 text-[var(--ink-strong)]">
              {operationalSuggestion}
            </p>
          </article>

          <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[var(--shadow-panel)]">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              Note
            </p>
            <p className="mt-3 text-sm leading-7 text-[var(--ink-strong)]">
              {formatPlainText(listing.note)}
            </p>
          </article>
        </aside>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[var(--shadow-panel)]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
            Descrizione
          </p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--ink-strong)]">
            {formatPlainText(listing.description)}
          </p>
        </article>

        <article className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 shadow-[var(--shadow-panel)]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
            Storico fonti
          </p>
          <div className="mt-4 space-y-3">
            {(listing.sources ?? []).map((source) => (
              <div
                key={source.id}
                className="rounded-md border border-[var(--line-soft)] bg-[var(--surface-canvas)] p-3"
              >
                <p className="text-sm font-medium text-[var(--ink-strong)]">
                  {source.source}
                </p>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">{source.url}</p>
                <p className="mt-2 text-xs text-[var(--ink-subtle)]">
                  First seen {formatDateTime(source.firstSeenAt)} · Last seen{" "}
                  {formatDateTime(source.lastSeenAt)}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-panel)] shadow-[var(--shadow-panel)]">
        <div className="border-b border-[var(--line-soft)] px-5 py-4">
          <h3 className="text-lg font-semibold text-[var(--ink-strong)]">
            Storico snapshots
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--surface-muted)] text-xs uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Checked at</th>
                <th className="px-4 py-3 font-semibold">Fonte</th>
                <th className="px-4 py-3 font-semibold">Prezzo</th>
                <th className="px-4 py-3 font-semibold">Disponibile</th>
                <th className="px-4 py-3 font-semibold">URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line-soft)]">
              {(listing.snapshots ?? []).map((snapshot) => (
                <tr key={snapshot.id}>
                  <td className="px-4 py-4 text-[var(--ink-soft)]">
                    {formatDateTime(snapshot.checkedAt)}
                  </td>
                  <td className="px-4 py-4 text-[var(--ink-soft)]">{snapshot.source}</td>
                  <td className="px-4 py-4 text-[var(--ink-strong)]">
                    {formatCurrency(snapshot.price)}
                  </td>
                  <td className="px-4 py-4 text-[var(--ink-soft)]">
                    {snapshot.isAvailable ? "true" : "false"}
                  </td>
                  <td className="px-4 py-4">
                    <a
                      href={snapshot.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--surface-accent)] hover:underline"
                    >
                      Apri
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
