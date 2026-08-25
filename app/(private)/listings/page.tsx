import { Building2, Search, UserRound, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AutoSubmitFiltersForm } from "@/components/auto-submit-filters-form";
import { PageHeader } from "@/components/page-header";
import { PropertyRow, signalsFromOpportunity, type PropertyRowSignals } from "@/components/property-row";
import { Card, Chip, EmptyState, Meta, buttonClass } from "@/components/ui/primitives";
import type { Livello } from "@/components/ui/atoms";
import { readNow } from "@/lib/clock";
import { signPropertyPhotos } from "@/lib/lifecycle-photos";
import { loadLifecycleView } from "@/lib/property-lifecycle/read-models/server";
import type { LifecyclePropertySummary } from "@/lib/property-lifecycle/read-models/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Immobili" };

type Chi = "tutti" | "privato" | "agenzia";
type Stato = "attivi" | "usciti" | "tutti";

function param(value: string | string[] | undefined, fallback: string) {
  return (Array.isArray(value) ? value[0] : value) ?? fallback;
}

function giorniDaVendita(property: LifecyclePropertySummary, now: number) {
  const from = property.trueMarketStartLowerBound;
  if (!from) return 0;

  const inizio = new Date(from).getTime();
  if (Number.isNaN(inizio)) return 0;

  return Math.max(0, Math.floor((now - inizio) / (24 * 60 * 60 * 1000)));
}

function testoCercabile(property: LifecyclePropertySummary) {
  return [
    property.address,
    property.title,
    property.locality,
    property.propertyType,
    ...property.agencies.map((agency) => agency.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("it");
}

export default async function ImmobiliPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();

  const query = await searchParams;
  const cerca = param(query.q, "").trim().toLocaleLowerCase("it");
  const chi = param(query.chi, "tutti") as Chi;
  const stato = param(query.stato, "attivi") as Stato;
  const fermeDa = Number(param(query.ferme, "0")) || 0;

  const [vista, now] = await Promise.all([
    loadLifecycleView(async (repository) => ({
      proprieta: await repository.archive(),
      opportunita: await repository.opportunities(),
    })),
    readNow(),
  ]);

  if (!vista.available || !vista.data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Immobili" title="Archivio" />
        <Card>
          <EmptyState
            title="L'archivio non è raggiungibile"
            description="Questa pagina lavora sull'archivio dei segnali, che al momento non risponde."
          />
        </Card>
      </div>
    );
  }

  const segnaliPerProprieta = new Map<string, PropertyRowSignals>();
  for (const opportunita of vista.data.opportunita) {
    if (segnaliPerProprieta.has(opportunita.propertyId)) continue;

    segnaliPerProprieta.set(opportunita.propertyId, signalsFromOpportunity(opportunita));
  }

  const tutte = vista.data.proprieta;
  const filtrate = tutte.filter((property) => {
    if (cerca && !testoCercabile(property).includes(cerca)) return false;

    if (chi === "privato" && property.activePrivateCount === 0) return false;
    if (chi === "agenzia" && property.agencies.length === 0) return false;

    const attiva = property.propertyState.startsWith("ACTIVE");
    if (stato === "attivi" && !attiva) return false;
    if (stato === "usciti" && attiva) return false;

    if (fermeDa && giorniDaVendita(property, now) < fermeDa) return false;

    return true;
  });

  /* Prima quelle che hanno qualcosa da dire, poi le più fresche: senza un
   * ordine così le prime sessanta righe sono sessanta righe qualsiasi. */
  const peso: Record<Livello, number> = { alta: 2, media: 1, bassa: 0 };
  const ordinate = [...filtrate].sort((a, b) => {
    const pesoA = peso[segnaliPerProprieta.get(a.id)?.livello ?? "bassa"];
    const pesoB = peso[segnaliPerProprieta.get(b.id)?.livello ?? "bassa"];
    if (pesoA !== pesoB) return pesoB - pesoA;

    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });

  const visibili = ordinate.slice(0, 60);
  const foto = await signPropertyPhotos(visibili);
  const filtriAttivi = Boolean(cerca) || chi !== "tutti" || stato !== "attivi" || fermeDa > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Immobili"
        title="Archivio"
        description="Ogni casa osservata sul mercato, con la sua storia e chi la vende adesso."
        actions={
          <Chip tone="neutral">
            {filtrate.length === tutte.length
              ? `${tutte.length} proprietà`
              : `${filtrate.length} di ${tutte.length}`}
          </Chip>
        }
      />

      {/* Ricerca e filtri: pochi, sempre nello stesso posto. */}
      <AutoSubmitFiltersForm className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--lr-ink-3)]"
          />
          <span className="sr-only">Cerca fra le proprietà</span>
          <input
            type="search"
            name="q"
            defaultValue={param(query.q, "")}
            placeholder="via, zona, agenzia…"
            className="min-h-11 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] pl-9 pr-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none"
          />
        </label>

        <label className="min-w-40">
          <span className="sr-only">Chi vende</span>
          <select
            name="chi"
            defaultValue={chi}
            className="min-h-11 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none"
          >
            <option value="tutti">Chiunque venda</option>
            <option value="privato">Solo privati</option>
            <option value="agenzia">Solo agenzie</option>
          </select>
        </label>

        <label className="min-w-40">
          <span className="sr-only">Stato</span>
          <select
            name="stato"
            defaultValue={stato}
            className="min-h-11 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none"
          >
            <option value="attivi">Ancora sul mercato</option>
            <option value="usciti">Uscite dal mercato</option>
            <option value="tutti">Tutte</option>
          </select>
        </label>

        <label className="min-w-40">
          <span className="sr-only">In vendita da</span>
          <select
            name="ferme"
            defaultValue={String(fermeDa)}
            className="min-h-11 w-full rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3 text-[length:var(--lr-text-body)] text-[var(--lr-ink)] outline-none"
          >
            <option value="0">Da quanto vuoi</option>
            <option value="60">Da oltre 2 mesi</option>
            <option value="150">Da oltre 5 mesi</option>
            <option value="365">Da oltre un anno</option>
          </select>
        </label>

        {filtriAttivi ? (
          <Link href="/listings" className={buttonClass("quiet", { compact: true })}>
            <X aria-hidden="true" className="size-4" />
            Azzera
          </Link>
        ) : null}
      </AutoSubmitFiltersForm>

      <Card>
        {visibili.length ? (
          <div>
            {visibili.map((property) => (
              <PropertyRow
                key={property.id}
                property={property}
                foto={foto.get(property.id)}
                signals={segnaliPerProprieta.get(property.id)}
                now={now}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nessuna proprietà con questi filtri"
            description="Prova ad allargare la ricerca: potrebbero esserci case escluse da un filtro attivo."
            action={
              <Link href="/listings" className={buttonClass("primary", { compact: true })}>
                Mostra tutto l&apos;archivio
              </Link>
            }
          />
        )}
      </Card>

      {filtrate.length > visibili.length ? (
        <Meta className="px-1">
          Ne vedi {visibili.length} di {filtrate.length}: restringi la ricerca per arrivare alle
          altre.
        </Meta>
      ) : null}

      <Meta className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
        <span className="inline-flex items-center gap-1.5">
          <UserRound aria-hidden="true" className="size-3.5 text-[var(--lr-warn)]" /> venduta da un
          privato
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Building2 aria-hidden="true" className="size-3.5" /> tenuta da un&apos;agenzia
        </span>
        <span>Il testo tratteggiato è dedotto, non dichiarato dalla fonte.</span>
      </Meta>
    </div>
  );
}
