import { ArrowUpRight, Flame } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { opportunityReasonLabel } from "@/lib/property-lifecycle/read-models/presentation";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";

import {
  formatDate,
  LifecycleEmpty,
  LifecycleHeader,
  LifecycleSection,
  LifecycleUnavailable,
  PropertyFacts,
  SignalPill,
} from "../_components/ui";
import styles from "../lifecycle.module.css";

export const metadata: Metadata = { title: "Opportunities · Lifecycle" };

export default async function LifecycleOpportunitiesPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await connection();
  const filter = String((await searchParams).level ?? "ALL").toUpperCase();
  const view = await loadLifecycleView((repository) => repository.opportunities());
  if (!view.available || !view.data) return <LifecycleUnavailable message={view.message} />;
  const items = view.data.filter(
    (item) => filter === "ALL" || item.level === filter,
  );
  const levels = ["ALL", "HOT", "HIGH", "INTERESTING", "WATCH"];

  return (
    <>
      <LifecycleHeader
        eyebrow="Acquisition radar"
        title="Opportunità con una ragione leggibile."
        description="Il punteggio ordina il lavoro; non sostituisce il giudizio. Passaggi a privato e uscite senza prova di vendita restano in testa."
        actions={<Flame aria-hidden="true" className="size-6 text-[var(--radar-hot)]" />}
      />
      <div className={styles.filters} aria-label="Filtra priorità">
        {levels.map((level) => (
          <Link
            key={level}
            href={level === "ALL" ? "/lifecycle/opportunities" : `/lifecycle/opportunities?level=${level}`}
            className={`${styles.filter} ${filter === level ? styles.filterActive : ""}`}
          >
            {level === "ALL" ? "Tutte" : level}
          </Link>
        ))}
      </div>
      <LifecycleSection
        title={`${items.length} opportunità`}
        description="Ordinate per priorità e score"
      >
        {items.length ? (
          <div className={styles.rows}>
            {items.map((item) => (
              <article key={item.id} className={styles.propertyRow}>
                <div>
                  <div className={styles.rowTop}>
                    <div className="flex flex-wrap items-center gap-2">
                      <SignalPill tone={item.level === "HOT" ? "hot" : item.level === "HIGH" ? "high" : "cool"}>
                        {item.level}
                      </SignalPill>
                      <span className={styles.rowMeta}>Rilevata {formatDate(item.detectedAt)}</span>
                    </div>
                    <span className={styles.rowMeta}>score {item.score ?? 0}</span>
                  </div>
                  <Link
                    href={`/lifecycle/archive/${item.propertyId}`}
                    className={`${styles.rowTitle} mt-3 block`}
                  >
                    {item.property.title}
                  </Link>
                  <div className="mt-2"><PropertyFacts property={item.property} /></div>
                  <ul className={`${styles.reasonList} mt-3`}>
                    {item.reasons.map((reason) => (
                      <li key={reason}>{opportunityReasonLabel(reason)}</li>
                    ))}
                  </ul>
                </div>
                <Link href={`/lifecycle/archive/${item.propertyId}`} className={styles.secondaryAction}>
                  Apri dossier
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <LifecycleEmpty
            title="Nessuna opportunità in questo livello"
            description="Prova un altro filtro oppure attendi nuovi segnali dal worker lifecycle."
          />
        )}
      </LifecycleSection>
    </>
  );
}
