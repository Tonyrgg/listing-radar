import { Search, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AutoSubmitFiltersForm } from "@/components/auto-submit-filters-form";
import { PropertyEditor } from "@/components/matching/management-panels";
import { PortfolioRow } from "@/components/matching/portfolio-row";
import { MatchingSectionHeader } from "@/components/matching/section-header";
import { ProgressiveList } from "@/components/progressive-list";
import { Card, Chip, EmptyState, Meta, buttonClass } from "@/components/ui/primitives";
import { formatNumber } from "@/lib/formatting";
import { propertyConditionLabel } from "@/lib/matching/property-presentation";
import { listFeatures, listProperties, listZones } from "@/lib/matching/repository";

export const metadata: Metadata = { title: "Le case che abbiamo noi" };

/**
 * Il portafoglio.
 *
 * Ogni immobile era due tabelle affiancate di cinque righe — tipologia, locali,
 * camere, bagni, piano · incarico, disponibilità, comune, indirizzo — e la
 * maggior parte diceva «Non indicato». Dieci righe per scoprire che di quella
 * casa sappiamo il prezzo e poco altro.
 *
 * Il portafoglio ha le foto, e non ne mostrava nemmeno una.
 */

const STATI_INCARICO: Record<string, string> = {
  draft: "Bozza",
  active: "La possiamo proporre",
  suspended: "Sospeso",
  expired: "Scaduto",
  sold: "Venduta",
  rented: "Affittata",
  archived: "Archiviata",
};

const TIPI: Record<string, string> = {
  apartment: "Appartamento",
  independent_house: "Casa indipendente",
  villa: "Villa",
  townhouse: "Villetta",
  penthouse: "Attico",
  ground_floor: "Piano terra",
  entire_building: "Intero stabile",
  commercial_space: "Locale commerciale",
  office: "Ufficio",
  warehouse: "Deposito o magazzino",
  garage: "Garage o box",
  land: "Terreno",
  other: "Altro",
};

function param(input: string | string[] | undefined) {
  return typeof input === "string" ? input : "";
}

export default async function PortafoglioPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const query = await searchParams;
  const cerca = param(query.q).trim().toLocaleLowerCase("it");
  const contratto = param(query.contract);
  const tipo = param(query.type);
  const zonaId = param(query.zone);
  const incarico = param(query.mandate);

  const [properties, zones, features] = await Promise.all([
    listProperties(),
    listZones(),
    listFeatures(),
  ]);

  const filtrate = properties.filter((property) => {
    const testo = [
      property.title,
      property.address,
      property.municipality,
      property.zone?.name,
      property.external_crm_id,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("it");

    return (
      (!cerca || testo.includes(cerca)) &&
      (!contratto || property.contract_type === contratto) &&
      (!tipo || property.property_type === tipo) &&
      (!zonaId || property.internal_zone_id === zonaId) &&
      (!incarico || property.mandate_status === incarico)
    );
  });

  const proponibili = properties.filter((item) => item.mandate_status === "active").length;
  const filtriAttivi = Boolean(cerca || contratto || tipo || zonaId || incarico);

  return (
    <div className="space-y-5">
      <MatchingSectionHeader
        eyebrow="Commerciale"
        title="Le case che abbiamo noi"
        description={`${formatNumber(properties.length)} immobili in portafoglio, di cui ${formatNumber(proponibili)} li possiamo proporre a un cliente adesso.`}
        actions={<PropertyEditor zones={zones} features={features} />}
      />

      <AutoSubmitFiltersForm className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--lr-ink-3)]"
          />
          <span className="sr-only">Cerca in portafoglio</span>
          <input
            type="search"
            name="q"
            defaultValue={param(query.q)}
            placeholder="via, zona, nome dell'incarico…"
            className="min-h-11 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] pl-9 pr-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none"
          />
        </label>

        <label className="min-w-44">
          <span className="sr-only">Vendita o affitto</span>
          <select
            name="contract"
            defaultValue={contratto}
            className="min-h-11 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none"
          >
            <option value="">In vendita e in affitto</option>
            <option value="sale">Solo in vendita</option>
            <option value="rent">Solo in affitto</option>
          </select>
        </label>

        <label className="min-w-44">
          <span className="sr-only">Tipo di immobile</span>
          <select
            name="type"
            defaultValue={tipo}
            className="min-h-11 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none"
          >
            <option value="">Di qualsiasi tipo</option>
            {[...new Set(properties.map((item) => item.property_type))].sort().map((item) => (
              <option value={item} key={item}>
                {TIPI[item] ?? item}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-44">
          <span className="sr-only">Zona</span>
          <select
            name="zone"
            defaultValue={zonaId}
            className="min-h-11 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none"
          >
            <option value="">In qualsiasi zona</option>
            {zones.map((zone) => (
              <option value={zone.id} key={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-44">
          <span className="sr-only">Stato dell&apos;incarico</span>
          <select
            name="mandate"
            defaultValue={incarico}
            className="min-h-11 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none"
          >
            <option value="">Con qualsiasi incarico</option>
            <option value="active">Che possiamo proporre</option>
            <option value="sold">Già vendute</option>
            <option value="rented">Già affittate</option>
            <option value="suspended">Sospese</option>
            <option value="archived">Archiviate</option>
          </select>
        </label>

        {filtriAttivi ? (
          <Link href="/portfolio" className={buttonClass("quiet", { compact: true })}>
            <X aria-hidden="true" className="size-4" />
            Azzera
          </Link>
        ) : null}
      </AutoSubmitFiltersForm>

      {filtrate.length ? (
        <Card>
          <ProgressiveList initialCount={12} step={12} noun="immobili">
            {filtrate.map((property) => (
              <PortfolioRow
                key={property.id}
                property={property}
                href={`/portfolio/${property.id}`}
                tono={property.mandate_status === "active" ? "action" : "neutral"}
                coda={
                  /* «La possiamo proporre» su tutte e settantotto le righe non
                   * distingue niente: si scrive solo quando c'è qualcosa che
                   * ferma la proposta. */
                  <span className="flex flex-col items-end gap-1">
                    {property.mandate_status === "active" ? null : (
                      <Chip tone="neutral">
                        {STATI_INCARICO[property.mandate_status] ?? property.mandate_status}
                      </Chip>
                    )}
                    {property.condition ? (
                      <Meta>{propertyConditionLabel(property.condition)}</Meta>
                    ) : null}
                  </span>
                }
              />
            ))}
          </ProgressiveList>
        </Card>
      ) : (
        <Card className="p-4">
          <EmptyState
            title={
              filtriAttivi ? "Nessuna casa con questi filtri" : "Non abbiamo ancora nessuna casa"
            }
            description={
              filtriAttivi
                ? "Prova ad allargare la ricerca: potrebbe esserci un immobile escluso da un filtro attivo."
                : "Il portafoglio si riempie dal gestionale, oppure aggiungendo il primo immobile da qui."
            }
            action={
              filtriAttivi ? (
                <Link href="/portfolio" className={buttonClass("primary", { compact: true })}>
                  Mostra tutte
                </Link>
              ) : (
                <PropertyEditor zones={zones} features={features} />
              )
            }
          />
        </Card>
      )}
    </div>
  );
}
