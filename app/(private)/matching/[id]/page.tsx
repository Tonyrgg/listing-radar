import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  Building2,
  Check,
  CheckCircle2,
  CircleHelp,
  DoorOpen,
  MapPin,
  Ruler,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  cleanRequestTitle,
  requestArea,
  requestBudget,
  requestRooms,
} from "@/lib/matching/request-presentation";
import { getMatch, getProperty, getRequest } from "@/lib/matching/repository";
import type { MatchClassification, PortfolioProperty, PropertyRequest } from "@/lib/matching/types";

import styles from "./match-detail.module.css";

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dettaglio abbinamento" };

export default async function MatchDetailPage({ params }: PageProps<"/matching/[id]">) {
  const { id } = await params;
  const match = await getMatch(id);
  if (!match) notFound();

  const [requestDetail, propertyDetail] = await Promise.all([
    getRequest(match.request_id),
    getProperty(match.property_id),
  ]);
  if (!requestDetail || !propertyDetail) notFound();

  const request = requestDetail.request as PropertyRequest & { clients?: { full_name?: string | null } | null };
  const property = propertyDetail.property as PortfolioProperty & { zone?: { name?: string | null } | null };
  const clientName = request.clients?.full_name || "Cliente da collegare";
  const desiredZones = requestDetail.zones
    .filter((zone) => zone.preference_level !== "excluded")
    .map((zone) => zone.zone?.name)
    .filter(Boolean)
    .join(", ") || request.municipality || "Tutta Bitonto";
  const propertyZone = property.zone?.name || property.municipality || "Zona non indicata";
  const positive = match.matched_criteria ?? [];
  const conflicts = match.conflicting_criteria ?? [];
  const missing = match.missing_preferences ?? [];

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} href="/matching"><ArrowLeft aria-hidden="true" className="size-4" /> Torna al matching</Link>

      <header className={styles.decisionHero}>
        <div className={styles.decisionCopy}>
          <p className={styles.eyebrow}>{classificationLabel(match.classification as MatchClassification)}</p>
          <h1>{clientName} e {property.title}</h1>
          <p>{decisionCopy(match.score, conflicts.length)}</p>
        </div>
        <div className={styles.scorePanel} aria-label={`Compatibilità ${Math.round(match.score)} per cento`}>
          <strong>{Math.round(match.score)}%</strong>
          <span>compatibilità</span>
          <i><b style={{ width: `${match.score}%` }} /></i>
        </div>
      </header>

      <section className={styles.pairSection} aria-label="Soggetti del match">
        <article className={styles.pairEntity}>
          <div className={styles.entityHeading}><span><UserRound aria-hidden="true" className="size-4" /></span><div><p>Richiesta cliente</p><h2>{clientName}</h2></div></div>
          <p className={styles.entityTitle}>{cleanRequestTitle(request.title)}</p>
          <div className={styles.entitySignals}>
            <EntitySignal icon={Banknote} label="Budget" value={requestBudget(request)} />
            <EntitySignal icon={Ruler} label="Superficie" value={requestArea(request)} />
            <EntitySignal icon={DoorOpen} label="Locali" value={requestRooms(request)} />
            <EntitySignal icon={MapPin} label="Zona" value={desiredZones} />
          </div>
          <Link href={`/requests/${request.id}`}>Apri richiesta <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </article>

        <article className={styles.pairEntity}>
          <div className={styles.entityHeading}><span><Building2 aria-hidden="true" className="size-4" /></span><div><p>Immobile disponibile</p><h2>{property.title}</h2></div></div>
          <p className={styles.entityTitle}>{propertyTypeLabel(property.property_type)} · {propertyPrice(property)}</p>
          <div className={styles.entitySignals}>
            <EntitySignal icon={Banknote} label="Prezzo" value={propertyPrice(property)} />
            <EntitySignal icon={Ruler} label="Superficie" value={property.internal_sqm ? `${property.internal_sqm} mq` : "Non indicata"} />
            <EntitySignal icon={DoorOpen} label="Locali" value={numberLabel(property.rooms)} />
            <EntitySignal icon={MapPin} label="Zona" value={propertyZone} />
          </div>
          <Link href={`/portfolio/${property.id}`}>Apri immobile <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </article>
      </section>

      <section className={styles.comparisonSection}>
        <header>
          <div><p className={styles.eyebrow}>Confronto diretto</p><h2>Dove l’abbinamento funziona</h2></div>
          <span>I valori sono quelli usati dall’ultimo calcolo</span>
        </header>
        <div className={styles.comparisonList}>
          <ComparisonRow label="Tipologia" requested={request.property_types.length ? request.property_types.map(propertyTypeLabel).join(", ") : "Flessibile"} offered={propertyTypeLabel(property.property_type)} tone={criterionTone(match, ["tipologia"])} />
          <ComparisonRow label="Budget" requested={requestBudget(request)} offered={propertyPrice(property)} tone={criterionTone(match, ["budget"])} />
          <ComparisonRow label="Superficie" requested={requestArea(request)} offered={property.internal_sqm ? `${property.internal_sqm} mq` : "Non indicata"} tone={criterionTone(match, ["metratura"])} />
          <ComparisonRow label="Locali" requested={requestRooms(request)} offered={numberLabel(property.rooms)} tone={criterionTone(match, ["vani"])} />
          <ComparisonRow label="Zona" requested={desiredZones} offered={propertyZone} tone={criterionTone(match, ["zona", propertyZone.toLocaleLowerCase("it")])} />
          <ComparisonRow label="Disponibilità" requested={request.availability_requirement || "Nessun vincolo"} offered={availabilityLabel(property.availability_status)} tone={criterionTone(match, ["disponibilità"])} />
        </div>
      </section>

      <div className={styles.reasoningGrid}>
        <section className={styles.reasoningBlock}>
          <header><CheckCircle2 aria-hidden="true" className="size-5" /><div><p className={styles.eyebrow}>Punti a favore</p><h2>{positive.length ? `${positive.length} motivi concreti` : "Nessun dato decisivo"}</h2></div></header>
          <ReasonList items={positive} empty="Il punteggio deriva soprattutto dalla compatibilità generale dei dati disponibili." tone="positive" />
        </section>
        <section className={styles.reasoningBlock}>
          <header><AlertTriangle aria-hidden="true" className="size-5" /><div><p className={styles.eyebrow}>Da verificare</p><h2>{conflicts.length ? `${conflicts.length} ostacoli` : missing.length ? `${missing.length} dati mancanti` : "Nessun ostacolo rilevato"}</h2></div></header>
          <ReasonList items={[...conflicts, ...missing]} empty="Non risultano conflitti o preferenze mancanti." tone="warning" />
        </section>
      </div>

      <section className={styles.explanation}>
        <CircleHelp aria-hidden="true" className="size-5" />
        <div><p className={styles.eyebrow}>Lettura del sistema</p><h2>Perché ha ottenuto questo punteggio</h2><p>{match.explanation || "Il confronto è stato calcolato sui dati disponibili."}</p></div>
      </section>
    </div>
  );
}

function EntitySignal({ icon: Icon, label, value }: Readonly<{ icon: typeof Banknote; label: string; value: string }>) {
  return <div className={styles.entitySignal}><Icon aria-hidden="true" className="size-3.5" /><span><small>{label}</small><strong>{value}</strong></span></div>;
}

function ComparisonRow({ label, requested, offered, tone }: Readonly<{ label: string; requested: string; offered: string; tone: "positive" | "warning" | "neutral" }>) {
  const Icon = tone === "positive" ? Check : tone === "warning" ? AlertTriangle : CircleHelp;
  return <article className={styles.comparisonRow}><div className={styles.comparisonLabel}><Icon aria-hidden="true" className={styles[tone]} /><strong>{label}</strong></div><div><small>Richiesta</small><span>{requested}</span></div><div><small>Immobile</small><span>{offered}</span></div></article>;
}

function ReasonList({ items, empty, tone }: Readonly<{ items: string[]; empty: string; tone: "positive" | "warning" }>) {
  if (!items.length) return <p className={styles.reasonEmpty}>{empty}</p>;
  return <ul className={styles.reasonList}>{items.map((item) => <li key={item}>{tone === "positive" ? <Check aria-hidden="true" className="size-3.5" /> : <AlertTriangle aria-hidden="true" className="size-3.5" />}{item}</li>)}</ul>;
}

function criterionTone(match: Awaited<ReturnType<typeof getMatch>>, keys: string[]) {
  if (!match) return "neutral" as const;
  const includes = (items: string[]) => items.some((item) => keys.some((key) => item.toLocaleLowerCase("it").includes(key)));
  if (includes(match.conflicting_criteria) || includes(match.missing_preferences)) return "warning" as const;
  if (includes(match.matched_criteria)) return "positive" as const;
  return "neutral" as const;
}

function decisionCopy(score: number, conflicts: number) {
  if (score >= 85 && !conflicts) return "Abbinamento prioritario: i criteri principali sono allineati e non emergono ostacoli.";
  if (score >= 70) return conflicts ? "Buona opportunità, con alcuni punti da chiarire prima della proposta." : "Buona opportunità da valutare con il cliente.";
  if (score >= 50) return "Alternativa possibile: verifica i compromessi evidenziati prima di proporla.";
  return "Compatibilità limitata: usalo come confronto, non come prima proposta.";
}

function propertyPrice(property: PortfolioProperty) {
  const amount = property.contract_type === "sale" ? property.price : property.monthly_rent;
  return amount ? `€ ${Number(amount).toLocaleString("it-IT")}${property.contract_type === "rent" ? "/mese" : ""}` : "Da definire";
}

function numberLabel(value: number | null) { return value == null ? "Non indicati" : String(value); }
function classificationLabel(value: MatchClassification) { return ({ compatible: "Match prioritario", almost_compatible: "Buona alternativa", weak: "Da valutare", not_relevant: "Compatibilità debole" }[value]); }
function propertyTypeLabel(value: string) { return ({ apartment: "Appartamento", independent_house: "Casa indipendente", villa: "Villa", townhouse: "Villetta", penthouse: "Attico", ground_floor: "Piano terra", entire_building: "Intero stabile", commercial_space: "Locale commerciale", office: "Ufficio", warehouse: "Deposito / magazzino", garage: "Garage / box", land: "Terreno", other: "Altra tipologia" }[value] ?? value); }
function availabilityLabel(value: string | null) { return ({ available_now: "Disponibile subito", available_at_deed: "Al rogito", occupied: "Occupato", rented: "Locato", future_availability: "Disponibilità futura" }[value ?? ""] ?? "Non indicata"); }
