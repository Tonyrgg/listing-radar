import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";

import { RecalculateButton } from "@/components/matching/management-panels";
import { QuickRequestButton } from "@/components/matching/quick-request";
import styles from "@/components/matching/section-design.module.css";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import { MatchingSectionNav } from "@/components/matching/section-nav";
import { cleanRequestTitle } from "@/lib/matching/request-presentation";
import { listMatches, listProperties, listRequests } from "@/lib/matching/repository";

export default async function MatchingPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const query = await searchParams;
  const [matches, requests, properties] = await Promise.all([listMatches(), listRequests(), listProperties()]);
  const view = query.view === "property" ? "property" : "request";
  const classification = value(query.classification);
  const contract = value(query.contract);
  const minimum = Number(value(query.minimum)) || 0;
  const requestsById = new Map(requests.map((item) => [item.id, item]));
  const propertiesById = new Map(properties.map((item) => [item.id, item]));
  const activeRequests = requests.filter((item) => ["active", "urgent"].includes(item.status)).length;
  const activeProperties = properties.filter((item) => item.mandate_status === "active").length;
  const ready = activeRequests > 0 && activeProperties > 0;
  const filteredMatches = matches.filter((match) => {
    const request = requestsById.get(match.request_id);
    return (!classification || match.classification === classification) &&
      (!contract || request?.contract_type === contract) &&
      match.score >= minimum;
  });

  return (
    <div className={styles.page}>
      <MatchingSectionHeader
        eyebrow="Clienti e immobili"
        title="Panoramica matching"
        description="Stato del portafoglio e abbinamenti da lavorare."
        actions={<QuickRequestButton />}
      />
      <MatchingSectionNav />

      <dl className={styles.overviewStrip}>
        <Metric label="Richieste attive" value={activeRequests} note={`${requests.length} totali`} />
        <Metric label="Immobili disponibili" value={activeProperties} note={`${properties.length} totali`} />
        <Metric label="Compatibili" value={matches.filter((item) => item.classification === "compatible").length} note="abbinamenti forti" />
        <Metric label="Da proporre" value={matches.filter((item) => item.status === "to_propose").length} note="azioni aperte" />
      </dl>

      <section className={styles.panel} aria-labelledby="workflow-title">
        <header className={styles.panelHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Flusso operativo</p>
            <h2 className={styles.panelTitle} id="workflow-title">Preparazione del matching</h2>
          </div>
          {ready ? <RecalculateButton scope="all" /> : null}
        </header>
        <div className={styles.workflow}>
          <WorkflowStep
            number={1}
            title="Richieste"
            description={activeRequests ? `${activeRequests} richieste pronte al confronto.` : "Registra almeno una richiesta attiva."}
            complete={activeRequests > 0}
            action={<Link className={styles.textAction} href="/requests">Apri richieste <ArrowRight aria-hidden="true" className="size-4" /></Link>}
          />
          <WorkflowStep
            number={2}
            title="Immobili"
            description={activeProperties ? `${activeProperties} immobili disponibili.` : "Aggiungi almeno un immobile disponibile."}
            complete={activeProperties > 0}
            action={<Link className={styles.textAction} href="/portfolio">Apri portafoglio <ArrowRight aria-hidden="true" className="size-4" /></Link>}
          />
          <WorkflowStep
            number={3}
            title="Abbinamenti"
            description={matches.length ? `${matches.length} confronti calcolati.` : ready ? "I dati sono pronti per il primo calcolo." : "Completa richieste e portafoglio."}
            complete={matches.length > 0}
            action={!ready ? <span className={styles.muted}>In attesa dei primi due passaggi</span> : null}
          />
        </div>
      </section>

      <div className={styles.operations}>
        <div>
          <p className={styles.sectionEyebrow}>Vista operativa</p>
          <p className={styles.panelDescription}>
            {filteredMatches.length} risultati, ordinati dal punteggio più alto.
          </p>
        </div>
        <div className={styles.segments}>
          <Link className={`${styles.segment} ${view === "request" ? styles.segmentActive : ""}`} href="/matching?view=request">Per cliente</Link>
          <Link className={`${styles.segment} ${view === "property" ? styles.segmentActive : ""}`} href="/matching?view=property">Per immobile</Link>
        </div>
      </div>

      <section className={styles.panel}>
        <details className={styles.filterDetails} open={Boolean(classification || contract || minimum)}>
          <summary className={styles.filterSummary}>Filtri risultati <ChevronDown aria-hidden="true" className="size-4" /></summary>
          <form className={styles.filterForm}>
            <input type="hidden" name="view" value={view} />
            <select className={styles.select} name="classification" defaultValue={classification} aria-label="Classificazione">
              <option value="">Tutte le classificazioni</option>
              <option value="compatible">Compatibili</option>
              <option value="almost_compatible">Buone alternative</option>
              <option value="weak">Da valutare</option>
              <option value="not_relevant">Poco adatti</option>
            </select>
            <select className={styles.select} name="contract" defaultValue={contract} aria-label="Contratto">
              <option value="">Vendita e locazione</option>
              <option value="sale">Vendita</option>
              <option value="rent">Locazione</option>
            </select>
            <input className={styles.input} name="minimum" type="number" min="0" max="100" defaultValue={minimum || ""} placeholder="Affinità minima" aria-label="Affinità minima" />
            <button className={styles.secondaryButton}>Applica filtri</button>
          </form>
        </details>

        <div className={styles.matchList}>
          {filteredMatches.slice(0, 50).map((match) => {
            const request = requestsById.get(match.request_id);
            const property = propertiesById.get(match.property_id);
            return (
              <article className={styles.matchRecord} key={match.id}>
                <header className={styles.matchHeader}>
                  <div className={styles.statusLine}>
                    <span className={styles.badge}>{classificationLabel(match.classification)}</span>
                    <span className={styles.badge}>{commercialStatusLabel(match.status)}</span>
                  </div>
                  <div className="text-right">
                    <p className={styles.score}>{Math.round(match.score)}%</p>
                    <p className={styles.scoreLabel}>affinità</p>
                  </div>
                </header>

                <div className={styles.pairing}>
                  <Link className={styles.pairSide} href={`/requests/${match.request_id}`}>
                    <span className={styles.pairLabel}>Richiesta cliente</span>
                    <span className={styles.pairTitle}>{request ? cleanRequestTitle(request.title) : "Richiesta"}</span>
                    <span className={styles.pairMeta}>{request?.clients?.full_name || "Cliente da collegare"} · {request?.contract_type === "rent" ? "Locazione" : "Acquisto"}</span>
                  </Link>
                  <ArrowRightLeft aria-label="Abbinato a" className={`${styles.pairArrow} size-4 rotate-90 sm:rotate-0`} />
                  <Link className={styles.pairSide} href={`/portfolio/${match.property_id}`}>
                    <span className={styles.pairLabel}>Immobile</span>
                    <span className={styles.pairTitle}>{property?.title || "Immobile"}</span>
                    <span className={styles.pairMeta}>{property?.zone?.name || property?.municipality || "Zona non indicata"}</span>
                  </Link>
                </div>

                <div className={styles.criteria}>
                  {match.matched_criteria.slice(0, 3).map((criterion) => <span className={`${styles.criterion} ${styles.criterionGood}`} key={criterion}><CheckCircle2 aria-hidden="true" className="size-3.5" /> {criterion}</span>)}
                  {match.conflicting_criteria.slice(0, 2).map((criterion) => <span className={`${styles.criterion} ${styles.criterionWarning}`} key={criterion}><AlertTriangle aria-hidden="true" className="size-3.5" /> {criterion}</span>)}
                </div>
              </article>
            );
          })}
          {!filteredMatches.length ? (
            <div className={styles.emptyState}>
              <div>
                <Check aria-hidden="true" className="mx-auto size-6 text-[var(--surface-accent)]" />
                <h2 className="mt-4 font-semibold text-[var(--ink-strong)]">Nessun abbinamento da mostrare</h2>
                <p className="mt-2 text-sm">Modifica i filtri oppure completa richieste e portafoglio.</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value: metricValue, note }: Readonly<{ label: string; value: number; note: string }>) {
  return <div className={styles.metric}><dt className={styles.label}>{label}</dt><dd className={styles.metricValue}>{metricValue}</dd><dd className={styles.metricNote}>{note}</dd></div>;
}

function WorkflowStep({ number, title, description, complete, action }: Readonly<{ number: number; title: string; description: string; complete: boolean; action: React.ReactNode }>) {
  return <div className={`${styles.workflowStep} ${complete ? styles.stepComplete : ""}`}><span className={styles.stepNumber}>{complete ? <Check aria-label="Completato" className="size-3.5" /> : number}</span><div><h3 className={styles.stepTitle}>{title}</h3><p className={styles.stepText}>{description}</p>{action ? <div className={styles.stepAction}>{action}</div> : null}</div></div>;
}

function value(input: string | string[] | undefined) { return typeof input === "string" ? input : ""; }
function classificationLabel(value: string) { return ({ compatible: "Compatibile", almost_compatible: "Buona alternativa", weak: "Da valutare", not_relevant: "Poco adatto" }[value] ?? "Abbinamento"); }
function commercialStatusLabel(value: string) { return ({ not_reviewed: "Da controllare", new: "Nuovo", to_propose: "Da proporre", proposed: "Proposto", interested: "Interessato", not_interested: "Non interessato", visit_scheduled: "Visita fissata", negotiation: "In trattativa", completed: "Concluso", excluded: "Escluso" }[value] ?? value.replaceAll("_", " ")); }
