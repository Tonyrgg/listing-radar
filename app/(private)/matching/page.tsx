import { AlertTriangle, ArrowRight, Banknote, Building2, CheckCircle2, ChevronDown, Clock3, MapPin, Ruler, SlidersHorizontal, UserRound } from "lucide-react";
import Link from "next/link";

import { MatchStatusSelect, RecalculateButton } from "@/components/matching/management-panels";
import { QuickRequestButton } from "@/components/matching/quick-request";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import { MatchingSectionNav } from "@/components/matching/section-nav";
import styles from "@/components/matching/section-design.module.css";
import { cleanRequestTitle } from "@/lib/matching/request-presentation";
import { getMatchingConfig, getMatchingStats, listMatches, listProperties, listRequests } from "@/lib/matching/repository";
import type { RequestPropertyMatch } from "@/lib/matching/types";

export default async function MatchingPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const query = await searchParams;
  const view = value(query.view) === "property" ? "property" : "request";
  const classification = allowed(value(query.classification), ["compatible", "almost_compatible", "weak", "not_relevant"]);
  const status = allowed(value(query.status), ["not_reviewed", "new", "to_propose", "proposed", "interested", "visit_scheduled", "not_interested", "excluded", "negotiation", "completed"]);
  const contract = allowed(value(query.contract), ["sale", "rent"]);
  const minimum = Math.max(0, Math.min(100, Number(value(query.minimum)) || 0));
  const [requests, properties, stats, config] = await Promise.all([listRequests(), listProperties(), getMatchingStats(), getMatchingConfig()]);
  const activeRequests = requests.filter((request) => ["active", "urgent"].includes(request.status));
  const activeProperties = properties.filter((property) => property.mandate_status === "active");
  const requestIds = contract ? activeRequests.filter((request) => request.contract_type === contract).map((request) => request.id) : activeRequests.map((request) => request.id);
  const matches = await listMatches({ limit: 600, classification, status, minimum, requestIds });
  const requestsById = new Map(activeRequests.map((item) => [item.id, item]));
  const propertiesById = new Map(activeProperties.map((item) => [item.id, item]));
  const visibleMatches = matches.filter((match) => requestsById.has(match.request_id) && propertiesById.has(match.property_id));
  const groups = groupMatches(visibleMatches, view).slice(0, 18);
  const canCalculate = activeRequests.length > 0 && activeProperties.length > 0;

  return (
    <div className={styles.page}>
      <MatchingSectionHeader
        eyebrow="Motore commerciale"
        title="Matching"
        description="Confronta richieste e incarichi, verifica le percentuali e porta avanti le proposte migliori."
        actions={<div className={styles.actions}><QuickRequestButton />{canCalculate ? <RecalculateButton scope="all" /> : null}</div>}
      />
      <MatchingSectionNav />

      <section className={styles.matchingStatus} aria-label="Stato del motore di matching">
        <div>
          <p className={styles.sectionEyebrow}>Stato calcolo</p>
          <strong>{stats.total ? `${stats.total.toLocaleString("it-IT")} confronti disponibili` : "Nessun confronto calcolato"}</strong>
          <span><Clock3 aria-hidden="true" className="size-3.5" /> {stats.lastCalculatedAt ? `Aggiornato ${new Date(stats.lastCalculatedAt).toLocaleString("it-IT")}` : "Avvia il primo calcolo"}</span>
        </div>
        <div className={styles.matchingStatusFacts}>
          <span><strong>{activeRequests.length}</strong> richieste attive</span>
          <span><strong>{activeProperties.length}</strong> immobili disponibili</span>
          <span><strong>{stats.toPropose}</strong> da proporre</span>
          <span><strong>{stats.inProgress}</strong> in lavorazione</span>
        </div>
      </section>

      <div className={styles.matchingTopGrid}>
        <section className={styles.panel} aria-labelledby="distribution-title">
          <header className={styles.panelHeader}><div><p className={styles.sectionEyebrow}>Distribuzione</p><h2 className={styles.panelTitle} id="distribution-title">Qualità degli abbinamenti</h2></div><span className={styles.count}>{stats.total.toLocaleString("it-IT")} totali</span></header>
          <div className={styles.distributionList}>
            <DistributionRow label="Compatibili" count={stats.compatible} total={stats.total} href="/matching?classification=compatible" tone="strong" />
            <DistributionRow label="Buone alternative" count={stats.almostCompatible} total={stats.total} href="/matching?classification=almost_compatible" tone="medium" />
            <DistributionRow label="Da valutare" count={stats.weak} total={stats.total} href="/matching?classification=weak" tone="warning" />
            <DistributionRow label="Poco pertinenti" count={stats.notRelevant} total={stats.total} href="/matching?classification=not_relevant" tone="muted" />
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="logic-title">
          <header className={styles.panelHeader}><div><p className={styles.sectionEyebrow}>Logica attiva</p><h2 className={styles.panelTitle} id="logic-title">Come nasce la percentuale</h2></div><Link className={styles.textAction} href="/matching-settings">Modifica regole <ArrowRight aria-hidden="true" className="size-4" /></Link></header>
          <div className={styles.logicBody}>
            <div className={styles.thresholdLine}><span>Compatibile da <strong>{config.thresholds.compatible}%</strong></span><span>Alternativa da <strong>{config.thresholds.almostCompatible}%</strong></span><span>Valutabile da <strong>{config.thresholds.weak}%</strong></span></div>
            <div className={styles.weightList}>
              {Object.entries(config.weights).sort((a, b) => b[1] - a[1]).map(([key, weight]) => (
                <div key={key}><span>{weightLabel(key)}</span><div><i style={{ width: `${Math.min(100, weight * 4)}%` }} /></div><strong>{weight}</strong></div>
              ))}
            </div>
            <p className={styles.logicNote}><SlidersHorizontal aria-hidden="true" className="size-4" /> Ogni conflitto obbligatorio sottrae 12 punti. I dati assenti ricevono un valore prudenziale, mai un pieno punteggio.</p>
          </div>
        </section>
      </div>

      <div className={styles.operations}>
        <div><p className={styles.sectionEyebrow}>Coda commerciale</p><p className={styles.panelDescription}>{visibleMatches.length} risultati caricati, raggruppati {view === "request" ? "per richiesta" : "per immobile"}.</p></div>
        <div className={styles.segments}>
          <Link className={`${styles.segment} ${view === "request" ? styles.segmentActive : ""}`} href={withQuery(query, { view: "request" })}>Per cliente</Link>
          <Link className={`${styles.segment} ${view === "property" ? styles.segmentActive : ""}`} href={withQuery(query, { view: "property" })}>Per immobile</Link>
        </div>
      </div>

      <section className={styles.panel}>
        <details className={styles.filterDetails} open={Boolean(classification || contract || minimum || status)}>
          <summary className={styles.filterSummary}>Filtri risultati <ChevronDown aria-hidden="true" className="size-4" /></summary>
          <form className={styles.filterForm}>
            <input type="hidden" name="view" value={view} />
            <select className={styles.select} name="classification" defaultValue={classification} aria-label="Classificazione"><option value="">Tutte le classificazioni</option><option value="compatible">Compatibili</option><option value="almost_compatible">Buone alternative</option><option value="weak">Da valutare</option><option value="not_relevant">Poco pertinenti</option></select>
            <select className={styles.select} name="status" defaultValue={status} aria-label="Stato commerciale"><option value="">Tutti gli stati</option><option value="to_propose">Da proporre</option><option value="proposed">Proposto</option><option value="interested">Interessato</option><option value="visit_scheduled">Visita fissata</option><option value="negotiation">In trattativa</option><option value="completed">Concluso</option><option value="excluded">Escluso</option></select>
            <select className={styles.select} name="contract" defaultValue={contract} aria-label="Contratto"><option value="">Vendita e locazione</option><option value="sale">Vendita</option><option value="rent">Locazione</option></select>
            <input className={styles.input} name="minimum" type="number" min="0" max="100" defaultValue={minimum || ""} placeholder="Affinità minima" aria-label="Affinità minima" />
            <button className={styles.secondaryButton}>Applica filtri</button>
          </form>
        </details>

        <div className={styles.matchGroups}>
          {groups.map(([groupId, group]) => {
            const request = requestsById.get(group[0]!.request_id);
            const property = propertiesById.get(group[0]!.property_id);
            const title = view === "request" ? cleanRequestTitle(request?.title ?? "Richiesta") : property?.title ?? "Immobile";
            const subtitle = view === "request" ? request?.clients?.full_name || "Cliente da collegare" : property?.zone?.name || property?.municipality || "Zona non indicata";
            return (
              <section className={styles.matchGroup} key={groupId}>
                <header className={styles.matchGroupHeader}><div><p className={styles.pairLabel}>{view === "request" ? "Richiesta cliente" : "Immobile"}</p><h2>{title}</h2><p>{subtitle}</p></div><div><strong>{Math.round(group[0]!.score)}%</strong><span>migliore · {group.length} risultati</span></div></header>
                <div className={styles.matchList}>{group.slice(0, 4).map((match, index) => <MatchRecord key={match.id} match={match} request={requestsById.get(match.request_id)} property={propertiesById.get(match.property_id)} view={view} leading={index === 0} />)}</div>
              </section>
            );
          })}
          {!groups.length ? <div className={styles.emptyState}><div><CheckCircle2 aria-hidden="true" className="mx-auto size-6 text-[var(--surface-accent)]" /><h2 className="mt-4 font-semibold text-[var(--ink-strong)]">Nessun abbinamento da mostrare</h2><p className="mt-2 text-sm">{canCalculate ? "Avvia il calcolo oppure modifica i filtri applicati." : "Servono almeno una richiesta attiva e un immobile disponibile."}</p></div></div> : null}
        </div>
      </section>
    </div>
  );
}

function MatchRecord({ match, request, property, view, leading }: Readonly<{ match: RequestPropertyMatch; request: Awaited<ReturnType<typeof listRequests>>[number] | undefined; property: Awaited<ReturnType<typeof listProperties>>[number] | undefined; view: "request" | "property"; leading: boolean }>) {
  const showProperty = view === "request";
  const counterpartTitle = showProperty ? property?.title || "Immobile" : request?.clients?.full_name || "Cliente da collegare";
  const counterpartSubtitle = showProperty
    ? property?.zone?.name || property?.municipality || "Zona non indicata"
    : cleanRequestTitle(request?.title ?? "Richiesta");
  return (
    <article className={`${styles.matchRecord} ${leading ? styles.matchRecordLeading : ""}`}>
      <div className={styles.matchDecision}>
        <div className={styles.matchScoreBlock}>
          <strong>{Math.round(match.score)}%</strong>
          <span>{classificationLabel(match.classification)}</span>
        </div>
        <div className={styles.matchCounterpart}>
          <p className={styles.pairLabel}>{showProperty ? "Immobile consigliato" : "Cliente compatibile"}</p>
          <h3>{counterpartTitle}</h3>
          <p>{counterpartSubtitle}</p>
        </div>
        {match.id ? <Link className={styles.matchDetailAction} href={`/matching/${match.id}`}>Analizza match <ArrowRight aria-hidden="true" className="size-4" /></Link> : null}
      </div>
      <div className={styles.matchFacts}>
        {showProperty ? (
          <>
            <MatchFact icon={Banknote} label="Prezzo" value={propertyPrice(property)} />
            <MatchFact icon={Ruler} label="Superficie" value={property?.internal_sqm ? `${property.internal_sqm} mq` : "Non indicata"} />
            <MatchFact icon={MapPin} label="Zona" value={property?.zone?.name || property?.municipality || "Non indicata"} />
          </>
        ) : (
          <>
            <MatchFact icon={UserRound} label="Cliente" value={request?.clients?.full_name || "Da collegare"} />
            <MatchFact icon={Banknote} label="Budget" value={requestBudgetLabel(request)} />
            <MatchFact icon={Building2} label="Tipologia" value={request?.property_types?.join(", ") || "Non indicata"} />
          </>
        )}
      </div>
      <div className={styles.matchFooter}>
        <div className={styles.criteria}>{match.matched_criteria.slice(0, 3).map((criterion) => <span className={`${styles.criterion} ${styles.criterionGood}`} key={criterion}><CheckCircle2 aria-hidden="true" className="size-3.5" /> {criterion}</span>)}{match.conflicting_criteria.slice(0, 1).map((criterion) => <span className={`${styles.criterion} ${styles.criterionWarning}`} key={criterion}><AlertTriangle aria-hidden="true" className="size-3.5" /> {criterion}</span>)}</div>
        {match.id ? <div className={styles.matchStatusControl}><MatchStatusSelect id={match.id} value={match.status} /></div> : null}
      </div>
    </article>
  );
}

function MatchFact({ icon: Icon, label, value }: Readonly<{ icon: typeof Banknote; label: string; value: string }>) {
  return <div className={styles.matchFact}><Icon aria-hidden="true" className="size-3.5" /><span><small>{label}</small><strong>{value}</strong></span></div>;
}

function propertyPrice(property: Awaited<ReturnType<typeof listProperties>>[number] | undefined) {
  if (!property) return "Non indicato";
  const amount = property.contract_type === "sale" ? property.price : property.monthly_rent;
  return amount ? `€ ${Number(amount).toLocaleString("it-IT")}${property.contract_type === "rent" ? "/mese" : ""}` : "Non indicato";
}

function requestBudgetLabel(request: Awaited<ReturnType<typeof listRequests>>[number] | undefined) {
  if (!request) return "Non indicato";
  const amount = request.contract_type === "sale" ? request.budget_max : request.monthly_rent_max;
  return amount ? `€ ${Number(amount).toLocaleString("it-IT")}${request.contract_type === "rent" ? "/mese" : ""}` : "Da definire";
}

function DistributionRow({ label, count, total, href, tone }: Readonly<{ label: string; count: number; total: number; href: string; tone: string }>) {
  const percentage = total ? Math.round((count / total) * 100) : 0;
  return <Link className={styles.distributionRow} href={href}><span>{label}</span><div><i className={styles[`distribution_${tone}`]} style={{ width: `${percentage}%` }} /></div><strong>{count.toLocaleString("it-IT")}</strong><small>{percentage}%</small></Link>;
}

function groupMatches(matches: RequestPropertyMatch[], view: "request" | "property") {
  const groups = new Map<string, RequestPropertyMatch[]>();
  for (const match of matches) {
    const key = view === "request" ? match.request_id : match.property_id;
    groups.set(key, [...(groups.get(key) ?? []), match]);
  }
  return [...groups.entries()].sort((a, b) => (b[1][0]?.score ?? 0) - (a[1][0]?.score ?? 0));
}
function value(input: string | string[] | undefined) { return typeof input === "string" ? input : ""; }
function allowed<T extends string>(input: string, values: readonly T[]) { return values.includes(input as T) ? input as T : ""; }
function withQuery(query: Record<string, string | string[] | undefined>, updates: Record<string, string>) { const params = new URLSearchParams(); for (const [key, raw] of Object.entries(query)) if (typeof raw === "string" && raw) params.set(key, raw); for (const [key, raw] of Object.entries(updates)) params.set(key, raw); return `/matching?${params.toString()}`; }
function classificationLabel(input: string) { return ({ compatible: "Compatibile", almost_compatible: "Buona alternativa", weak: "Da valutare", not_relevant: "Poco pertinente" }[input] ?? "Abbinamento"); }
function commercialStatusLabel(input: string) { return ({ not_reviewed: "Da controllare", new: "Nuovo", to_propose: "Da proporre", proposed: "Proposto", interested: "Interessato", not_interested: "Non interessato", visit_scheduled: "Visita fissata", negotiation: "In trattativa", completed: "Concluso", excluded: "Escluso" }[input] ?? input.replaceAll("_", " ")); }
function weightLabel(input: string) { return ({ propertyType: "Tipologia", zone: "Zona", budget: "Budget", internalSqm: "Superficie", rooms: "Locali", floor: "Piano", condition: "Condizione", availability: "Disponibilità" }[input] ?? input); }
