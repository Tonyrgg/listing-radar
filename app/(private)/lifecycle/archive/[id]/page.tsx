import { ArrowLeft, CheckCircle2, MapPin, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { PendingSubmitButton } from "@/components/loading-controls";
import { getCurrentUser } from "@/lib/auth";
import {
  agencyListingStateLabel,
  confidenceLabel,
  humanize,
  lifecycleEventLabel,
  opportunityReasonLabel,
  propertyStateLabel,
  claimKeyLabel,
  locationPrecisionLabel,
} from "@/lib/property-lifecycle/read-models/presentation";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";

import {
  flagPropertyForLifecycleReview,
  recordAgencyOutcomeOverride,
  recordPropertySaleOverride,
} from "../../actions";
import {
  ageDays,
  ExternalSourceLink,
  formatCurrency,
  formatDate,
  LifecycleEmpty,
  LifecycleHeader,
  LifecycleSection,
  LifecycleUnavailable,
  SignalPill,
} from "../../_components/ui";
import styles from "../../lifecycle.module.css";

export const metadata: Metadata = { title: "Dossier proprietà" };

function payloadSummary(payload: Record<string, unknown>): string | null {
  const oldPrice = typeof payload.oldPrice === "number" ? payload.oldPrice : null;
  const newPrice = typeof payload.newPrice === "number" ? payload.newPrice : null;
  if (oldPrice != null && newPrice != null) {
    return `${formatCurrency(oldPrice)} → ${formatCurrency(newPrice)}`;
  }
  const outcome = typeof payload.outcome === "string" ? payload.outcome : null;
  if (outcome) return humanize(outcome);
  const prior = typeof payload.priorAgencyState === "string" ? payload.priorAgencyState : null;
  if (prior) return `Stato precedente: ${agencyListingStateLabel(prior)}`;
  return null;
}

export default async function LifecyclePropertyPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  await connection();
  const { id } = await params;
  const [view, user] = await Promise.all([
    loadLifecycleView((repository) => repository.property(id)),
    getCurrentUser(),
  ]);
  if (!view.available) return <LifecycleUnavailable message={view.message} />;
  if (!view.data) notFound();
  const detail = view.data;
  const property = detail.property;
  const marketAge = ageDays(property.trueMarketStartUpperBound);
  const activeAgency = property.agencies.find((agency) => agency.state === "ACTIVE");
  const agencyTenure = ageDays(activeAgency?.firstSeenAt ?? null);

  return (
    <>
      <Link href="/lifecycle/archive" className={styles.textAction}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        Torna all&apos;archivio
      </Link>
      <LifecycleHeader
        eyebrow="Dossier proprietà"
        title={property.title}
        description={`${[property.address, property.locality].filter(Boolean).join(" · ") || "Posizione da verificare"} · ${propertyStateLabel(property.propertyState)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <SignalPill tone={property.propertyState.includes("ACTIVE") ? "good" : "high"}>
              {propertyStateLabel(property.propertyState)}
            </SignalPill>
            <SignalPill>{property.saleStatus}</SignalPill>
          </div>
        }
      />

      <div className={styles.mediaStrip}>
        {detail.imageUrls.length ? (
          detail.imageUrls.map((url, index) => (
            <div
              key={url}
              role="img"
              aria-label={`Immagine rappresentativa ${index + 1} di ${property.title}`}
              className={styles.mediaEmpty}
              style={{ backgroundImage: `url("${url}")`, backgroundSize: "cover", backgroundPosition: "center" }}
            />
          ))
        ) : (
          <div className={styles.mediaEmpty}>Nessuna immagine rappresentativa archiviata</div>
        )}
      </div>

      <section className={styles.facts} aria-label="Fatti correnti">
        <div className={styles.fact}><strong>{formatCurrency(property.currentPrice)}</strong><span>prezzo corrente</span></div>
        <div className={styles.fact}><strong>{property.surfaceSqm ? `${property.surfaceSqm} m²` : "—"}</strong><span>superficie</span></div>
        <div className={styles.fact}><strong>{property.rooms ?? "—"}</strong><span>locali</span></div>
        <div className={styles.fact}><strong>{marketAge ?? "—"}</strong><span>giorni reali di mercato</span></div>
        <div className={styles.fact}><strong>{agencyTenure ?? "—"}</strong><span>giorni agenzia corrente</span></div>
        <div className={styles.fact}><strong>{property.relaunchCount}</strong><span>rilanci osservati</span></div>
        <div className={styles.fact}><strong>{property.agencies.length}</strong><span>agenzie storiche</span></div>
        <div className={styles.fact}><strong>{property.activePrivateCount}</strong><span>private attive</span></div>
      </section>

      <div className={styles.detailGrid}>
        <LifecycleSection title="Timeline completa" description="Eventi immutabili in ordine inverso">
          {detail.events.length ? (
            <div className={styles.timeline}>
              {detail.events.map((event) => (
                <article key={event.id} className={styles.timelineItem}>
                  <time className={styles.timelineDate} dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
                  <div className={styles.timelineContent}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3>{lifecycleEventLabel(event.eventType)}</h3>
                      <SignalPill tone={event.actorType === "USER" ? "cool" : "default"}>{event.actorType}</SignalPill>
                    </div>
                    <p>
                      Confidenza {confidenceLabel(event.confidence)} ({Math.round(event.confidence * 100)}%)
                      {payloadSummary(event.payload) ? ` · ${payloadSummary(event.payload)}` : ""}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <LifecycleEmpty title="Timeline vuota" description="Nessun evento lifecycle è stato ancora registrato." />
          )}
        </LifecycleSection>

        <div className="grid gap-4">
          <LifecycleSection title="Posizione" description="Precisione sempre esplicita">
            {detail.location ? (
              <div className="py-4">
                <div className="flex items-center gap-2">
                  <MapPin aria-hidden="true" className="size-4 text-[var(--lr-accent)]" />
                  <p className={styles.rowTitle}>{detail.location.rawText ?? property.address ?? "Posizione parziale"}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <SignalPill tone={detail.location.manuallyVerified ? "good" : "default"}>{locationPrecisionLabel(detail.location.precision)}</SignalPill>
                  {detail.location.manuallyVerified ? <SignalPill tone="good">Verificata</SignalPill> : null}
                </div>
                {detail.building ? <p className={`${styles.muted} mt-3`}>Edificio: {detail.building.displayName ?? detail.building.id}</p> : null}
              </div>
            ) : (
              <LifecycleEmpty title="Posizione assente" description="Nessuna localizzazione affidabile è stata associata." />
            )}
          </LifecycleSection>

          <LifecycleSection title="Opportunità" description="Regole trasparenti">
            {detail.opportunity ? (
              <div className="py-4">
                <SignalPill tone={detail.opportunity.level === "HOT" ? "hot" : detail.opportunity.level === "HIGH" ? "high" : "cool"}>
                  {detail.opportunity.level}
                </SignalPill>
                <ul className={`${styles.reasonList} mt-4`}>
                  {detail.opportunity.reasons.map((reason) => <li key={reason}>{opportunityReasonLabel(reason)}</li>)}
                </ul>
              </div>
            ) : (
              <LifecycleEmpty title="Nessun segnale commerciale" description="Il dossier non genera una priorità aperta." />
            )}
          </LifecycleSection>
        </div>
      </div>

      <div className={styles.split}>
        <LifecycleSection title="Storia agenzie e pubblicazioni" description="Mandati osservabili e URL sorgente">
          <div className={styles.rows}>
            {property.agencies.map((agency) => (
              <article key={agency.listingId} className={styles.row}>
                <div className={styles.rowTop}>
                  <Link href={`/lifecycle/agencies/${agency.slug}`} className={styles.rowTitle}>{agency.name}</Link>
                  <SignalPill tone={agency.state === "ACTIVE" ? "good" : "high"}>{agencyListingStateLabel(agency.state)}</SignalPill>
                </div>
                <p className={styles.muted}>{formatDate(agency.firstSeenAt)} → {formatDate(agency.lastSeenAt)}{agency.reference ? ` · Rif. ${agency.reference}` : ""}</p>
              </article>
            ))}
            {detail.publications.map((publication) => (
              <article key={publication.id} className={styles.row}>
                <div className={styles.rowTop}>
                  <p className={styles.rowTitle}>{publication.agencyName} · {publication.sourceKey}</p>
                  <SignalPill>{publication.state}</SignalPill>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className={styles.muted}>{formatDate(publication.firstSeenAt)} → {formatDate(publication.lastSeenAt)}</p>
                  <ExternalSourceLink href={publication.canonicalUrl} />
                </div>
              </article>
            ))}
            {detail.privatePublications.map((publication) => (
              <article key={publication.id} className={styles.row}>
                <div className={styles.rowTop}>
                  <p className={styles.rowTitle}>Private Radar · {publication.source}</p>
                  <SignalPill tone={publication.state === "ACTIVE" ? "good" : "default"}>{publication.state}</SignalPill>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className={styles.muted}>Match {Math.round(publication.identityScore * 100)}% · {publication.identityOutcome}</p>
                  <ExternalSourceLink href={publication.canonicalUrl} />
                </div>
              </article>
            ))}
          </div>
        </LifecycleSection>

        <LifecycleSection title="Prove e prezzo" description="Provenienza prima della certezza">
          {detail.priceHistory.length ? (
            <div className="border-b border-[var(--lr-line-quiet)] py-4">
              {detail.priceHistory.map((price) => (
                <div key={`${price.eventType}:${price.occurredAt}`} className="flex items-center justify-between gap-4 py-1 text-xs">
                  <span className="text-[var(--lr-ink-2)]">{formatDate(price.occurredAt)}</span>
                  <strong className="text-[var(--lr-ink)]">{formatCurrency(price.oldPrice)} → {formatCurrency(price.newPrice)}</strong>
                </div>
              ))}
            </div>
          ) : null}
          {detail.evidence.length ? (
            <div className={styles.rows}>
              {detail.evidence.slice(0, 12).map((evidence) => (
                <article key={evidence.id} className={styles.row}>
                  <div className={styles.rowTop}>
                    <p className={styles.rowTitle}>{claimKeyLabel(evidence.claimKey)}</p>
                    <span className={styles.rowMeta}>{Math.round(evidence.confidence * 100)}%</span>
                  </div>
                  <p className={styles.muted}>{evidence.extractionMethod} · {formatDate(evidence.sourceRecordedAt ?? evidence.observedAt)}</p>
                </article>
              ))}
            </div>
          ) : (
            <LifecycleEmpty title="Nessuna prova allegata" description="Le future osservazioni mostreranno metodo e confidenza." />
          )}
        </LifecycleSection>
      </div>

      <LifecycleSection title="Correzioni manuali" description="Ogni decisione richiede motivo, autore e timestamp">
        {user ? (
          <div className="grid gap-4 py-4 lg:grid-cols-3">
            <form action={recordPropertySaleOverride} className={styles.manualForm}>
              <input type="hidden" name="propertyId" value={property.id} />
              <label className={styles.manualLabel}>Stato vendita
                <select name="saleStatus" defaultValue={property.saleStatus} className={styles.select}>
                  <option value="UNKNOWN">Da verificare</option>
                  <option value="SOLD_CONFIRMED">Venduto confermato</option>
                  <option value="NOT_SOLD_CONFIRMED">Non venduto confermato</option>
                </select>
              </label>
              <label className={styles.manualLabel}>Motivo
                <input name="reason" required minLength={5} placeholder="Es. conferma telefonica proprietario" className={styles.input} />
              </label>
              <PendingSubmitButton type="submit" pendingLabel="Registro" icon={<ShieldCheck aria-hidden="true" className="size-4" />} className={styles.primaryAction}>Registra stato vendita</PendingSubmitButton>
            </form>

            {property.agencies[0] ? (
              <form action={recordAgencyOutcomeOverride} className={styles.manualForm}>
                <input type="hidden" name="propertyId" value={property.id} />
                <input type="hidden" name="agencyListingId" value={property.agencies[0].listingId} />
                <label className={styles.manualLabel}>Esito {property.agencies[0].name}
                  <select name="agencyState" defaultValue="CLOSED_WITHDRAWN" className={styles.select}>
                    <option value="CLOSED_WITHDRAWN">Ritirato</option>
                    <option value="CLOSED_SWITCHED">Cambio agenzia</option>
                    <option value="CLOSED_TO_PRIVATE">Passato a privato</option>
                    <option value="OFF_MARKET_NO_SALE_EVIDENCE">Fuori mercato, non venduto</option>
                  </select>
                </label>
                <label className={styles.manualLabel}>Motivo
                  <input name="reason" required minLength={5} placeholder="Fonte della conferma" className={styles.input} />
                </label>
                <PendingSubmitButton type="submit" pendingLabel="Registro" icon={<CheckCircle2 aria-hidden="true" className="size-4" />} className={styles.secondaryAction}>Registra esito agenzia</PendingSubmitButton>
              </form>
            ) : <div />}

            <form action={flagPropertyForLifecycleReview} className={styles.manualForm}>
              <input type="hidden" name="propertyId" value={property.id} />
              <label className={styles.manualLabel}>Richiedi verifica
                <input name="reason" required minLength={5} placeholder="Cosa deve controllare il revisore" className={styles.input} />
              </label>
              <PendingSubmitButton type="submit" pendingLabel="Apro la verifica" className={styles.secondaryAction}>Needs Verification</PendingSubmitButton>
            </form>
          </div>
        ) : (
          <LifecycleEmpty title="Accesso richiesto per correggere" description="I controlli restano in sola lettura finché non è presente un utente autenticato e auditabile." />
        )}
      </LifecycleSection>
    </>
  );
}
