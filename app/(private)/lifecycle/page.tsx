import { ArrowRight, Crosshair, Radar } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { CSSProperties } from "react";

import {
  lifecycleEventLabel,
  opportunityReasonLabel,
} from "@/lib/property-lifecycle/read-models/presentation";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";

import {
  formatDateTime,
  LifecycleEmpty,
  LifecycleHeader,
  LifecycleSection,
  LifecycleUnavailable,
  PropertyFacts,
  PropertyLink,
  SignalPill,
} from "./_components/ui";
import styles from "./lifecycle.module.css";

export const metadata: Metadata = { title: "Property Lifecycle" };

function opportunityTone(level: string): "hot" | "high" | "cool" {
  if (level === "HOT") return "hot";
  if (level === "HIGH") return "high";
  return "cool";
}

export default async function LifecycleDashboardPage() {
  await connection();
  const view = await loadLifecycleView((repository) => repository.dashboard());
  if (!view.available || !view.data) {
    return <LifecycleUnavailable message={view.message} />;
  }
  const dashboard = view.data;
  const metrics = [
    [dashboard.metrics.totalProperties, "Proprietà osservate"],
    [dashboard.metrics.activeProperties, "Attive ora"],
    [dashboard.metrics.hotOpportunities, "Priorità alta"],
    [dashboard.metrics.openReviews, "Revisioni aperte"],
    [dashboard.metrics.activePrivate, "Private attive"],
  ] as const;

  return (
    <>
      <LifecycleHeader
        eyebrow="Property Lifecycle V2 · briefing"
        title="Segnali, non inventario statico."
        description="Ogni variazione commerciale viene ricondotta alla proprietà fisica: nuove pubblicazioni, uscite, passaggi di agenzia, ritorni da privato e opportunità spiegabili."
        actions={
          <Link href="/lifecycle/opportunities" className={styles.primaryAction}>
            <Crosshair aria-hidden="true" className="size-4" />
            Apri le opportunità
          </Link>
        }
      />

      <section className={styles.briefingStrip} aria-label="Sintesi Lifecycle">
        {metrics.map(([value, label]) => (
          <div key={label} className={styles.metric}>
            <strong>{value.toLocaleString("it-IT")}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <div className={styles.split}>
        <LifecycleSection
          title="Linea dei segnali"
          description={`Aggiornata ${formatDateTime(dashboard.generatedAt)}`}
          action={<Radar aria-hidden="true" className="size-4 text-[var(--surface-accent)]" />}
        >
          {dashboard.recentEvents.length ? (
            <div className={styles.signalRail}>
              {dashboard.recentEvents.map((event, index) => (
                <article
                  key={event.id}
                  className={styles.signal}
                  style={{ "--i": index } as CSSProperties}
                >
                  <span className={styles.signalDot} aria-hidden="true" />
                  <div>
                    <div className={styles.signalTop}>
                      <p className={styles.signalTitle}>
                        {lifecycleEventLabel(event.eventType)}
                      </p>
                      <span className={styles.signalMeta}>
                        {formatDateTime(event.occurredAt)}
                      </span>
                    </div>
                    <PropertyLink property={event.property} />
                    <PropertyFacts property={event.property} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <LifecycleEmpty
              title="Nessun segnale ancora"
              description="Dopo il primo bootstrap approvato, qui compariranno solo cambiamenti con evidenza e provenienza."
            />
          )}
        </LifecycleSection>

        <LifecycleSection
          title="Coda acquisizione"
          description="Prima i segnali più forti"
          action={
            <Link href="/lifecycle/opportunities" className={styles.textAction}>
              Tutte
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          }
        >
          {dashboard.priorityOpportunities.length ? (
            <div className={styles.rows}>
              {dashboard.priorityOpportunities.slice(0, 6).map((opportunity) => (
                <article key={opportunity.id} className={styles.row}>
                  <div className={styles.rowTop}>
                    <SignalPill tone={opportunityTone(opportunity.level)}>
                      {opportunity.level}
                    </SignalPill>
                    <span className={styles.rowMeta}>
                      score {opportunity.score ?? 0}
                    </span>
                  </div>
                  <PropertyLink property={opportunity.property} />
                  <ul className={styles.reasonList}>
                    {opportunity.reasons.slice(0, 3).map((reason) => (
                      <li key={reason}>{opportunityReasonLabel(reason)}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          ) : (
            <LifecycleEmpty
              title="Nessuna priorità aperta"
              description="Le opportunità emergono solo da regole trasparenti e segnali lifecycle verificabili."
            />
          )}
        </LifecycleSection>
      </div>
    </>
  );
}
