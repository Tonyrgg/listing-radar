import { ArrowRight, CheckCircle2, CircleAlert, DatabaseZap, MapPinned, UsersRound } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

import { RecalculateButton } from "@/components/matching/management-panels";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import { MatchingSectionNav } from "@/components/matching/section-nav";
import styles from "@/components/matching/section-design.module.css";
import { getMatchingStats, listProperties, listRequests } from "@/lib/matching/repository";

export default async function MatchingOverviewPage() {
  await connection();
  const [requests, properties, matching] = await Promise.all([listRequests(), listProperties(), getMatchingStats()]);
  const activeRequests = requests.filter((request) => ["active", "urgent"].includes(request.status));
  const activeProperties = properties.filter((property) => property.mandate_status === "active");
  const requestGaps = {
    client: activeRequests.filter((request) => !request.client_id).length,
    zones: activeRequests.filter((request) => !request.request_zones?.length).length,
    budget: activeRequests.filter((request) => request.contract_type === "sale" ? request.budget_max == null : request.monthly_rent_max == null).length,
  };
  const propertyGaps = {
    zone: activeProperties.filter((property) => !property.internal_zone_id).length,
    price: activeProperties.filter((property) => property.contract_type === "sale" ? property.price == null : property.monthly_rent == null).length,
    size: activeProperties.filter((property) => property.internal_sqm == null && property.commercial_sqm == null).length,
  };
  const readyRequests = activeRequests.filter((request) => request.client_id && request.request_zones?.length && (request.contract_type === "sale" ? request.budget_max != null : request.monthly_rent_max != null)).length;
  const readyProperties = activeProperties.filter((property) => property.internal_zone_id && (property.contract_type === "sale" ? property.price != null : property.monthly_rent != null) && (property.internal_sqm != null || property.commercial_sqm != null)).length;
  const canCalculate = activeRequests.length > 0 && activeProperties.length > 0;
  const recommendation = matching.total === 0 && canCalculate
    ? { title: "Calcola il primo matching reale", detail: `${activeRequests.length} richieste e ${activeProperties.length} immobili sono disponibili per il confronto.`, kind: "calculate" as const }
    : matching.compatible > 0
      ? { title: `Analizza ${matching.compatible} abbinamenti compatibili`, detail: "Parti dai punteggi più alti e apri il dettaglio per capire subito punti forti e distanze territoriali.", href: "/matching?classification=compatible", kind: "link" as const }
      : requestGaps.zones > 0
        ? { title: `Completa le zone di ${requestGaps.zones} richieste`, detail: "La zona pesa molto nel risultato e oggi è il dato mancante più frequente.", href: "/requests", kind: "link" as const }
        : propertyGaps.zone > 0
          ? { title: `Posiziona ${propertyGaps.zone} immobili`, detail: "Assegnare la zona immobiliare rende il confronto territoriale attendibile.", href: "/portfolio", kind: "link" as const }
          : { title: "Il sistema è allineato", detail: "Non risultano blocchi urgenti. Controlla i migliori abbinamenti disponibili.", href: "/matching", kind: "link" as const };

  return (
    <div className={styles.page}>
      <MatchingSectionHeader
        eyebrow="Richieste e portafoglio"
        title="Panoramica operativa"
        description="Priorità, qualità dei dati e prossimo passo del lavoro commerciale."
      />
      <MatchingSectionNav />

      <section className={styles.focusPanel} aria-labelledby="next-action-title">
        <span className={styles.focusIcon}><DatabaseZap aria-hidden="true" className="size-5" /></span>
        <div className={styles.focusCopy}>
          <p className={styles.sectionEyebrow}>Prossima azione consigliata</p>
          <h2 className={styles.focusTitle} id="next-action-title">{recommendation.title}</h2>
          <p className={styles.panelDescription}>{recommendation.detail}</p>
        </div>
        <div className={styles.focusAction}>
          {recommendation.kind === "calculate" ? <RecalculateButton scope="all" /> : (
            <Link className={styles.primaryButton} href={recommendation.href} target="_blank" rel="noreferrer">Apri attività <ArrowRight aria-hidden="true" className="size-4" /></Link>
          )}
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="readiness-title">
        <header className={styles.panelHeader}>
          <div><p className={styles.sectionEyebrow}>Copertura dati</p><h2 className={styles.panelTitle} id="readiness-title">Quanto è affidabile il confronto</h2></div>
          <span className={styles.count}>{activeRequests.length * activeProperties.length} coppie potenziali</span>
        </header>
        <div className={styles.readinessList}>
          <ReadinessRow icon={UsersRound} label="Richieste pronte" value={readyRequests} total={activeRequests.length} detail={`${requestGaps.zones} senza zone, ${requestGaps.budget} senza budget`} href="/requests" />
          <ReadinessRow icon={MapPinned} label="Immobili pronti" value={readyProperties} total={activeProperties.length} detail={`${propertyGaps.zone} senza zona, ${propertyGaps.size} senza superficie`} href="/portfolio" />
          <ReadinessRow icon={CheckCircle2} label="Abbinamenti calcolati" value={matching.total} total={activeRequests.length * activeProperties.length} detail={matching.lastCalculatedAt ? `Ultimo calcolo ${new Date(matching.lastCalculatedAt).toLocaleString("it-IT")}` : "Calcolo non ancora eseguito"} href="/matching" />
        </div>
      </section>

      <section className={styles.attentionGrid} aria-label="Dati da completare">
        <AttentionBlock
          title="Richieste clienti"
          href="/requests"
          items={[
            [requestGaps.zones, "senza zone desiderate"],
            [requestGaps.client, "senza cliente collegato"],
            [requestGaps.budget, "senza limite di spesa"],
          ]}
        />
        <AttentionBlock
          title="Immobili disponibili"
          href="/portfolio"
          items={[
            [propertyGaps.zone, "senza zona immobiliare"],
            [propertyGaps.price, "senza prezzo o canone"],
            [propertyGaps.size, "senza superficie"],
          ]}
        />
      </section>
    </div>
  );
}

function ReadinessRow({ icon: Icon, label, value, total, detail, href }: Readonly<{ icon: typeof UsersRound; label: string; value: number; total: number; detail: string; href: string }>) {
  const percentage = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className={styles.readinessRow}>
      <span className={styles.readinessIcon}><Icon aria-hidden="true" className="size-4" /></span>
      <div className={styles.readinessMain}>
        <div className={styles.readinessHeading}><strong>{label}</strong><span>{value}/{total} · {percentage}%</span></div>
        <div className={styles.readinessTrack}><span style={{ width: `${percentage}%` }} /></div>
        <p>{detail}</p>
      </div>
      <Link className={styles.textAction} href={href} target="_blank" rel="noreferrer">Apri <ArrowRight aria-hidden="true" className="size-4" /></Link>
    </div>
  );
}

function AttentionBlock({ title, href, items }: Readonly<{ title: string; href: string; items: Array<[number, string]> }>) {
  const total = items.reduce((sum, [count]) => sum + count, 0);
  return (
    <section className={styles.attentionBlock}>
      <header><div><p className={styles.sectionEyebrow}>Da completare</p><h2 className={styles.panelTitle}>{title}</h2></div><CircleAlert aria-hidden="true" className={total ? "size-5 text-[var(--status-warning)]" : "size-5 text-[var(--surface-accent)]"} /></header>
      <ul>{items.map(([count, label]) => <li key={label}><span>{label}</span><strong>{count}</strong></li>)}</ul>
      <Link className={styles.textAction} href={href} target="_blank" rel="noreferrer">Vai all&apos;archivio <ArrowRight aria-hidden="true" className="size-4" /></Link>
    </section>
  );
}
