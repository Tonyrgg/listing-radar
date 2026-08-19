import { Activity, ArrowRight, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";

import {
  formatDateTime,
  LifecycleEmpty,
  LifecycleHeader,
  LifecycleUnavailable,
  SignalPill,
} from "../_components/ui";
import styles from "../lifecycle.module.css";

export const metadata: Metadata = { title: "Agencies · Lifecycle" };

function healthTone(state: string | null): "good" | "high" | "default" {
  if (state === "HEALTHY") return "good";
  if (state) return "high";
  return "default";
}

export default async function LifecycleAgenciesPage() {
  await connection();
  const view = await loadLifecycleView((repository) => repository.agencies());
  if (!view.available || !view.data) return <LifecycleUnavailable message={view.message} />;
  const agencies = view.data;

  return (
    <>
      <LifecycleHeader
        eyebrow="Source operations"
        title="Dieci agenzie, salute visibile."
        description="Inventario, uscite e segnali di vendita restano separati dalla salute tecnica del crawler. Una fonte degradata non può produrre false sparizioni."
        actions={<Activity aria-hidden="true" className="size-6 text-[var(--surface-accent)]" />}
      />
      {agencies.length ? (
        <section className={styles.agencyGrid} aria-label="Agenzie monitorate">
          {agencies.map((agency) => (
            <article key={agency.id} className={styles.agencyCard}>
              <div className={styles.agencyTop}>
                <SignalPill tone={healthTone(agency.latestHealth)}>
                  {agency.latestHealth ?? "Mai controllata"}
                </SignalPill>
                <span className={styles.rowMeta}>{formatDateTime(agency.latestHealthAt)}</span>
              </div>
              <div>
                <h2 className={styles.rowTitle}>{agency.name}</h2>
                <p className={`${styles.muted} mt-1`}>
                  {agency.latestSyncCounts
                    ? `${agency.latestSyncCounts.inScope} in area · ${agency.latestSyncCounts.excluded} esclusi`
                    : "Nessun run registrato"}
                </p>
              </div>
              <div className={styles.agencyCounts}>
                <div><strong>{agency.activeCount}</strong><span>attivi</span></div>
                <div><strong>{agency.exitedCount}</strong><span>uscite</span></div>
                <div><strong>{agency.soldCount}</strong><span>venduti</span></div>
              </div>
              {agency.latestSyncCounts?.errors ? (
                <p className="flex items-center gap-2 text-xs text-[var(--status-warning)]">
                  <ShieldAlert aria-hidden="true" className="size-3.5" />
                  {agency.latestSyncCounts.errors} errori nell&apos;ultimo run
                </p>
              ) : null}
              <Link href={`/lifecycle/agencies/${agency.slug}`} className={styles.secondaryAction}>
                Apri agenzia
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </article>
          ))}
        </section>
      ) : (
        <LifecycleEmpty
          title="Nessuna agenzia configurata"
          description="Le agenzie seed vengono create dalle migrazioni V2 additive."
        />
      )}
    </>
  );
}
