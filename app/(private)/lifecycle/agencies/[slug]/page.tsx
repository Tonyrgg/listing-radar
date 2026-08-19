import { ArrowLeft, RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { PendingSubmitButton } from "@/components/loading-controls";
import {
  agencyListingStateLabel,
  propertyStateLabel,
} from "@/lib/property-lifecycle/read-models/presentation";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";
import type { LifecyclePropertySummary } from "@/lib/property-lifecycle/read-models/types";

import { enqueueAgencyLifecycleRefresh } from "../../actions";
import {
  ageDays,
  formatCurrency,
  formatDateTime,
  LifecycleEmpty,
  LifecycleHeader,
  LifecycleSection,
  LifecycleUnavailable,
  SignalPill,
} from "../../_components/ui";
import styles from "../../lifecycle.module.css";

export const metadata: Metadata = { title: "Agency detail · Lifecycle" };

const filters = [
  ["all", "Tutti"],
  ["new", "Nuovi"],
  ["lt90", "<90 giorni"],
  ["90-150", "90–150"],
  ["150-180", "150–180"],
  ["gt180", ">180"],
  ["price", "Prezzo ridotto"],
  ["exited", "Usciti"],
  ["sold", "Venduti"],
] as const;

function filterInventory(
  items: LifecyclePropertySummary[],
  slug: string,
  filter: string,
  newIds: Set<string>,
  priceIds: Set<string>,
) {
  return items.filter((property) => {
    const agency = property.agencies.find((item) => item.slug === slug);
    const age = ageDays(property.trueMarketStartUpperBound);
    if (filter === "new") return newIds.has(property.id);
    if (filter === "lt90") return age != null && age < 90;
    if (filter === "90-150") return age != null && age >= 90 && age < 150;
    if (filter === "150-180") return age != null && age >= 150 && age <= 180;
    if (filter === "gt180") return age != null && age > 180;
    if (filter === "price") return priceIds.has(property.id);
    if (filter === "exited") return agency?.state !== "ACTIVE";
    if (filter === "sold") {
      return agency?.state === "CLOSED_SOLD" || property.saleStatus === "SOLD_CONFIRMED";
    }
    return true;
  });
}

export default async function LifecycleAgencyDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await connection();
  const { slug } = await params;
  const filter = String((await searchParams).filter ?? "all");
  const view = await loadLifecycleView((repository) => repository.agency(slug));
  if (!view.available) return <LifecycleUnavailable message={view.message} />;
  if (!view.data) notFound();
  const detail = view.data;
  const inventory = filterInventory(
    detail.inventory,
    slug,
    filter,
    new Set(detail.newPropertyIds),
    new Set(detail.priceReducedPropertyIds),
  );

  return (
    <>
      <Link href="/lifecycle/agencies" className={styles.textAction}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        Tutte le agenzie
      </Link>
      <LifecycleHeader
        eyebrow="Agency dossier"
        title={detail.agency.name}
        description={`${detail.agency.activeCount} attivi · ${detail.agency.exitedCount} uscite · ultimo sync ${formatDateTime(detail.agency.latestSyncAt)}`}
        actions={
          <form action={enqueueAgencyLifecycleRefresh}>
            <input type="hidden" name="agencySlug" value={slug} />
            <PendingSubmitButton
              type="submit"
              pendingLabel="Accodo il refresh"
              icon={<RefreshCw aria-hidden="true" className="size-4" />}
              className={styles.primaryAction}
            >
              Refresh {detail.agency.name}
            </PendingSubmitButton>
          </form>
        }
      />

      <div className={styles.filters} aria-label="Filtra inventario agenzia">
        {filters.map(([value, label]) => (
          <Link
            key={value}
            href={value === "all" ? `/lifecycle/agencies/${slug}` : `/lifecycle/agencies/${slug}?filter=${value}`}
            className={`${styles.filter} ${filter === value ? styles.filterActive : ""}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className={styles.detailGrid}>
        <LifecycleSection
          title={`${inventory.length} immobili`}
          description="Inventario ricondotto alla proprietà fisica"
        >
          {inventory.length ? (
            <div className={styles.rows}>
              {inventory.map((property) => {
                const agency = property.agencies.find((item) => item.slug === slug);
                const age = ageDays(property.trueMarketStartUpperBound);
                return (
                  <article key={property.id} className={styles.propertyRow}>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <SignalPill tone={agency?.state === "ACTIVE" ? "good" : "high"}>
                          {agencyListingStateLabel(agency?.state ?? "UNKNOWN")}
                        </SignalPill>
                        {detail.priceReducedPropertyIds.includes(property.id) ? (
                          <SignalPill tone="high">Prezzo ridotto</SignalPill>
                        ) : null}
                      </div>
                      <Link
                        href={`/lifecycle/archive/${property.id}`}
                        className={`${styles.rowTitle} mt-3 block`}
                      >
                        {property.title}
                      </Link>
                      <div className={`${styles.propertyFacts} mt-2`}>
                        <strong>{formatCurrency(property.currentPrice)}</strong>
                        <span>{age == null ? "Età ignota" : `${age} giorni reali`}</span>
                        <span>{propertyStateLabel(property.propertyState)}</span>
                      </div>
                    </div>
                    <Link href={`/lifecycle/archive/${property.id}`} className={styles.secondaryAction}>
                      Apri dossier
                    </Link>
                  </article>
                );
              })}
            </div>
          ) : (
            <LifecycleEmpty
              title="Nessun immobile nel filtro"
              description="La selezione non contiene proprietà osservate per questa agenzia."
            />
          )}
        </LifecycleSection>

        <LifecycleSection title="Ultimi run" description="Salute e copertura della fonte">
          {detail.recentRuns.length ? (
            <div className={styles.rows}>
              {detail.recentRuns.map((run) => (
                <article key={run.id} className={styles.row}>
                  <div className={styles.rowTop}>
                    <SignalPill tone={run.healthState === "HEALTHY" ? "good" : "high"}>
                      {run.healthState ?? run.status}
                    </SignalPill>
                    <span className={styles.rowMeta}>{formatDateTime(run.finishedAt ?? run.startedAt)}</span>
                  </div>
                  <p className={styles.muted}>
                    {run.inScopeCount} in area · {run.excludedCount} esclusi · {run.errorCount} errori
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <LifecycleEmpty title="Nessun run" description="Il worker non ha ancora elaborato questa fonte." />
          )}
        </LifecycleSection>
      </div>
    </>
  );
}
