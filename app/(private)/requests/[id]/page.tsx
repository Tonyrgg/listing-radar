import {
  Bath,
  BedDouble,
  Clock3,
  Layers3,
  MapPin,
  MessageSquareText,
  Ruler,
  SlidersHorizontal,
  UserRound,
  WalletCards,
} from "lucide-react";
import { notFound } from "next/navigation";

import { MatchCard } from "@/components/matching/match-card";
import {
  RecalculateButton,
  RequestControls,
} from "@/components/matching/management-panels";
import {
  ContractMark,
  FeatureMark,
  PropertyTypeMark,
  VisualFact,
} from "@/components/matching/visual-language";
import { PageHeader } from "@/components/page-header";
import { getRequest, listClients } from "@/lib/matching/repository";
import type {
  MatchClassification,
  MatchStatus,
} from "@/lib/matching/types";

export default async function RequestDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const [detail, clients] = await Promise.all([
    getRequest(id),
    listClients(),
  ]);
  if (!detail) notFound();
  const request = detail.request;
  const budget =
    request.contract_type === "sale"
      ? request.budget_max
      : request.monthly_rent_max;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Ricerca cliente"
        title={request.title || "Richiesta senza titolo"}
        description={
          request.clients?.full_name ||
          "Cliente non ancora collegato, la richiesta resta utilizzabile"
        }
        backHref="/requests"
        backLabel="Torna alle richieste"
        actions={<RecalculateButton scope="request" id={id} />}
      />

      <section className="overflow-hidden rounded-[11px] border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,.55fr)]">
          <div className="p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <ContractMark type={request.contract_type} />
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-soft)]">
                  <UserRound aria-hidden="true" className="size-4" />
                  {request.clients?.full_name || "Cliente da collegare"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {request.property_types.map((type: string) => (
                    <PropertyTypeMark key={type} type={type} />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-7 flex items-center gap-3 border-y border-[var(--line-soft)] py-5">
              <span className="grid size-11 place-items-center rounded-[8px] bg-[var(--surface-muted)] text-[var(--surface-accent)]">
                <WalletCards aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.11em] text-[var(--ink-subtle)]">
                  {request.contract_type === "sale"
                    ? "Budget massimo"
                    : "Canone massimo"}
                </p>
                <p className="mt-1 text-2xl font-bold text-[var(--ink-strong)]">
                  {budget
                    ? `€ ${Number(budget).toLocaleString("it-IT")}`
                    : "Da definire"}
                  {budget && request.contract_type === "rent" ? (
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
                  request.internal_sqm_min
                    ? `${request.internal_sqm_min}${request.internal_sqm_max ? `–${request.internal_sqm_max}` : "+"} mq`
                    : "Flessibile"
                }
              />
              <VisualFact
                icon={Layers3}
                label="Vani"
                value={
                  request.rooms_min
                    ? `${request.rooms_min}+`
                    : "Non indicati"
                }
              />
              <VisualFact
                icon={BedDouble}
                label="Camere"
                value={
                  request.bedrooms_min
                    ? `${request.bedrooms_min}+`
                    : "Non indicate"
                }
              />
              <VisualFact
                icon={Bath}
                label="Bagni"
                value={
                  request.bathrooms_min
                    ? `${request.bathrooms_min}+`
                    : "Non indicati"
                }
              />
            </div>
          </div>

          <aside className="border-t border-[var(--line-soft)] bg-[var(--surface-muted)] p-5 lg:border-l lg:border-t-0 lg:p-6">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-[var(--ink-subtle)]">
              <MapPin aria-hidden="true" className="size-4" />
              Dove cerca
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {detail.zones.length ? (
                detail.zones.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex min-h-10 items-center gap-2 rounded-[8px] border border-[var(--line-strong)] bg-[var(--surface-panel)] px-3 text-sm font-semibold text-[var(--ink-strong)]"
                  >
                    <MapPin
                      aria-hidden="true"
                      className="size-4 text-[var(--surface-accent)]"
                    />
                    {item.zone?.name ?? "Zona"}
                  </span>
                ))
              ) : (
                <p className="text-sm leading-6 text-[var(--ink-soft)]">
                  Nessuna zona specifica, considera tutta Bitonto.
                </p>
              )}
            </div>

            {request.notes ? (
              <div className="mt-6 border-t border-[var(--line-soft)] pt-5">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.1em] text-[var(--ink-subtle)]">
                  <MessageSquareText aria-hidden="true" className="size-4" />
                  Nota utile
                </p>
                <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
                  {request.notes}
                </p>
              </div>
            ) : null}
          </aside>
        </div>
      </section>

      <RequestControls
        id={id}
        status={request.status}
        clients={clients}
        clientId={request.client_id}
      />

      <section>
        <div className="mb-3">
          <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[var(--surface-accent)]">
            Cosa conta per il cliente
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">
            Caratteristiche richieste
          </h2>
        </div>
        {detail.features.length ? (
          <div className="flex flex-wrap gap-3">
            {detail.features.map((item) => (
              <div
                key={item.id}
                className="flex min-h-14 items-center gap-3 rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)] px-3"
              >
                <FeatureMark
                  featureKey={item.feature?.key ?? "feature"}
                  label={item.feature?.label ?? "Caratteristica"}
                />
                <div>
                  <p className="text-sm font-semibold text-[var(--ink-strong)]">
                    {item.feature?.label ?? "Caratteristica"}
                  </p>
                  <p className="text-[11px] text-[var(--ink-subtle)]">
                    {preferenceLabel(item.preference_level)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-24 items-center gap-3 rounded-[9px] border border-dashed border-[var(--line-strong)] px-4 text-sm text-[var(--ink-soft)]">
            <SlidersHorizontal className="size-4" />
            Nessuna caratteristica specifica: il confronto userà budget, spazi
            e zona.
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[var(--surface-accent)]">
              Proposte
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">
              Immobili ordinati per affinità
            </h2>
          </div>
          <span className="text-sm text-[var(--ink-subtle)]">
            {detail.matches.length} risultati
          </span>
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
              counterpartHref={`/portfolio/${match.property_id}`}
              counterpartTitle={match.property?.title ?? "Immobile"}
            />
          ))}
          {!detail.matches.length ? (
            <p className="rounded-[9px] border border-dashed border-[var(--line-strong)] p-8 text-center text-sm text-[var(--ink-soft)]">
              Nessun confronto disponibile. Inserisci un immobile attivo e
              premi “Ricalcola match”.
            </p>
          ) : null}
        </div>
      </section>

      <details className="rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)]">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold text-[var(--ink-soft)]">
          <Clock3 className="size-4" />
          Cronologia della richiesta
        </summary>
        <div className="divide-y divide-[var(--line-soft)] border-t border-[var(--line-soft)] px-4">
          {detail.logs.map((log) => (
            <div
              key={log.id}
              className="flex justify-between gap-4 py-3 text-sm"
            >
              <span className="text-[var(--ink-soft)]">
                {String(log.action).replaceAll("_", " ")}
              </span>
              <time className="text-xs text-[var(--ink-subtle)]">
                {new Date(log.created_at).toLocaleString("it-IT")}
              </time>
            </div>
          ))}
          {!detail.logs.length ? (
            <p className="py-4 text-sm text-[var(--ink-subtle)]">
              Nessuna modifica registrata.
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function preferenceLabel(value: string) {
  return (
    {
      required: "Indispensabile",
      preferred: "Sarebbe utile",
      indifferent: "Non importante",
      avoid: "Da evitare",
    }[value] ?? value
  );
}
