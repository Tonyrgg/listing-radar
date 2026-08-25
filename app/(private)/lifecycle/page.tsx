import { ArrowRight, Crosshair, Radar, RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { CSSProperties } from "react";

import {
  lifecycleEventLabel,
  opportunityLevelLabel,
  opportunityReasonLabel,
} from "@/lib/property-lifecycle/read-models/presentation";
import { PendingSubmitButton } from "@/components/loading-controls";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";

import { enqueueGlobalLifecycleRefresh } from "./actions";

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

export const metadata: Metadata = { title: "Segnali" };

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
        eyebrow="Segnali"
        title="Cosa è cambiato sul mercato"
        description="Ogni movimento del mercato ricondotto all'immobile vero: nuove pubblicazioni, uscite, passaggi di agenzia e ritorni da privato, ognuno con la sua spiegazione."
        actions={
          <>
            {/* Rileggere tutte le fonti è un'azione di questa sezione, non una
              * voce di menu: stava in una barra a parte, scritta «Refresh All». */}
            <form action={enqueueGlobalLifecycleRefresh}>
              <PendingSubmitButton
                type="submit"
                pendingLabel="Metto in coda"
                icon={<RefreshCw aria-hidden="true" className="size-4" />}
                className={styles.secondaryAction}
              >
                Rileggi tutte le fonti
              </PendingSubmitButton>
            </form>
            <Link href="/lifecycle/opportunities" className={styles.primaryAction}>
              <Crosshair aria-hidden="true" className="size-4" />
              Apri le opportunità
            </Link>
          </>
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
          action={<Radar aria-hidden="true" className="size-4 text-[var(--lr-accent)]" />}
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
                      {opportunityLevelLabel(opportunity.level)}
                    </SignalPill>
                    {/* Il punteggio serve all'ordinamento, non a chi legge:
                      * «score 50» non dice se 50 è tanto. Contano gli indizi. */}
                    <span className={styles.rowMeta}>
                      {opportunity.reasons.length}{" "}
                      {opportunity.reasons.length === 1 ? "indizio" : "indizi"}
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
