import {
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  Flame,
  Layers3,
  MapPin,
  Ruler,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

import { MatchingSectionNav } from "@/components/matching/section-nav";
import { QuickRequestButton } from "@/components/matching/quick-request";
import {
  ContractMark,
  PropertyTypeMark,
  VisualFact,
} from "@/components/matching/visual-language";
import { PageHeader } from "@/components/page-header";
import { listMatches, listRequests } from "@/lib/matching/repository";

export default async function RequestsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const filters = await searchParams;
  const [requests, matches] = await Promise.all([listRequests(), listMatches()]);
  const status = typeof filters.status === "string" ? filters.status : "";
  const contract = typeof filters.contract === "string" ? filters.contract : "";
  const priority = typeof filters.priority === "string" ? filters.priority : "";
  const client = typeof filters.client === "string" ? filters.client : "";
  const filteredRequests = requests.filter(
    (request) =>
      (!status || request.status === status) &&
      (!contract || request.contract_type === contract) &&
      (!priority || request.priority === priority) &&
      (!client ||
        (client === "anonymous"
          ? !request.client_id
          : Boolean(request.client_id))),
  );

  const compatibleCounts = new Map<string, number>();
  for (const match of matches) {
    if (match.classification !== "compatible") continue;
    compatibleCounts.set(
      match.request_id,
      (compatibleCounts.get(match.request_id) ?? 0) + 1,
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Clienti e immobili"
        title="Cosa cercano i clienti"
        description="Ogni scheda riassume una ricerca reale: cosa vuole il cliente, quanto può spendere e quali immobili puoi già proporgli."
        actions={<QuickRequestButton />}
      />
      <MatchingSectionNav />

      {requests.length ? (
        <details className="rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 text-sm font-semibold text-[var(--ink-soft)] hover:text-[var(--ink-strong)]">
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            Filtra le richieste
          </summary>
          <form className="grid gap-2 border-t border-[var(--line-soft)] p-3 sm:grid-cols-4">
            <Filter
              name="status"
              label="Tutti gli stati"
              value={status}
              options={[
                ["draft", "Bozza"],
                ["active", "Attiva"],
                ["urgent", "Urgente"],
                ["suspended", "Sospesa"],
                ["satisfied", "Soddisfatta"],
                ["archived", "Archiviata"],
              ]}
            />
            <Filter
              name="contract"
              label="Acquisto e affitto"
              value={contract}
              options={[
                ["sale", "Acquisto"],
                ["rent", "Affitto"],
              ]}
            />
            <Filter
              name="priority"
              label="Tutte le priorità"
              value={priority}
              options={[
                ["low", "Senza fretta"],
                ["normal", "Normale"],
                ["high", "Importante"],
                ["urgent", "Urgente"],
              ]}
            />
            <div className="flex gap-2">
              <Filter
                name="client"
                label="Tutti i clienti"
                value={client}
                options={[
                  ["anonymous", "Anonime"],
                  ["linked", "Con cliente"],
                ]}
              />
              <button className="min-h-11 rounded-[7px] bg-[var(--surface-accent)] px-4 text-xs font-bold text-[var(--button-ink)]">
                Applica
              </button>
            </div>
          </form>
        </details>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">
        {filteredRequests.map((request) => {
          const compatible = compatibleCounts.get(request.id) ?? 0;
          const budget =
            request.contract_type === "sale"
              ? request.budget_max
              : request.monthly_rent_max;
          const zoneNames = (request.request_zones ?? [])
            .map((item) => item.zone?.name)
            .filter((value): value is string => Boolean(value));

          return (
            <Link
              key={request.id}
              href={`/requests/${request.id}`}
              className="group/request relative overflow-hidden rounded-[11px] border border-[var(--line-soft)] bg-[var(--surface-panel)] transition-colors hover:border-[var(--line-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--surface-accent)]"
            >
              <div className="flex items-start gap-4 px-5 pb-4 pt-5">
                <ContractMark type={request.contract_type} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-soft)]">
                        <UserRound aria-hidden="true" className="size-3.5" />
                        {request.clients?.full_name || "Cliente da collegare"}
                      </p>
                      <h2 className="mt-1 truncate text-lg font-semibold text-[var(--ink-strong)]">
                        {request.title || "Richiesta senza titolo"}
                      </h2>
                    </div>
                    <span className="inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border border-[var(--line-soft)] bg-[var(--surface-muted)] px-2.5 text-[11px] font-bold text-[var(--ink-soft)]">
                      <CircleDot aria-hidden="true" className="size-3" />
                      {statusLabel(request.status)}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {request.property_types.map((type) => (
                      <PropertyTypeMark key={type} type={type} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 border-y border-[var(--line-soft)] bg-[oklch(0.155_0.01_155)] px-5 py-4 sm:grid-cols-3">
                <VisualFact
                  icon={WalletCards}
                  label={
                    request.contract_type === "sale"
                      ? "Budget massimo"
                      : "Canone massimo"
                  }
                  value={
                    budget
                      ? `€ ${Number(budget).toLocaleString("it-IT")}${request.contract_type === "rent" ? "/mese" : ""}`
                      : "Da definire"
                  }
                  prominent
                />
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
                      ? `${request.rooms_min}+ vani`
                      : "Non indicati"
                  }
                />
              </div>

              <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    title={`Priorità: ${priorityLabel(request.priority)}`}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-[7px] border border-[var(--line-soft)] px-2.5 text-xs font-semibold text-[var(--ink-soft)]"
                  >
                    <Flame
                      aria-hidden="true"
                      className={`size-3.5 ${request.priority === "urgent" ? "text-[var(--status-warning)]" : "text-[var(--ink-subtle)]"}`}
                    />
                    {priorityLabel(request.priority)}
                  </span>
                  {zoneNames.slice(0, 2).map((zone) => (
                    <span
                      key={zone}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-[7px] border border-[var(--line-soft)] px-2.5 text-xs font-semibold text-[var(--ink-soft)]"
                    >
                      <MapPin aria-hidden="true" className="size-3.5" />
                      {zone}
                    </span>
                  ))}
                  {!zoneNames.length ? (
                    <span className="inline-flex min-h-8 items-center gap-1.5 text-xs text-[var(--ink-subtle)]">
                      <MapPin aria-hidden="true" className="size-3.5" />
                      Tutta Bitonto
                    </span>
                  ) : null}
                  {request.created_at ? (
                    <span
                      title={`Creata il ${new Date(request.created_at).toLocaleDateString("it-IT")}`}
                      className="inline-flex min-h-8 items-center gap-1.5 text-xs text-[var(--ink-subtle)]"
                    >
                      <Clock3 aria-hidden="true" className="size-3.5" />
                      {new Date(request.created_at).toLocaleDateString("it-IT")}
                    </span>
                  ) : null}
                </div>

                <span
                  className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-[8px] px-3 text-sm font-bold ${
                    compatible
                      ? "bg-[oklch(0.23_0.035_145)] text-[var(--surface-accent)]"
                      : "bg-[var(--surface-muted)] text-[var(--ink-subtle)]"
                  }`}
                >
                  <CheckCircle2 aria-hidden="true" className="size-4" />
                  {compatible
                    ? `${compatible} ${compatible === 1 ? "compatibile" : "compatibili"}`
                    : "Nessun compatibile"}
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-4 transition-transform group-hover/request:translate-x-0.5 group-hover/request:-translate-y-0.5"
                  />
                </span>
              </div>
            </Link>
          );
        })}

        {!filteredRequests.length ? (
          <div className="col-span-full grid min-h-72 place-items-center rounded-[11px] border border-dashed border-[var(--line-strong)] bg-[var(--surface-panel)] p-8 text-center">
            <div className="max-w-md">
              <span className="mx-auto grid size-12 place-items-center rounded-[9px] bg-[var(--surface-muted)] text-[var(--surface-accent)]">
                {requests.length ? (
                  <SlidersHorizontal className="size-5" />
                ) : (
                  <UsersRound className="size-5" />
                )}
              </span>
              <h2 className="mt-4 text-lg font-semibold text-[var(--ink-strong)]">
                {requests.length
                  ? "Nessuna richiesta con questi filtri"
                  : "Inizia dalla prima telefonata"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                {requests.length
                  ? "Modifica i filtri per rivedere tutte le richieste."
                  : "Registra cosa cerca il cliente. Il nome può essere aggiunto anche in seguito."}
              </p>
              {!requests.length ? (
                <div className="mt-5">
                  <QuickRequestButton />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Filter({
  name,
  label,
  value,
  options,
}: Readonly<{
  name: string;
  label: string;
  value: string;
  options: [string, string][];
}>) {
  return (
    <select
      name={name}
      defaultValue={value}
      aria-label={label}
      className="h-11 min-w-0 flex-1 rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] px-3 text-xs font-semibold text-[var(--ink-soft)]"
    >
      <option value="">{label}</option>
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue}>
          {optionLabel}
        </option>
      ))}
    </select>
  );
}

function statusLabel(status: string) {
  return (
    {
      draft: "Bozza",
      active: "Attiva",
      urgent: "Urgente",
      suspended: "Sospesa",
      satisfied: "Soddisfatta",
      cancelled: "Annullata",
      archived: "Archiviata",
    }[status] ?? status
  );
}

function priorityLabel(priority: string) {
  return (
    {
      low: "Senza fretta",
      normal: "Normale",
      high: "Importante",
      urgent: "Urgente",
    }[priority] ?? priority
  );
}
