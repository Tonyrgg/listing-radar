import { ArrowLeft, Bath, BedDouble, DoorOpen, Layers3, MapPin, Ruler, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MatchCard } from "@/components/matching/match-card";
import { ProgressiveList } from "@/components/progressive-list";
import { DeletePropertyButton, PropertyEditor, RecalculateButton } from "@/components/matching/management-panels";
import styles from "@/components/matching/section-design.module.css";
import { ZoneMap } from "@/components/matching/zone-map";
import { propertyConditionLabel, propertyCrmCondition } from "@/lib/matching/property-presentation";
import { getProperty, listFeatures, listZones } from "@/lib/matching/repository";
import type { MatchClassification, PortfolioProperty } from "@/lib/matching/types";

export default async function PropertyDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const [detail, zones, features] = await Promise.all([getProperty(id), listZones(), listFeatures()]);
  if (!detail) notFound();
  const property = detail.property;
  const featureValues = Object.fromEntries(detail.features.map((item) => [item.feature_definition_id, item.value]));
  const activeFeatures = detail.features.filter((item) => Boolean(item.value));
  const price = property.contract_type === "sale" ? property.price : property.monthly_rent;
  const priceLabel = price ? `€ ${Number(price).toLocaleString("it-IT")}${property.contract_type === "rent" ? "/mese" : ""}` : "Prezzo da definire";
  const zoneShapes = zones.filter((zone) => zone.geometry).map((zone) => ({
    shapeId: zone.id,
    zoneId: zone.id,
    zoneNumber: zone.zone_number,
    name: zone.name,
    color: zone.color,
    geometry: zone.geometry!,
  }));
  const propertyPoint = property.latitude != null && property.longitude != null
    ? { latitude: Number(property.latitude), longitude: Number(property.longitude) }
    : null;
  const internalCondition = propertyCrmCondition(property as PortfolioProperty, "Stato Interno");
  const externalCondition = propertyCrmCondition(property as PortfolioProperty, "Stato Esterno");

  return (
    <div className={styles.page}>
      <header className={styles.entityHero}>
        <Link className={styles.backLink} href="/portfolio"><ArrowLeft aria-hidden="true" className="size-4" /> Tutti gli immobili</Link>
        <div className={styles.entityTitleRow}>
          <div>
            <p className={styles.recordReference}>{property.contract_type === "sale" ? "Immobile in vendita" : "Immobile in locazione"}</p>
            <h1 className={styles.entityTitle}>{property.title}</h1>
            <p className={styles.entityLocation}><MapPin aria-hidden="true" className="size-4" /> {property.address || property.zone?.name || property.municipality || "Indirizzo non indicato"}</p>
          </div>
          <div className={styles.actions}>
            <PropertyEditor zones={zones} features={features} property={{ ...(property as PortfolioProperty), feature_values: featureValues }} />
            <RecalculateButton scope="property" id={id} />
            <DeletePropertyButton id={id} />
          </div>
        </div>
        <div className={styles.propertyPriority}>
          <div className={styles.priceFocus}><span>{property.contract_type === "sale" ? "Prezzo richiesto" : "Canone mensile"}</span><strong>{priceLabel}</strong></div>
          <div className={styles.propertySignals}>
            <PropertySignal icon={Ruler} label="Superficie" value={property.internal_sqm ? `${property.internal_sqm} mq` : "Da indicare"} />
            <PropertySignal icon={DoorOpen} label="Locali" value={numberValue(property.rooms)} />
            <PropertySignal icon={BedDouble} label="Camere" value={numberValue(property.bedrooms)} />
            <PropertySignal icon={Bath} label="Bagni" value={numberValue(property.bathrooms)} />
            <PropertySignal icon={Layers3} label="Piano" value={numberValue(property.floor)} />
            <PropertySignal icon={Sparkles} label="Stato" value={propertyConditionLabel(property.condition)} />
          </div>
        </div>
        <div className={styles.entityContext}>
          <span><strong>{mandateLabel(property.mandate_status)}</strong> incarico</span>
          <span>Disponibilità: {availabilityLabel(property.availability_status)}</span>
          <span>Zona: {property.zone?.name || property.municipality || "da indicare"}</span>
          <span>Stato finale: {propertyConditionLabel(property.condition)}</span>
        </div>
      </header>

      <section className={styles.propertyWorkspace}>
        <div className={styles.propertyMapArea}>
          <header><div><p className={styles.sectionEyebrow}>Posizione</p><h2 className={styles.panelTitle}>Dove si trova</h2></div><span className={styles.count}>{propertyPoint ? "Punto esatto" : property.internal_zone_id ? "Perimetro zona" : "Da completare"}</span></header>
          <div className={styles.propertyMapBody}>
            {zoneShapes.length || propertyPoint ? <ZoneMap compact showZoneLabels showFullscreenControl shapes={zoneShapes} highlightedZoneId={property.internal_zone_id} point={propertyPoint} /> : <div className={styles.mapEmptyState}><MapPin aria-hidden="true" className="size-5" /><strong>Posizione da completare</strong><p>Aggiungi il punto esatto o assegna una zona immobiliare per localizzare l’immobile.</p></div>}
          </div>
          {property.description ? <div className={styles.propertyNarrative}><p className={styles.label}>Presentazione</p><p>{property.description}</p></div> : null}
        </div>
        <aside className={styles.propertyEssentials}>
          <div><p className={styles.sectionEyebrow}>Quadro operativo</p><h2 className={styles.panelTitle}>Cosa sapere prima di proporlo</h2></div>
          <dl className={styles.essentialList}>
            <Essential label="Esito finale" value={propertyConditionLabel(property.condition)} />
            <Essential label="Stato interno · CRM" value={internalCondition || "Non indicato"} />
            <Essential label="Stato esterno · CRM" value={externalCondition || "Non indicato"} />
            <Essential label="Tipologia" value={propertyTypeLabel(property.property_type)} />
            <Essential label="Superficie commerciale" value={property.commercial_sqm ? `${property.commercial_sqm} mq` : "Non indicata"} />
            <Essential label="Edificio" value={property.building_floors ? `${property.building_floors} piani` : "Piani non indicati"} />
            <Essential label="Contratto" value={property.contract_type === "sale" ? "Vendita" : "Locazione"} />
            <Essential label="Disponibile dal" value={property.available_from ? new Date(property.available_from).toLocaleDateString("it-IT") : availabilityLabel(property.availability_status)} />
            <Essential label="Zona" value={property.zone?.name || property.municipality || "Non indicata"} />
          </dl>
          {!propertyPoint ? <p className={styles.completionHint}>Aggiungi il punto esatto da “Modifica immobile” per rendere la scheda completa.</p> : null}
        </aside>
      </section>

      {property.notes ? <section className={styles.editorialNote}><p className={styles.sectionEyebrow}>Nota interna</p><p>{property.notes}</p></section> : null}

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
            <ProgressiveList className={styles.matchGrid} initialCount={4} step={4} noun="richieste">
              {detail.matches.map((match) => <MatchCard key={match.id} match={{ ...match, classification: match.classification as MatchClassification }} counterpartHref={`/requests/${match.request_id}`} counterpartTitle={`${match.request?.clients?.full_name || "Cliente da collegare"}: ${match.request?.title || "Richiesta"}`} detailHref={match.id ? `/matching/${match.id}` : undefined} />)}
            </ProgressiveList>
          ) : <p className={styles.muted}>Nessuna richiesta confrontata con questo immobile.</p>}
        </div>
      </section>
    </div>
  );
}

function PropertySignal({ icon: Icon, label, value }: Readonly<{ icon: typeof Ruler; label: string; value: string }>) { return <div className={styles.propertySignal}><Icon aria-hidden="true" className="size-4" /><span><small>{label}</small><strong>{value}</strong></span></div>; }
function Essential({ label, value }: Readonly<{ label: string; value: string }>) { return <div className={styles.essentialItem}><dt>{label}</dt><dd>{value}</dd></div>; }
function numberValue(value: number | null) { return value === null ? "Non indicato" : String(value); }
function propertyTypeLabel(value: string) { return ({ apartment: "Appartamento", independent_house: "Casa indipendente", villa: "Villa", townhouse: "Villetta", penthouse: "Attico", ground_floor: "Piano terra", entire_building: "Intero stabile", commercial_space: "Locale commerciale", office: "Ufficio", warehouse: "Deposito / magazzino", garage: "Garage / box", land: "Terreno", other: "Altra tipologia" }[value] ?? value); }
function mandateLabel(value: string) { return ({ draft: "Bozza", active: "Disponibile", suspended: "Sospeso", expired: "Scaduto", sold: "Venduto", rented: "Affittato", archived: "Archiviato" }[value] ?? value); }
function availabilityLabel(value: string | null) { return ({ available_now: "Disponibile subito", available_at_deed: "Al rogito", occupied: "Occupato", rented: "Locato", future_availability: "Disponibilità futura" }[value ?? ""] ?? "Non indicata"); }
