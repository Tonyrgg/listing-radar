import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MatchCard } from "@/components/matching/match-card";
import { DeletePropertyButton, PropertyEditor, RecalculateButton } from "@/components/matching/management-panels";
import styles from "@/components/matching/section-design.module.css";
import { ZoneMap } from "@/components/matching/zone-map";
import { getProperty, listFeatures, listZones } from "@/lib/matching/repository";
import type { MatchClassification, MatchStatus, PortfolioProperty } from "@/lib/matching/types";

export default async function PropertyDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const [detail, zones, features] = await Promise.all([getProperty(id), listZones(), listFeatures()]);
  if (!detail) notFound();
  const property = detail.property;
  const featureValues = Object.fromEntries(detail.features.map((item) => [item.feature_definition_id, item.value]));
  const activeFeatures = detail.features.filter((item) => Boolean(item.value));
  const price = property.contract_type === "sale" ? property.price : property.monthly_rent;
  const zoneShapes = zones.filter((zone) => zone.geometry).map((zone) => ({
    shapeId: zone.id,
    zoneId: zone.id,
    name: zone.name,
    color: zone.color,
    geometry: zone.geometry!,
  }));
  const propertyPoint = property.latitude != null && property.longitude != null
    ? { latitude: Number(property.latitude), longitude: Number(property.longitude) }
    : null;

  return (
    <div className={styles.page}>
      <header className={styles.detailHeader}>
        <Link className={styles.backLink} href="/portfolio"><ArrowLeft aria-hidden="true" className="size-4" /> Tutti gli immobili</Link>
        <div className={styles.detailTitleRow}>
          <div>
            <p className={styles.recordReference}>{property.contract_type === "sale" ? "Immobile in vendita" : "Immobile in locazione"}</p>
            <h1 className={styles.detailTitle}>{property.title}</h1>
            <p className={styles.recordSubtitle}>{property.address || property.zone?.name || property.municipality || "Indirizzo non indicato"}</p>
          </div>
          <div className={styles.actions}>
            <PropertyEditor zones={zones} features={features} property={{ ...(property as PortfolioProperty), feature_values: featureValues }} />
            <RecalculateButton scope="property" id={id} />
            <DeletePropertyButton id={id} />
          </div>
        </div>
        <dl className={styles.metadataStrip}>
          <Meta label="Stato incarico" value={mandateLabel(property.mandate_status)} />
          <Meta label={property.contract_type === "sale" ? "Prezzo" : "Canone"} value={price ? `€ ${Number(price).toLocaleString("it-IT")}${property.contract_type === "rent" ? "/mese" : ""}` : "Da definire"} />
          <Meta label="Zona immobiliare" value={property.zone?.name || property.municipality || "Non indicata"} />
          <Meta label="Disponibilità" value={availabilityLabel(property.availability_status)} />
        </dl>
      </header>

      <section className={styles.panel}>
        <div className={styles.detailGrid}>
          <section className={styles.detailColumn}>
            <p className={styles.sectionEyebrow}>Immobile</p>
            <h2 className={styles.panelTitle}>Caratteristiche principali</h2>
            <dl className={`${styles.fieldList} mt-5`}>
              <Field label="Tipologia" value={propertyTypeLabel(property.property_type)} />
              <Field label="Superficie interna" value={property.internal_sqm ? `${property.internal_sqm} mq` : "Non indicata"} />
              <Field label="Superficie commerciale" value={property.commercial_sqm ? `${property.commercial_sqm} mq` : "Non indicata"} />
              <Field label="Locali" value={numberValue(property.rooms)} />
              <Field label="Camere" value={numberValue(property.bedrooms)} />
              <Field label="Bagni" value={numberValue(property.bathrooms)} />
              <Field label="Piano" value={numberValue(property.floor)} />
              <Field label="Piani edificio" value={numberValue(property.building_floors)} />
            </dl>
          </section>
          <section className={styles.detailColumn}>
            <p className={styles.sectionEyebrow}>Commerciale</p>
            <h2 className={styles.panelTitle}>Incarico e disponibilità</h2>
            <dl className={`${styles.fieldList} mt-5`}>
              <Field label="Contratto" value={property.contract_type === "sale" ? "Vendita" : "Locazione"} />
              <Field label="Stato incarico" value={mandateLabel(property.mandate_status)} />
              <Field label="Condizione" value={conditionLabel(property.condition)} />
              <Field label="Disponibilità" value={availabilityLabel(property.availability_status)} />
              <Field label="Disponibile dal" value={property.available_from ? new Date(property.available_from).toLocaleDateString("it-IT") : "Non indicato"} />
              <Field label="Comune" value={property.municipality || "Non indicato"} />
              <Field label="Zona immobiliare" value={property.zone?.name || "Non indicata"} />
              <Field label="Indirizzo" value={property.address || "Non indicato"} />
            </dl>
          </section>
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <div><p className={styles.sectionEyebrow}>Posizione</p><h2 className={styles.panelTitle}>Immobile sulla mappa</h2></div>
          <span className={styles.count}>{propertyPoint ? "Punto esatto salvato" : property.internal_zone_id ? "Perimetro immobiliare" : "Posizione da completare"}</span>
        </header>
        <div className={styles.panelBody}>
          {zoneShapes.length || propertyPoint ? (
            <ZoneMap compact shapes={zoneShapes} highlightedZoneId={property.internal_zone_id} point={propertyPoint} />
          ) : (
            <p className={styles.muted}>Disegna i perimetri nella scheda Zone immobiliari per visualizzare la posizione. Le aree operative degli agenti non vengono usate.</p>
          )}
          {!propertyPoint ? <p className={`${styles.muted} mt-3`}>Per aggiungere il punto esatto, usa “Modifica immobile” e clicca sulla mappa.</p> : null}
        </div>
      </section>

      {property.description || property.notes ? (
        <section className={styles.panel}>
          <header className={styles.panelHeader}><div><p className={styles.sectionEyebrow}>Informazioni</p><h2 className={styles.panelTitle}>Descrizione e note</h2></div></header>
          <div className={styles.detailGrid}>
            <div className={styles.detailColumn}><p className={styles.label}>Descrizione</p><p className={`${styles.description} mt-2`}>{property.description || "Non disponibile"}</p></div>
            <div className={styles.detailColumn}><p className={styles.label}>Note interne</p><p className={`${styles.description} mt-2`}>{property.notes || "Nessuna nota"}</p></div>
          </div>
        </section>
      ) : null}

      <section className={styles.panel}>
        <header className={styles.panelHeader}><div><p className={styles.sectionEyebrow}>Dotazioni</p><h2 className={styles.panelTitle}>Caratteristiche presenti</h2></div><span className={styles.count}>{activeFeatures.length}</span></header>
        <div className={styles.panelBody}>
          {activeFeatures.length ? <div className={styles.features}>{activeFeatures.map((item) => <span className={styles.feature} key={item.id}>{item.feature?.label || "Caratteristica"}</span>)}</div> : <p className={styles.muted}>Nessuna dotazione indicata.</p>}
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}><div><p className={styles.sectionEyebrow}>Matching</p><h2 className={styles.panelTitle}>Richieste compatibili</h2></div><span className={styles.count}>{detail.matches.length} risultati</span></header>
        <div className={styles.panelBody}>
          {detail.matches.length ? (
            <div className={styles.matchGrid}>
              {detail.matches.map((match) => <MatchCard key={match.id} match={{ ...match, classification: match.classification as MatchClassification, status: match.status as MatchStatus }} counterpartHref={`/requests/${match.request_id}`} counterpartTitle={`${match.request?.clients?.full_name || "Cliente da collegare"}: ${match.request?.title || "Richiesta"}`} />)}
            </div>
          ) : <p className={styles.muted}>Nessuna richiesta confrontata con questo immobile.</p>}
        </div>
      </section>
    </div>
  );
}

function Meta({ label, value }: Readonly<{ label: string; value: string }>) { return <div className={styles.metaItem}><dt className={styles.label}>{label}</dt><dd className={styles.metaValue}>{value}</dd></div>; }
function Field({ label, value }: Readonly<{ label: string; value: string }>) { return <div className={styles.fieldRow}><dt className={styles.label}>{label}</dt><dd className={styles.fieldValue}>{value}</dd></div>; }
function numberValue(value: number | null) { return value === null ? "Non indicato" : String(value); }
function propertyTypeLabel(value: string) { return ({ apartment: "Appartamento", independent_house: "Casa indipendente", villa: "Villa", townhouse: "Villetta", penthouse: "Attico", ground_floor: "Piano terra", entire_building: "Intero stabile" }[value] ?? value); }
function mandateLabel(value: string) { return ({ draft: "Bozza", active: "Disponibile", suspended: "Sospeso", expired: "Scaduto", sold: "Venduto", rented: "Affittato", archived: "Archiviato" }[value] ?? value); }
function availabilityLabel(value: string | null) { return ({ available_now: "Disponibile subito", available_at_deed: "Al rogito", occupied: "Occupato", rented: "Locato", future_availability: "Disponibilità futura" }[value ?? ""] ?? "Non indicata"); }
function conditionLabel(value: string | null) { return ({ new: "Nuovo", excellent: "Ottimo", good: "Buono", habitable: "Abitabile", renovated: "Ristrutturato", to_renovate: "Da ristrutturare" }[value ?? ""] ?? value ?? "Non indicata"); }
