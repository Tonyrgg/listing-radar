import { ArrowUpRight, MapPin } from "lucide-react";
import { notFound } from "next/navigation";

import { DeletePropertyButton, PropertyEditor, RecalculateButton } from "@/components/matching/management-panels";
import { ColpoDocchio } from "@/components/casa/colpo-docchio";
import { PageHeader } from "@/components/page-header";
import { LoadingAnchor } from "@/components/loading-controls";
import { Meta, buttonClass } from "@/components/ui/primitives";
import { readNow } from "@/lib/clock";
import { MatchCard } from "@/components/matching/match-card";
import { formatShouty } from "@/lib/formatting";
import { cleanPropertyTitle, cleanRequestTitle } from "@/lib/matching/request-presentation";
import { ProgressiveList } from "@/components/progressive-list";
import styles from "@/components/matching/section-design.module.css";
import { ZoneMap } from "@/components/matching/zone-map";
import { propertyConditionLabel, propertyCrmCondition, propertyCrmUrl } from "@/lib/matching/property-presentation";
import { getProperty, listFeatures, listZones } from "@/lib/matching/repository";
import type { MatchClassification, PortfolioProperty } from "@/lib/matching/types";


/**
 * La scheda di una casa che teniamo noi.
 *
 * Stessa apertura di una casa del mercato — foto, prezzo, metri, locali — e
 * poi quello che di una casa nostra si sa in più: chi la cerca, dove sta
 * esattamente, cosa ha dentro, e i comandi per correggerla.
 */
export async function SchedaNostra({ id }: Readonly<{ id: string }>) {
  const [detail, zones, features, now] = await Promise.all([
    getProperty(id),
    listZones(),
    listFeatures(),
    readNow(),
  ]);
  if (!detail) notFound();
  const property = detail.property as PortfolioProperty;
  const featureValues = Object.fromEntries(detail.features.map((item) => [item.feature_definition_id, item.value]));
  const activeFeatures = detail.features.filter((item) => Boolean(item.value));
  const price = property.contract_type === "sale" ? property.price : property.monthly_rent;
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
  const crmUrl = propertyCrmUrl(property);
  const internalCondition = propertyCrmCondition(property as PortfolioProperty, "Stato Interno");
  const externalCondition = propertyCrmCondition(property as PortfolioProperty, "Stato Esterno");

  /* `Date.now()` durante il disegno non è puro: l'orologio si legge una volta
   * sola, insieme ai dati. */
  const giorniInPortafoglio = property.created_at
    ? Math.max(
        0,
        Math.floor((now - new Date(property.created_at).getTime()) / (24 * 60 * 60 * 1000)),
      )
    : null;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="La casa"
        title={formatShouty(property.address || cleanPropertyTitle(property.title))}
        description={[
          property.contract_type === "sale" ? "La teniamo noi, in vendita" : "La teniamo noi, in affitto",
          property.zone?.name || property.municipality,
        ]
          .filter(Boolean)
          .join(" · ")}
        backHref="/portfolio"
        backLabel="Torna al portafoglio"
        actions={
          <div className="flex flex-wrap gap-2">
            {crmUrl ? (
              <LoadingAnchor
                className={buttonClass("secondary", { compact: true })}
                href={crmUrl}
                target="_blank"
                rel="noreferrer"
                pendingLabel="Apro CRM"
              >
                Apri nel CRM <ArrowUpRight aria-hidden="true" className="size-4" />
              </LoadingAnchor>
            ) : null}
            <PropertyEditor
              zones={zones}
              features={features}
              property={{ ...(property as PortfolioProperty), feature_values: featureValues }}
            />
            <RecalculateButton scope="property" id={id} />
            <DeletePropertyButton id={id} />
          </div>
        }
      />

      <ColpoDocchio
        casa={{
          indirizzo: formatShouty(property.address || cleanPropertyTitle(property.title)),
          contratto: property.contract_type === "sale" ? "In vendita" : "In affitto",
          prezzo: price,
          prezzoEtichetta:
            property.contract_type === "sale" ? "Prezzo richiesto" : "Canone mensile",
          mq: property.internal_sqm ?? property.commercial_sqm,
          locali: property.rooms,
          piano: property.floor,
          foto: property.image_urls ?? [],
          statoTesto: mandateLabel(property.mandate_status),
          statoForma: property.mandate_status === "active" ? "agenzia" : "chiuso",
          giorniSulMercato: giorniInPortafoglio,
          notaGiorni: "Da quando l'incarico è entrato in portafoglio.",
        }}
      >
        <Meta>
          {[
            property.zone?.name || property.municipality,
            propertyTypeLabel(property.property_type),
            property.condition ? propertyConditionLabel(property.condition) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Meta>
      </ColpoDocchio>

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
            {internalCondition ? <Essential label="Com'è dentro" value={internalCondition} /> : null}
            {externalCondition ? <Essential label="Com'è fuori" value={externalCondition} /> : null}
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
              {detail.matches.map((match) => <MatchCard key={match.id} match={{ ...match, classification: match.classification as MatchClassification }} counterpartHref={`/requests/${match.request_id}`} counterpartTitle={match.request?.clients?.full_name || cleanRequestTitle(match.request?.title) || "Cliente da collegare"} detailHref={match.id ? `/matching/${match.id}` : undefined} />)}
            </ProgressiveList>
          ) : <p className={styles.muted}>Nessuna richiesta confrontata con questo immobile.</p>}
        </div>
      </section>
    </div>
  );
}

function Essential({ label, value }: Readonly<{ label: string; value: string }>) { return <div className={styles.essentialItem}><dt>{label}</dt><dd>{value}</dd></div>; }

function propertyTypeLabel(value: string) { return ({ apartment: "Appartamento", independent_house: "Casa indipendente", villa: "Villa", townhouse: "Villetta", penthouse: "Attico", ground_floor: "Piano terra", entire_building: "Intero stabile", commercial_space: "Locale commerciale", office: "Ufficio", warehouse: "Deposito / magazzino", garage: "Garage / box", land: "Terreno", other: "Altra tipologia" }[value] ?? value); }
function mandateLabel(value: string) { return ({ draft: "Bozza", active: "Disponibile", suspended: "Sospeso", expired: "Scaduto", sold: "Venduto", rented: "Affittato", archived: "Archiviato" }[value] ?? value); }
function availabilityLabel(value: string | null) { return ({ available_now: "Disponibile subito", available_at_deed: "Al rogito", occupied: "Occupato", rented: "Locato", future_availability: "Disponibilità futura" }[value ?? ""] ?? "Non indicata"); }
