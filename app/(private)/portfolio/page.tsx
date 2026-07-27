import {
  ArrowUpRight,
  Bath,
  BedDouble,
  Building2,
  CircleDot,
  Layers3,
  MapPin,
  Ruler,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

import { PropertyEditor } from "@/components/matching/management-panels";
import { MatchingSectionNav } from "@/components/matching/section-nav";
import {
  ContractMark,
  FeatureMark,
  PropertyTypeMark,
} from "@/components/matching/visual-language";
import { PageHeader } from "@/components/page-header";
import {
  listFeatures,
  listProperties,
  listZones,
} from "@/lib/matching/repository";

export default async function PortfolioPage() {
  const [properties, zones, features] = await Promise.all([
    listProperties(),
    listZones(),
    listFeatures(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Clienti e immobili"
        title="Immobili da proporre"
        description="Uno showroom operativo degli immobili disponibili, con prezzo, spazi e dotazioni immediatamente riconoscibili."
        actions={<PropertyEditor zones={zones} features={features} />}
      />
      <MatchingSectionNav />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {properties.map((property, index) => {
          const availableFeatures = (property.property_feature_values ?? [])
            .filter((item) => Boolean(item.value) && item.feature)
            .slice(0, 7);
          const featured = index === 0 && properties.length > 2;
          const price =
            property.contract_type === "sale"
              ? property.price
              : property.monthly_rent;

          return (
            <Link
              key={property.id}
              href={`/portfolio/${property.id}`}
              className={`group/property overflow-hidden rounded-[11px] border border-[var(--line-soft)] bg-[var(--surface-panel)] transition-colors hover:border-[var(--line-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--surface-accent)] ${
                featured ? "md:col-span-2" : ""
              }`}
            >
              <div
                className={`relative flex items-start justify-between overflow-hidden border-b border-[var(--line-soft)] bg-[oklch(0.155_0.012_155)] p-5 ${
                  featured ? "min-h-40" : "min-h-32"
                }`}
              >
                <div className="relative z-10">
                  <ContractMark type={property.contract_type} />
                  <div className="mt-4">
                    <PropertyTypeMark type={property.property_type} />
                  </div>
                </div>
                <Building2
                  aria-hidden="true"
                  className={`absolute -bottom-5 -right-3 text-[oklch(0.28_0.018_155)] transition-transform duration-200 group-hover/property:-translate-x-1 ${
                    featured ? "size-44" : "size-36"
                  }`}
                  strokeWidth={0.8}
                />
                <span className="relative z-10 inline-flex min-h-7 items-center gap-1.5 rounded-full border border-[var(--line-soft)] bg-[var(--surface-panel)] px-2.5 text-[11px] font-bold text-[var(--ink-soft)]">
                  <CircleDot aria-hidden="true" className="size-3" />
                  {mandateLabel(property.mandate_status)}
                </span>
              </div>

              <div className="p-5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-subtle)]">
                  <MapPin aria-hidden="true" className="size-3.5" />
                  {property.zone?.name ||
                    property.address ||
                    property.municipality ||
                    "Zona da indicare"}
                </p>
                <h2 className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">
                  {property.title}
                </h2>
                {property.address && property.zone?.name ? (
                  <p className="mt-1 truncate text-sm text-[var(--ink-soft)]">
                    {property.address}
                  </p>
                ) : null}

                <div className="mt-5 flex items-center gap-3 border-y border-[var(--line-soft)] py-4">
                  <span className="grid size-9 place-items-center rounded-[7px] bg-[var(--surface-muted)] text-[var(--surface-accent)]">
                    <WalletCards aria-hidden="true" className="size-4" />
                  </span>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[var(--ink-subtle)]">
                      {property.contract_type === "sale"
                        ? "Prezzo richiesto"
                        : "Canone mensile"}
                    </p>
                    <p className="mt-0.5 text-xl font-bold text-[var(--ink-strong)]">
                      {price
                        ? `€ ${Number(price).toLocaleString("it-IT")}`
                        : "Da definire"}
                      {price && property.contract_type === "rent" ? (
                        <span className="ml-1 text-xs font-medium text-[var(--ink-soft)]">
                          /mese
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-4 gap-2">
                  <MiniFact
                    icon={Ruler}
                    value={property.internal_sqm ?? "—"}
                    label="mq"
                  />
                  <MiniFact
                    icon={Layers3}
                    value={property.rooms ?? "—"}
                    label="vani"
                  />
                  <MiniFact
                    icon={BedDouble}
                    value={property.bedrooms ?? "—"}
                    label="camere"
                  />
                  <MiniFact
                    icon={Bath}
                    value={property.bathrooms ?? "—"}
                    label="bagni"
                  />
                </div>

                <div className="mt-5 flex min-h-9 items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-1.5">
                    {availableFeatures.map((item) => (
                      <FeatureMark
                        key={item.feature!.key}
                        featureKey={item.feature!.key}
                        label={item.feature!.label}
                      />
                    ))}
                    {!availableFeatures.length ? (
                      <span className="text-xs text-[var(--ink-subtle)]">
                        Dotazioni da completare
                      </span>
                    ) : null}
                  </div>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-5 shrink-0 text-[var(--ink-subtle)] transition-transform group-hover/property:-translate-y-0.5 group-hover/property:translate-x-0.5 group-hover/property:text-[var(--surface-accent)]"
                  />
                </div>
              </div>
            </Link>
          );
        })}

        {!properties.length ? (
          <div className="col-span-full grid min-h-72 place-items-center rounded-[11px] border border-dashed border-[var(--line-strong)] bg-[var(--surface-panel)] p-8 text-center">
            <div className="max-w-md">
              <span className="mx-auto grid size-12 place-items-center rounded-[9px] bg-[var(--surface-muted)] text-[var(--surface-accent)]">
                <Building2 className="size-5" />
              </span>
              <h2 className="mt-4 text-lg font-semibold text-[var(--ink-strong)]">
                Lo showroom è ancora vuoto
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                Aggiungi il primo immobile disponibile. Verrà confrontato
                automaticamente con tutte le richieste attive.
              </p>
              <div className="mt-5">
                <PropertyEditor zones={zones} features={features} />
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function MiniFact({
  icon: Icon,
  value,
  label,
}: Readonly<{
  icon: typeof Ruler;
  value: string | number;
  label: string;
}>) {
  return (
    <div
      title={`${value} ${label}`}
      className="flex min-w-0 flex-col items-center justify-center rounded-[7px] bg-[var(--surface-muted)] px-2 py-2.5 text-center"
    >
      <Icon aria-hidden="true" className="size-4 text-[var(--ink-subtle)]" />
      <strong className="mt-1 text-sm text-[var(--ink-strong)]">{value}</strong>
      <span className="text-[9px] uppercase tracking-[.08em] text-[var(--ink-subtle)]">
        {label}
      </span>
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
