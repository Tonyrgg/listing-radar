import {
  Bath,
  BedDouble,
  Building2,
  CalendarCheck2,
  CircleDot,
  Layers3,
  MapPin,
  Ruler,
  WalletCards,
} from "lucide-react";
import { notFound } from "next/navigation";

import { MatchCard } from "@/components/matching/match-card";
import {
  DeletePropertyButton,
  PropertyEditor,
  RecalculateButton,
} from "@/components/matching/management-panels";
import {
  ContractMark,
  FeatureMark,
  PropertyTypeMark,
  VisualFact,
} from "@/components/matching/visual-language";
import { PageHeader } from "@/components/page-header";
import {
  getProperty,
  listFeatures,
  listZones,
} from "@/lib/matching/repository";
import type {
  MatchClassification,
  MatchStatus,
  PortfolioProperty,
} from "@/lib/matching/types";

export default async function PropertyDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const [detail, zones, features] = await Promise.all([
    getProperty(id),
    listZones(),
    listFeatures(),
  ]);
  if (!detail) notFound();
  const property = detail.property;
  const featureValues = Object.fromEntries(
    detail.features.map((item) => [item.feature_definition_id, item.value]),
  );
  const price =
    property.contract_type === "sale"
      ? property.price
      : property.monthly_rent;
  const activeFeatures = detail.features.filter((item) => Boolean(item.value));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Immobile disponibile"
        title={property.title}
        description={
          property.address ||
          property.municipality ||
          "Indirizzo non indicato"
        }
        backHref="/portfolio"
        backLabel="Torna agli immobili"
        actions={
          <div className="flex flex-wrap gap-2">
            <PropertyEditor
              zones={zones}
              features={features}
              property={{
                ...(property as PortfolioProperty),
                feature_values: featureValues,
              }}
            />
            <RecalculateButton scope="property" id={id} />
            <DeletePropertyButton id={id} />
          </div>
        }
      />

      <section className="overflow-hidden rounded-[11px] border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,.6fr)]">
          <div className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-5">
              <div className="flex items-start gap-4">
                <ContractMark type={property.contract_type} />
                <div>
                  <PropertyTypeMark type={property.property_type} />
                  <p className="mt-3 flex items-center gap-2 text-sm text-[var(--ink-soft)]">
                    <MapPin aria-hidden="true" className="size-4" />
                    {property.zone?.name ||
                      property.address ||
                      property.municipality ||
                      "Zona da completare"}
                  </p>
                </div>
              </div>
              <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[var(--line-soft)] bg-[var(--surface-muted)] px-3 text-xs font-bold text-[var(--ink-soft)]">
                <CircleDot aria-hidden="true" className="size-3.5" />
                {mandateLabel(property.mandate_status)}
              </span>
            </div>

            <div className="mt-7 flex items-center gap-3 border-y border-[var(--line-soft)] py-5">
              <span className="grid size-11 place-items-center rounded-[8px] bg-[var(--surface-muted)] text-[var(--surface-accent)]">
                <WalletCards aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.11em] text-[var(--ink-subtle)]">
                  {property.contract_type === "sale"
                    ? "Prezzo richiesto"
                    : "Canone mensile"}
                </p>
                <p className="mt-1 text-2xl font-bold text-[var(--ink-strong)]">
                  {price
                    ? `€ ${Number(price).toLocaleString("it-IT")}`
                    : "Da definire"}
                  {price && property.contract_type === "rent" ? (
                    <span className="ml-1 text-sm font-medium text-[var(--ink-soft)]">
                      /mese
                    </span>
                  ) : null}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <VisualFact
                icon={Ruler}
                label="Metratura"
                value={
                  property.internal_sqm
                    ? `${property.internal_sqm} mq`
                    : "Da completare"
                }
              />
              <VisualFact
                icon={Layers3}
                label="Vani"
                value={property.rooms ?? "Da completare"}
              />
              <VisualFact
                icon={BedDouble}
                label="Camere"
                value={property.bedrooms ?? "Da completare"}
              />
              <VisualFact
                icon={Bath}
                label="Bagni"
                value={property.bathrooms ?? "Da completare"}
              />
            </div>
          </div>

          <aside className="border-t border-[var(--line-soft)] bg-[oklch(0.155_0.012_155)] p-5 lg:border-l lg:border-t-0 lg:p-6">
            <Building2
              aria-hidden="true"
              className="size-20 text-[oklch(0.38_0.024_155)]"
              strokeWidth={0.9}
            />
            <h2 className="mt-5 font-semibold text-[var(--ink-strong)]">
              Disponibilità
            </h2>
            <p className="mt-2 flex items-center gap-2 text-sm text-[var(--ink-soft)]">
              <CalendarCheck2
                aria-hidden="true"
                className="size-4 text-[var(--surface-accent)]"
              />
              {availabilityLabel(property.availability_status)}
            </p>
            {property.description ? (
              <p className="mt-5 border-t border-[var(--line-soft)] pt-5 text-sm leading-6 text-[var(--ink-soft)]">
                {property.description}
              </p>
            ) : null}
          </aside>
        </div>
      </section>

      <section>
        <div className="mb-3">
          <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[var(--surface-accent)]">
            Dotazioni
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">
            Cosa offre l’immobile
          </h2>
        </div>
        {activeFeatures.length ? (
          <div className="flex flex-wrap gap-3">
            {activeFeatures.map((item) => (
              <div
                key={item.id}
                className="flex min-h-14 items-center gap-3 rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)] px-3"
              >
                <FeatureMark
                  featureKey={item.feature?.key ?? "feature"}
                  label={item.feature?.label ?? "Caratteristica"}
                />
                <span className="text-sm font-semibold text-[var(--ink-strong)]">
                  {item.feature?.label ?? "Caratteristica"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-[9px] border border-dashed border-[var(--line-strong)] p-6 text-sm text-[var(--ink-soft)]">
            Nessuna dotazione indicata. Usa “Modifica immobile” per completare
            la scheda.
          </p>
        )}
      </section>

      <section>
        <div className="mb-3">
          <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[var(--surface-accent)]">
            Clienti possibili
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">
            A chi puoi proporlo
          </h2>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {detail.matches.map((match) => (
            <MatchCard
              key={match.id}
              match={{
                ...match,
                classification:
                  match.classification as MatchClassification,
                status: match.status as MatchStatus,
              }}
              counterpartHref={`/requests/${match.request_id}`}
              counterpartTitle={`${match.request?.clients?.full_name || "Cliente da collegare"}: ${match.request?.title || "Richiesta"}`}
            />
          ))}
          {!detail.matches.length ? (
            <p className="rounded-[9px] border border-dashed border-[var(--line-strong)] p-8 text-center text-sm text-[var(--ink-soft)]">
              Nessuna richiesta confrontata con questo immobile.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function mandateLabel(status: string) {
  return (
    {
      draft: "Bozza",
      active: "Disponibile",
      suspended: "Sospeso",
      expired: "Scaduto",
      sold: "Venduto",
      rented: "Affittato",
      archived: "Archiviato",
    }[status] ?? status
  );
}

function availabilityLabel(value: string | null) {
  if (!value) return "Da indicare";
  return (
    {
      available_now: "Disponibile subito",
      available_at_deed: "Disponibile al rogito",
      occupied: "Attualmente occupato",
      rented: "Attualmente locato",
      future_availability: "Disponibilità futura",
    }[value] ?? value
  );
}
