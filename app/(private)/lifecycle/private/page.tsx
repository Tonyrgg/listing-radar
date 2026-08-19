import { EyeOff, RadioTower } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { humanize } from "@/lib/property-lifecycle/read-models/presentation";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";

import {
  ExternalSourceLink,
  formatCurrency,
  formatDate,
  LifecycleEmpty,
  LifecycleHeader,
  LifecycleSection,
  LifecycleUnavailable,
  PropertyLink,
  SignalPill,
} from "../_components/ui";
import styles from "../lifecycle.module.css";

export const metadata: Metadata = { title: "Private Radar · Lifecycle" };

export default async function LifecyclePrivateRadarPage() {
  await connection();
  const view = await loadLifecycleView((repository) => repository.privateRadar());
  if (!view.available || !view.data) return <LifecycleUnavailable message={view.message} />;
  const publications = view.data;
  const active = publications.filter((publication) => publication.state === "ACTIVE").length;
  const removed = publications.filter((publication) => publication.state === "REMOVED").length;
  const uncertain = publications.filter((publication) => publication.identityOutcome === "REVIEW_REQUIRED").length;

  return (
    <>
      <LifecycleHeader
        eyebrow="Private property radar"
        title="Ritorni sul mercato, senza schedare persone."
        description="Il bridge locale collega annunci privati alle proprietà fisiche con geografia rigida, dati personali rimossi e identità prudente."
        actions={<RadioTower aria-hidden="true" className="size-5 text-[var(--surface-accent)]" />}
      />

      <section className={styles.briefingStrip} aria-label="Sintesi annunci privati">
        <div className={styles.metric}><strong>{publications.length}</strong><span>osservazioni</span></div>
        <div className={styles.metric}><strong>{active}</strong><span>attive</span></div>
        <div className={styles.metric}><strong>{removed}</strong><span>rimosse</span></div>
        <div className={styles.metric}><strong>{uncertain}</strong><span>match da rivedere</span></div>
        <div className={styles.metric}><strong>{publications.filter((publication) => publication.property.agencies.length > 0).length}</strong><span>con storia agenzia</span></div>
      </section>

      <div className={styles.privacyNotice}>
        <EyeOff aria-hidden="true" className="size-5" />
        <div>
          <strong>Privacy by design</strong>
          <p>Nomi, telefoni ed email del venditore non entrano nel radar operativo. Il sistema conserva soltanto segnali immobiliari necessari alla ricostruzione del lifecycle.</p>
        </div>
      </div>

      <LifecycleSection title="Pubblicazioni private" description="Più recenti per prime">
        {publications.length ? (
          <div className={styles.rows}>
            {publications.map((publication) => (
              <article key={publication.id} className={styles.propertyRow}>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <SignalPill tone={publication.state === "ACTIVE" ? "good" : "default"}>{humanize(publication.state)}</SignalPill>
                    <SignalPill tone={publication.identityOutcome === "REVIEW_REQUIRED" ? "high" : "cool"}>
                      {humanize(publication.identityOutcome)} · {Math.round(publication.identityScore * 100)}%
                    </SignalPill>
                  </div>
                  <p className={`${styles.rowTitle} mt-3`}>{publication.title}</p>
                  <div className={`${styles.propertyFacts} mt-2`}>
                    <strong>{formatCurrency(publication.price)}</strong>
                    <span>{publication.surfaceSqm ? `${publication.surfaceSqm} m²` : "Metratura ignota"}</span>
                    <span>{publication.rooms ? `${publication.rooms} locali` : "Locali ignoti"}</span>
                    <span>{formatDate(publication.firstSeenAt)} → {publication.removedAt ? formatDate(publication.removedAt) : "oggi"}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <PropertyLink property={publication.property} />
                    <span className={styles.muted}>Fonte {publication.source}</span>
                  </div>
                </div>
                <ExternalSourceLink href={publication.canonicalUrl} />
              </article>
            ))}
          </div>
        ) : (
          <LifecycleEmpty title="Nessun annuncio privato importato" description="Il radar rimane vuoto finché una sincronizzazione locale valida non rileva dati nel territorio consentito." />
        )}
      </LifecycleSection>
    </>
  );
}
