import { ArrowRight, CheckCircle2, CircleAlert, DatabaseZap, MapPinned, UsersRound } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

import { RecalculateButton } from "@/components/matching/management-panels";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import styles from "@/components/matching/section-design.module.css";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import { getMatchingStats, listProperties, listRequests } from "@/lib/matching/repository";

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Panoramica commerciale" };

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
  /* Il consiglio parte da quello che blocca il confronto, non dal numero
   * più grande: una casa senza zona non entra in nessun abbinamento. */
  const recommendation = matching.total === 0 && canCalculate
    ? { title: "Non è ancora stato fatto nessun confronto", detail: `Ci sono ${formatNumber(activeRequests.length)} clienti in cerca e ${formatNumber(activeProperties.length)} case libere: il calcolo li mette a confronto.`, kind: "calculate" as const }
    : matching.compatible > 0
      ? { title: `${formatNumber(matching.compatible)} case vanno bene a qualcuno`, detail: "Sono quelle che rispettano tipologia, budget e zona di una richiesta aperta.", href: "/matching?solo=buone", kind: "link" as const }
      : requestGaps.zones > 0
        ? { title: `${formatNumber(requestGaps.zones)} clienti non hanno una zona`, detail: "Senza la zona il confronto sul territorio non regge, ed è il dato che manca più spesso.", href: "/requests", kind: "link" as const }
        : propertyGaps.zone > 0
          ? { title: `${formatNumber(propertyGaps.zone)} case non sono su nessuna zona`, detail: "Finché non hanno una zona non entrano in nessun abbinamento.", href: "/portfolio", kind: "link" as const }
          : { title: "Non manca niente", detail: "I dati sono completi e i confronti sono aggiornati.", href: "/matching", kind: "link" as const };

  return (
    <div className={styles.page}>
      <MatchingSectionHeader
        eyebrow="Commerciale"
        title="Quanto ci si può fidare degli abbinamenti"
        description="Un abbinamento vale quanto i dati che confronta. Qui si vede cosa manca, a quanti clienti e a quante case, e cosa conviene completare per primo."
      />

      <section className={styles.focusPanel} aria-labelledby="next-action-title">
        <span className={styles.focusIcon}><DatabaseZap aria-hidden="true" className="size-5" /></span>
        <div className={styles.focusCopy}>
          <p className={styles.sectionEyebrow}>Da dove conviene partire</p>
          <h2 className={styles.focusTitle} id="next-action-title">{recommendation.title}</h2>
          <p className={styles.panelDescription}>{recommendation.detail}</p>
        </div>
        <div className={styles.focusAction}>
          {recommendation.kind === "calculate" ? <RecalculateButton scope="all" /> : (
            <Link className={styles.primaryButton} href={recommendation.href}>Vai <ArrowRight aria-hidden="true" className="size-4" /></Link>
          )}
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="readiness-title">
        <header className={styles.panelHeader}>
          <div><p className={styles.sectionEyebrow}>Copertura dei dati</p><h2 className={styles.panelTitle} id="readiness-title">Su cosa si regge il confronto</h2></div>
          <span className={styles.count}>{formatNumber(activeRequests.length * activeProperties.length)} confronti possibili</span>
        </header>
        <div className={styles.readinessList}>
          <ReadinessRow icon={UsersRound} label="Clienti con la richiesta completa" value={readyRequests} total={activeRequests.length} detail={`${formatNumber(requestGaps.zones)} senza zona, ${formatNumber(requestGaps.budget)} senza budget`} href="/requests" />
          <ReadinessRow icon={MapPinned} label="Case pronte da proporre" value={readyProperties} total={activeProperties.length} detail={`${formatNumber(propertyGaps.zone)} senza zona, ${formatNumber(propertyGaps.size)} senza superficie`} href="/portfolio" />
          <ReadinessRow icon={CheckCircle2} label="Confronti già fatti" value={matching.total} total={activeRequests.length * activeProperties.length} detail={matching.lastCalculatedAt ? `L'ultimo calcolo è del ${formatDateTime(matching.lastCalculatedAt)}` : "Il calcolo non è mai stato eseguito"} href="/matching" />
        </div>
      </section>

      <section className={styles.attentionGrid} aria-label="Dati da completare">
        <AttentionBlock
          title="Cosa manca ai clienti"
          href="/requests"
          items={[
            [requestGaps.zones, "non dicono in che zona"],
            [requestGaps.client, "non hanno un nome collegato"],
            [requestGaps.budget, "non dicono quanto possono spendere"],
          ]}
        />
        <AttentionBlock
          title="Cosa manca alle case"
          href="/portfolio"
          items={[
            [propertyGaps.zone, "non sono su nessuna zona"],
            [propertyGaps.price, "non hanno un prezzo"],
            [propertyGaps.size, "non hanno i metri"],
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
        <div className={styles.readinessHeading}><strong>{label}</strong><span>{formatNumber(value)} su {formatNumber(total)}</span></div>
        <div className={styles.readinessTrack}><span style={{ width: `${percentage}%` }} /></div>
        <p>{detail}</p>
      </div>
      <Link className={styles.textAction} href={href}>Apri <ArrowRight aria-hidden="true" className="size-4" /></Link>
    </div>
  );
}

function AttentionBlock({ title, href, items }: Readonly<{ title: string; href: string; items: Array<[number, string]> }>) {
  const total = items.reduce((sum, [count]) => sum + count, 0);
  return (
    <section className={styles.attentionBlock}>
      <header><div><p className={styles.sectionEyebrow}>Da completare</p><h2 className={styles.panelTitle}>{title}</h2></div><CircleAlert aria-hidden="true" className={total ? "size-5 text-[var(--lr-warn)]" : "size-5 text-[var(--lr-accent)]"} /></header>
      {/* Le righe a zero non hanno niente da segnalare: spariscono. */}
      <ul>{items.filter(([count]) => count > 0).map(([count, label]) => <li key={label}><span>{label}</span><strong>{formatNumber(count)}</strong></li>)}
        {items.every(([count]) => count === 0) ? <li><span>Non manca niente</span><strong>&mdash;</strong></li> : null}</ul>
      <Link className={styles.textAction} href={href}>Apri l&apos;elenco <ArrowRight aria-hidden="true" className="size-4" /></Link>
    </section>
  );
}
