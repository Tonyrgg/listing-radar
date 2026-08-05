import { ArrowUpRight, Building2, CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";

import { PropertyEditor } from "@/components/matching/management-panels";
import { MatchingSectionNav } from "@/components/matching/section-nav";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import styles from "@/components/matching/section-design.module.css";
import { propertyConditionLabel } from "@/lib/matching/property-presentation";
import { listFeatures, listProperties, listZones } from "@/lib/matching/repository";

export default async function PortfolioPage() {
  const [properties, zones, features] = await Promise.all([
    listProperties(),
    listZones(),
    listFeatures(),
  ]);

  const active = properties.filter((property) => property.mandate_status === "active").length;

  return (
    <div className={styles.page}>
      <MatchingSectionHeader
        eyebrow="Clienti e immobili"
        title="Immobili disponibili"
        description="Il portafoglio operativo da confrontare con le richieste attive."
        actions={<PropertyEditor zones={zones} features={features} />}
      />
      <MatchingSectionNav />

      <dl className={styles.overviewStrip}>
        <Metric label="Totale portafoglio" value={properties.length} note="immobili registrati" />
        <Metric label="Disponibili" value={active} note="pronti per il matching" />
        <Metric label="Vendita" value={properties.filter((item) => item.contract_type === "sale").length} note="incarichi di vendita" />
        <Metric label="Locazione" value={properties.filter((item) => item.contract_type === "rent").length} note="incarichi di locazione" />
      </dl>

      <div className={styles.recordGrid}>
        {properties.map((property) => {
          const price = property.contract_type === "sale" ? property.price : property.monthly_rent;
          const featureCount = (property.property_feature_values ?? []).filter((item) => Boolean(item.value)).length;
          return (
            <Link
              className={styles.propertyCard}
              href={`/portfolio/${property.id}`}
              key={property.id}
              aria-label={`Apri l’immobile ${property.title}`}
            >
              <header className={styles.propertyHeader}>
                <div>
                  <p className={styles.recordReference}>{property.contract_type === "sale" ? "Vendita" : "Locazione"}</p>
                  <h2 className={styles.recordTitle}>{property.title}</h2>
                  <p className={styles.recordSubtitle}>
                    {property.zone?.name || property.address || property.municipality || "Zona da completare"}
                  </p>
                </div>
                <span className={styles.badge}>{mandateLabel(property.mandate_status)}</span>
              </header>

              <dl className={styles.propertyHighlights}>
                <PropertyHighlight label={property.contract_type === "sale" ? "Prezzo" : "Canone"} value={price ? `€ ${Number(price).toLocaleString("it-IT")}${property.contract_type === "rent" ? "/mese" : ""}` : "Da definire"} />
                <PropertyHighlight label="Superficie" value={property.internal_sqm ? `${property.internal_sqm} mq` : "Non indicata"} muted={!property.internal_sqm} />
                <PropertyHighlight label="Stato" value={propertyConditionLabel(property.condition)} muted={!property.condition} emphasized />
              </dl>

              <div className={styles.propertyBody}>
                <section className={styles.recordColumn}>
                  <h3 className={styles.columnTitle}>Immobile</h3>
                  <dl className={styles.fieldList}>
                    <Field label="Tipologia" value={propertyTypeLabel(property.property_type)} />
                    <Field label="Locali" value={numberValue(property.rooms)} />
                    <Field label="Camere" value={numberValue(property.bedrooms)} />
                    <Field label="Bagni" value={numberValue(property.bathrooms)} />
                    <Field label="Piano" value={numberValue(property.floor)} />
                  </dl>
                </section>
                <section className={styles.recordColumn}>
                  <h3 className={styles.columnTitle}>Commerciale</h3>
                  <dl className={styles.fieldList}>
                    <Field label="Incarico" value={mandateLabel(property.mandate_status)} />
                    <Field label="Disponibilità" value={availabilityLabel(property.availability_status)} />
                    <Field label="Comune" value={property.municipality || "Non indicato"} />
                    <Field label="Indirizzo" value={property.address || "Non indicato"} muted={!property.address} />
                  </dl>
                </section>
              </div>

              <footer className={styles.recordFooter}>
                <span className="inline-flex items-center gap-1"><MapPin aria-hidden="true" className="size-3.5" /> {property.zone?.name || property.municipality || "Zona non indicata"}</span>
                <span>{featureCount} dotazioni</span>
                {property.created_at ? <span className="inline-flex items-center gap-1"><CalendarDays aria-hidden="true" className="size-3.5" /> {new Date(property.created_at).toLocaleDateString("it-IT")}</span> : null}
                <span className={styles.recordAction}>Apri scheda <ArrowUpRight aria-hidden="true" className="size-4" /></span>
              </footer>
            </Link>
          );
        })}
      </div>

      {!properties.length ? (
        <div className={styles.emptyState}>
          <div>
            <Building2 aria-hidden="true" className="mx-auto size-6 text-[var(--surface-accent)]" />
            <h2 className="mt-4 font-semibold text-[var(--ink-strong)]">Nessun immobile in portafoglio</h2>
            <p className="mt-2 text-sm">Aggiungi il primo immobile per attivare il confronto con le richieste.</p>
            <div className="mt-5"><PropertyEditor zones={zones} features={features} /></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, note }: Readonly<{ label: string; value: number; note: string }>) {
  return <div className={styles.metric}><dt className={styles.label}>{label}</dt><dd className={styles.metricValue}>{value}</dd><dd className={styles.metricNote}>{note}</dd></div>;
}

function Field({ label, value, muted = false }: Readonly<{ label: string; value: string; muted?: boolean }>) {
  return <div className={styles.fieldRow}><dt className={styles.label}>{label}</dt><dd className={`${styles.fieldValue} ${muted ? styles.fieldMuted : ""}`}>{value}</dd></div>;
}

function PropertyHighlight({ label, value, muted = false, emphasized = false }: Readonly<{ label: string; value: string; muted?: boolean; emphasized?: boolean }>) {
  return <div className={`${styles.propertyHighlight} ${emphasized ? styles.propertyHighlightState : ""}`}><dt>{label}</dt><dd className={muted ? styles.fieldMuted : ""}>{value}</dd></div>;
}

function numberValue(value: number | null) { return value === null ? "Non indicato" : String(value); }

function propertyTypeLabel(value: string) {
  return ({ apartment: "Appartamento", independent_house: "Casa indipendente", villa: "Villa", townhouse: "Villetta", penthouse: "Attico", ground_floor: "Piano terra", entire_building: "Intero stabile", commercial_space: "Locale commerciale", office: "Ufficio", warehouse: "Deposito / magazzino", garage: "Garage / box", land: "Terreno", other: "Altra tipologia" }[value] ?? value);
}

function mandateLabel(status: string) {
  return ({ draft: "Bozza", active: "Disponibile", suspended: "Sospeso", expired: "Scaduto", sold: "Venduto", rented: "Affittato", archived: "Archiviato" }[status] ?? status);
}

function availabilityLabel(value: string | null) {
  return ({ available_now: "Subito", available_at_deed: "Al rogito", occupied: "Occupato", rented: "Locato", future_availability: "Futura" }[value ?? ""] ?? "Non indicata");
}
