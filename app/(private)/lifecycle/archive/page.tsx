import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import {
  propertyStateLabel,
} from "@/lib/property-lifecycle/read-models/presentation";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";

import {
  ageDays,
  formatCurrency,
  LifecycleEmpty,
  LifecycleHeader,
  LifecycleSection,
  LifecycleUnavailable,
  SignalPill,
} from "../_components/ui";
import styles from "../lifecycle.module.css";

export const metadata: Metadata = { title: "Archive · Lifecycle" };

export default async function LifecycleArchivePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await connection();
  const params = await searchParams;
  const query = String(params.q ?? "").trim().toLocaleLowerCase("it");
  const state = String(params.state ?? "ALL").toUpperCase();
  const view = await loadLifecycleView((repository) => repository.archive());
  if (!view.available || !view.data) return <LifecycleUnavailable message={view.message} />;
  const properties = view.data.filter((property) => {
    const matchesState = state === "ALL" || property.propertyState === state;
    const searchable = [
      property.title,
      property.address,
      property.locality,
      ...property.agencies.map((agency) => agency.name),
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("it");
    return matchesState && (!query || searchable.includes(query));
  });

  return (
    <>
      <LifecycleHeader
        eyebrow="Physical property archive"
        title="Una storia per ogni immobile."
        description="URL, agenzie e rilanci cambiano. Il dossier della proprietà conserva età reale, passaggi, prove e ambiguità."
      />
      <form method="get" className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_240px_auto]">
        <label className={styles.manualLabel}>
          <span className="sr-only">Cerca archivio</span>
          <input
            name="q"
            defaultValue={String(params.q ?? "")}
            placeholder="Indirizzo, titolo o agenzia"
            className={styles.input}
          />
        </label>
        <label className={styles.manualLabel}>
          <span className="sr-only">Stato proprietà</span>
          <select name="state" defaultValue={state} className={styles.select}>
            <option value="ALL">Tutti gli stati</option>
            <option value="ACTIVE_AGENCY">Attivi in agenzia</option>
            <option value="ACTIVE_PRIVATE">Attivi da privato</option>
            <option value="ACTIVE_MULTI_AGENCY">Multi-agenzia</option>
            <option value="ACTIVE_AGENCY_AND_PRIVATE">Agenzia e privato</option>
            <option value="OFF_MARKET_UNKNOWN">Fuori mercato</option>
            <option value="SOLD">Venduti</option>
          </select>
        </label>
        <button type="submit" className={styles.secondaryAction}>
          <Search aria-hidden="true" className="size-4" />
          Cerca
        </button>
      </form>
      <LifecycleSection
        title={`${properties.length} proprietà`}
        description="Massimo 300 dossier recenti"
      >
        {properties.length ? (
          <div className={styles.rows}>
            {properties.map((property) => {
              const age = ageDays(property.trueMarketStartUpperBound);
              return (
                <article key={property.id} className={styles.propertyRow}>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <SignalPill tone={property.propertyState.includes("ACTIVE") ? "good" : property.propertyState === "SOLD" ? "cool" : "high"}>
                        {propertyStateLabel(property.propertyState)}
                      </SignalPill>
                      <SignalPill>{property.identityStatus}</SignalPill>
                    </div>
                    <Link
                      href={`/lifecycle/archive/${property.id}`}
                      className={`${styles.rowTitle} mt-3 block`}
                    >
                      {property.title}
                    </Link>
                    <p className={`${styles.muted} mt-1`}>
                      {[property.address, property.locality].filter(Boolean).join(" · ") || "Posizione da verificare"}
                    </p>
                    <div className={`${styles.propertyFacts} mt-2`}>
                      <strong>{formatCurrency(property.currentPrice)}</strong>
                      <span>{age == null ? "Età reale ignota" : `${age} giorni reali`}</span>
                      <span>{property.agencies.length} agenzie storiche</span>
                      <span>{property.relaunchCount} rilanci</span>
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
            title="Nessun dossier corrisponde"
            description="Riduci i filtri oppure attendi il primo bootstrap approvato."
          />
        )}
      </LifecycleSection>
    </>
  );
}
