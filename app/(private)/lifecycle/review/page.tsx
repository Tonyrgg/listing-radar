import { GitCompareArrows, Scale, ShieldQuestion } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { PendingSubmitButton } from "@/components/loading-controls";
import { getCurrentUser } from "@/lib/auth";
import { humanize } from "@/lib/property-lifecycle/read-models/presentation";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";

import { recordReviewDecision } from "../actions";
import {
  formatDate,
  LifecycleEmpty,
  LifecycleHeader,
  LifecycleSection,
  LifecycleUnavailable,
  PropertyFacts,
  PropertyLink,
  SignalPill,
} from "../_components/ui";
import styles from "../lifecycle.module.css";

export const metadata: Metadata = { title: "Review queue · Lifecycle" };

function detailSummary(details: Record<string, unknown>): string[] {
  const reasons = Array.isArray(details.reasons)
    ? details.reasons.filter((value): value is string => typeof value === "string")
    : [];
  const score = typeof details.score === "number" ? `Score ${Math.round(details.score * 100)}%` : null;
  const margin = typeof details.margin === "number" ? `Margine ${Math.round(details.margin * 100)}%` : null;
  const source = typeof details.source === "string" ? `Fonte ${details.source}` : null;
  return [score, margin, source, ...reasons.map(humanize)].filter(
    (value): value is string => Boolean(value),
  );
}

export default async function LifecycleReviewPage() {
  await connection();
  const [view, user] = await Promise.all([
    loadLifecycleView((repository) => repository.reviews()),
    getCurrentUser(),
  ]);
  if (!view.available || !view.data) return <LifecycleUnavailable message={view.message} />;
  const reviews = view.data;
  const identityCount = reviews.filter((review) => review.reviewType === "IDENTITY").length;
  const geographyCount = reviews.filter((review) => review.reviewType === "GEOGRAPHY").length;

  return (
    <>
      <LifecycleHeader
        eyebrow="Human review queue"
        title="L'ambiguità resta visibile."
        description="Confronta i dossier candidati e registra una decisione auditabile. La revisione non fonde né elimina automaticamente alcuna proprietà."
        actions={<SignalPill tone={reviews.length ? "high" : "good"}>{reviews.length} aperte</SignalPill>}
      />

      <section className={styles.briefingStrip} aria-label="Sintesi revisioni">
        <div className={styles.metric}><strong>{reviews.length}</strong><span>casi aperti</span></div>
        <div className={styles.metric}><strong>{identityCount}</strong><span>identità</span></div>
        <div className={styles.metric}><strong>{geographyCount}</strong><span>geografia</span></div>
        <div className={styles.metric}><strong>{reviews.filter((review) => review.reviewType === "LIFECYCLE").length}</strong><span>lifecycle</span></div>
        <div className={styles.metric}><strong>{reviews.filter((review) => review.status === "IN_REVIEW").length}</strong><span>in revisione</span></div>
      </section>

      <LifecycleSection
        title="Casi da decidere"
        description="Priorità più alta per prima"
        action={<Scale aria-hidden="true" className="size-4 text-[var(--surface-accent)]" />}
      >
        {reviews.length ? (
          <div className={styles.rows}>
            {reviews.map((review) => {
              const summaries = detailSummary(review.details);
              return (
                <article key={review.id} className={styles.reviewCase}>
                  <div className={styles.rowTop}>
                    <div className="flex flex-wrap items-center gap-2">
                      <SignalPill tone={review.priority >= 100 ? "hot" : "high"}>{humanize(review.reviewType)}</SignalPill>
                      <SignalPill>{humanize(review.status)}</SignalPill>
                    </div>
                    <span className={styles.rowMeta}>Priorità {review.priority} · {formatDate(review.createdAt)}</span>
                  </div>
                  <div>
                    <h2 className={styles.reviewTitle}>{review.title}</h2>
                    {review.agencyName ? <p className={styles.muted}>Agenzia: {review.agencyName}</p> : null}
                    {summaries.length ? <p className={`${styles.muted} mt-2`}>{summaries.join(" · ")}</p> : null}
                  </div>

                  {review.property || review.candidates.length ? (
                    <div className={styles.comparisonGrid}>
                      {review.property ? (
                        <div className={styles.comparisonCard}>
                          <span className={styles.comparisonLabel}>Dossier in esame</span>
                          <PropertyLink property={review.property} />
                          <PropertyFacts property={review.property} />
                        </div>
                      ) : null}
                      {review.candidates.map((candidate, index) => (
                        <div key={candidate.property.id} className={styles.comparisonCard}>
                          <span className={styles.comparisonLabel}>Candidato {index + 1}{candidate.score == null ? "" : ` · ${Math.round(candidate.score * 100)}%`}</span>
                          <PropertyLink property={candidate.property} />
                          <PropertyFacts property={candidate.property} />
                          {candidate.contradictions.length ? (
                            <p className={`${styles.muted} mt-2`}>Contraddizioni: {candidate.contradictions.map(humanize).join(", ")}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {user ? (
                    <form action={recordReviewDecision} className={styles.reviewActions}>
                      <input type="hidden" name="reviewId" value={review.id} />
                      <label className={styles.manualLabel}>
                        Motivo della decisione
                        <input name="reason" required minLength={5} placeholder="Evidenza osservata o controllo eseguito" className={styles.input} />
                      </label>
                      <div className={styles.decisionGrid}>
                        <PendingSubmitButton type="submit" name="decision" value="SAME" pendingLabel="Registro" icon={<GitCompareArrows aria-hidden="true" className="size-4" />} className={styles.primaryAction}>Stesso immobile</PendingSubmitButton>
                        <PendingSubmitButton type="submit" name="decision" value="DIFFERENT" pendingLabel="Registro" className={styles.secondaryAction}>Diversi</PendingSubmitButton>
                        <PendingSubmitButton type="submit" name="decision" value="NOT_SURE" pendingLabel="Registro" icon={<ShieldQuestion aria-hidden="true" className="size-4" />} className={styles.secondaryAction}>Non sicuro</PendingSubmitButton>
                      </div>
                    </form>
                  ) : (
                    <p className={styles.readOnlyNote}>Sola lettura: serve un utente autenticato per registrare una decisione auditabile.</p>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <LifecycleEmpty title="Coda pulita" description="Nessuna ambiguità richiede una decisione umana in questo momento." />
        )}
      </LifecycleSection>
    </>
  );
}
