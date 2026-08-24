"use client";

import { clsx } from "clsx";
import { Clock, Flame, Pencil, Route, Shapes, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { formatDateTime } from "@/lib/formatting";
import {
  MAP_STATUS_LABELS,
  PIN_CATEGORY_LABELS,
  PIN_PRIORITY_COLORS,
  PIN_PRIORITY_LABELS,
  PIN_STATUS_LABELS,
} from "@/lib/map/constants";
import type {
  Agent,
  AreaStatus,
  MapActivityLog,
  MapArea,
  MapPin,
  MapStats,
  MapStatus,
  MapStreet,
  PinStatus,
  SelectedMapElement,
} from "@/lib/map/types";

type TabKey = "pins" | "areas" | "streets" | "activity";

function findAgent(agents: Agent[], id: string | null) {
  if (!id) return null;
  return agents.find((agent) => agent.id === id) ?? null;
}

function agentName(agents: Agent[], id: string | null) {
  return findAgent(agents, id)?.name ?? "Non assegnato";
}

function pinSuggestion(pin: MapPin) {
  if (pin.category === "sale_lead" && ["high", "urgent"].includes(pin.priority)) {
    return "Notizia vendita da verificare rapidamente.";
  }
  if (pin.category === "empty_house") {
    return "Casa vuota: utile chiedere a vicini/amministratore.";
  }
  if (pin.status === "follow_up") {
    return "Controllare la data di richiamo.";
  }
  if (pin.category === "useful_doorman") {
    return "Contatto utile per notizie di condominio.";
  }
  if (pin.category === "not_interested") {
    return "Non lavorare ora, eventualmente ripassare più avanti.";
  }
  return null;
}

function MiniStat({
  label,
  value,
  emphasis = false,
}: Readonly<{
  label: string;
  value: string | number;
  emphasis?: boolean;
}>) {
  return (
    <div className="min-w-0 rounded-[7px] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-2.5 py-2">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--lr-ink-3)]">
        {label}
      </p>
      <p
        className={clsx(
          "mt-1 text-base font-semibold leading-none",
          emphasis ? "text-[var(--lr-warn)]" : "text-[var(--lr-ink)]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function StatsStrip({ stats }: Readonly<{ stats: MapStats }>) {
  return (
    <div className="grid grid-cols-5 gap-2">
      <MiniStat label="Aree" value={`${stats.completedAreas}/${stats.totalAreas}`} />
      <MiniStat label="Strade" value={`${stats.completedStreets}/${stats.totalStreets}`} />
      <MiniStat label="Pin" value={stats.totalPins} />
      <MiniStat label="Caldi" value={stats.hotPins} emphasis={stats.hotPins > 0} />
      <MiniStat label="Scaduti" value={stats.overdueFollowUps} emphasis={stats.overdueFollowUps > 0} />
    </div>
  );
}

function ActionButton({
  onClick,
  children,
  tone = "neutral",
}: Readonly<{
  onClick: () => void;
  children: React.ReactNode;
  tone?: "neutral" | "danger" | "hot";
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-[6px] border px-3 text-xs font-semibold transition-colors",
        tone === "danger"
          ? "border-[var(--lr-danger)] bg-[var(--lr-danger-soft)] text-[var(--lr-danger)] hover:bg-[var(--lr-danger-soft)]"
          : tone === "hot"
            ? "border-[var(--lr-warn)] bg-[var(--lr-warn-soft)] text-[var(--lr-warn)] hover:bg-[var(--lr-warn-soft)]"
            : "border-[var(--lr-line)] bg-[var(--lr-raised)] text-[var(--lr-ink)] hover:bg-[var(--lr-raised)]",
      )}
    >
      {children}
    </button>
  );
}

function EmptyList({ text }: Readonly<{ text: string }>) {
  return (
    <div className="rounded-[7px] border border-dashed border-[var(--lr-line-quiet)] bg-[var(--lr-canvas)] p-4">
      <p className="text-sm font-medium leading-5 text-[var(--lr-ink-2)]">{text}</p>
    </div>
  );
}

function RowButton({
  active,
  onClick,
  children,
}: Readonly<{
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "w-full rounded-[7px] border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-[var(--lr-accent)] bg-[var(--lr-accent-soft)]"
          : "border-[var(--lr-line-quiet)] bg-[var(--lr-canvas)] hover:border-[var(--lr-line)] hover:bg-[var(--lr-raised)]",
      )}
    >
      {children}
    </button>
  );
}

function SelectedPanel({
  agents,
  areas,
  streets,
  pins,
  selected,
  onEdit,
  onDelete,
  onSetAreaStatus,
  onSetStreetStatus,
  onSetPinStatus,
}: Readonly<{
  agents: Agent[];
  areas: MapArea[];
  streets: MapStreet[];
  pins: MapPin[];
  selected: SelectedMapElement;
  onEdit: (selected: Exclude<SelectedMapElement, null>) => void;
  onDelete: (selected: Exclude<SelectedMapElement, null>) => void;
  onSetAreaStatus: (id: string, status: AreaStatus) => void;
  onSetStreetStatus: (id: string, status: MapStatus) => void;
  onSetPinStatus: (id: string, status: PinStatus) => void;
}>) {
  if (!selected) {
    return (
      <div className="rounded-[8px] border border-dashed border-[var(--lr-line-quiet)] bg-[var(--lr-canvas)] p-4">
        <p className="text-sm font-semibold text-[var(--lr-ink)]">Nessuna selezione</p>
        <p className="mt-1 text-xs leading-5 text-[var(--lr-ink-2)]">
          Clicca un elemento sulla mappa o nella lista per modificarlo e completarlo.
        </p>
      </div>
    );
  }

  const pin = selected.type === "pin" ? pins.find((item) => item.id === selected.id) : null;
  const area = selected.type === "area" ? areas.find((item) => item.id === selected.id) : null;
  const street =
    selected.type === "street" ? streets.find((item) => item.id === selected.id) : null;
  const title = pin?.title ?? area?.name ?? street?.name ?? "Elemento non trovato";
  const agentId = pin?.agentId ?? area?.agentId ?? street?.agentId ?? null;
  const status = pin
    ? PIN_STATUS_LABELS[pin.status]
    : area
      ? MAP_STATUS_LABELS[area.status]
      : street
        ? MAP_STATUS_LABELS[street.status]
        : "";
  const suggestion = pin ? pinSuggestion(pin) : null;

  return (
    <div className="rounded-[8px] border border-[var(--lr-line)] bg-[var(--lr-canvas)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--lr-accent)]">
            Selezionato
          </p>
          <h3 className="mt-1 truncate text-base font-semibold text-[var(--lr-ink)]">
            {title}
          </h3>
          <p className="mt-1 text-xs text-[var(--lr-ink-2)]">
            {agentName(agents, agentId)} - {status}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onEdit(selected)}
          aria-label="Modifica elemento selezionato"
          title="Modifica"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-[6px] border border-[var(--lr-line)] text-[var(--lr-ink)] hover:bg-[var(--lr-raised)]"
        >
          <Pencil className="size-4" aria-hidden="true" />
        </button>
      </div>

      {pin ? (
        <div className="mt-3 grid gap-2 text-xs text-[var(--lr-ink-2)]">
          <p>
            {PIN_CATEGORY_LABELS[pin.category]} - {PIN_PRIORITY_LABELS[pin.priority]}
          </p>
          {pin.followUpAt ? <p>Follow-up: {formatDateTime(pin.followUpAt)}</p> : null}
          {pin.notes ? <p className="line-clamp-3 leading-5">{pin.notes}</p> : null}
          {suggestion ? (
            <p className="rounded-[6px] bg-[var(--lr-raised)] p-2 font-medium text-[var(--lr-ink)]">
              {suggestion}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {area ? (
          <>
            <ActionButton onClick={() => onSetAreaStatus(area.id, "completed")}>
              Completata
            </ActionButton>
            <ActionButton onClick={() => onSetAreaStatus(area.id, "to_recheck")}>
              Da ripassare
            </ActionButton>
          </>
        ) : null}

        {street ? (
          <>
            <ActionButton onClick={() => onSetStreetStatus(street.id, "completed")}>
              Completata
            </ActionButton>
            <ActionButton onClick={() => onSetStreetStatus(street.id, "to_recheck")}>
              Da ripassare
            </ActionButton>
          </>
        ) : null}

        {pin ? (
          <>
            <ActionButton tone="hot" onClick={() => onSetPinStatus(pin.id, "hot")}>
              <Flame className="size-3.5" aria-hidden="true" />
              Caldo
            </ActionButton>
            <ActionButton onClick={() => onSetPinStatus(pin.id, "follow_up")}>
              Richiamo
            </ActionButton>
            <ActionButton onClick={() => onSetPinStatus(pin.id, "closed")}>
              Chiuso
            </ActionButton>
            <ActionButton onClick={() => onSetPinStatus(pin.id, "discarded")}>
              Scartato
            </ActionButton>
          </>
        ) : null}

        <ActionButton tone="danger" onClick={() => onDelete(selected)}>
          <Trash2 className="size-3.5" aria-hidden="true" />
          Elimina
        </ActionButton>
      </div>
    </div>
  );
}

function PinRow({
  pin,
  agents,
  active,
  onClick,
}: Readonly<{
  pin: MapPin;
  agents: Agent[];
  active: boolean;
  onClick: () => void;
}>) {
  return (
    <RowButton active={active} onClick={onClick}>
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="mt-1 size-3 shrink-0 rounded-full ring-2 ring-[var(--lr-canvas)]"
          style={{ backgroundColor: PIN_PRIORITY_COLORS[pin.priority] }}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--lr-ink)]">
            {pin.title}
          </p>
          <p className="mt-1 truncate text-xs text-[var(--lr-ink-2)]">
            {PIN_CATEGORY_LABELS[pin.category]} - {PIN_STATUS_LABELS[pin.status]}
          </p>
          <p className="mt-1 truncate text-xs text-[var(--lr-ink-3)]">
            {agentName(agents, pin.agentId)}
            {pin.followUpAt ? ` - ${formatDateTime(pin.followUpAt)}` : ""}
          </p>
        </div>
      </div>
    </RowButton>
  );
}

export function MapSidebar({
  agents,
  areas,
  streets,
  pins,
  activityLogs,
  stats,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onSetAreaStatus,
  onSetStreetStatus,
  onSetPinStatus,
}: Readonly<{
  agents: Agent[];
  areas: MapArea[];
  streets: MapStreet[];
  pins: MapPin[];
  activityLogs: MapActivityLog[];
  stats: MapStats;
  selected: SelectedMapElement;
  onSelect: (selected: SelectedMapElement) => void;
  onEdit: (selected: Exclude<SelectedMapElement, null>) => void;
  onDelete: (selected: Exclude<SelectedMapElement, null>) => void;
  onSetAreaStatus: (id: string, status: AreaStatus) => void;
  onSetStreetStatus: (id: string, status: MapStatus) => void;
  onSetPinStatus: (id: string, status: PinStatus) => void;
}>) {
  const [tab, setTab] = useState<TabKey>("pins");
  const streetsByArea = useMemo(() => {
    const counts = new Map<string, number>();
    for (const street of streets) {
      if (street.areaId) {
        counts.set(street.areaId, (counts.get(street.areaId) ?? 0) + 1);
      }
    }
    return counts;
  }, [streets]);

  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: "pins", label: "Pin", count: pins.length },
    { key: "areas", label: "Aree", count: areas.length },
    { key: "streets", label: "Strade", count: streets.length },
    { key: "activity", label: "Log", count: activityLogs.length },
  ];

  return (
    <aside className="grid h-full min-h-[620px] grid-rows-[auto_auto_minmax(0,1fr)] gap-3 overflow-hidden rounded-[10px] border border-[var(--lr-line)] bg-[var(--lr-surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--lr-accent)]">
            Aree operative
          </p>
          <h2 className="mt-1 text-base font-semibold text-[var(--lr-ink)]">
            Ricerca e contatto sul territorio
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--lr-ink-3)]">Assegnate agli agenti, non usate per localizzare gli immobili.</p>
        </div>
        <div className="rounded-full border border-[var(--lr-line)] px-2.5 py-1 text-xs font-semibold text-[var(--lr-ink-2)]">
          {pins.length + areas.length + streets.length} elementi
        </div>
      </div>

      <div className="grid gap-3">
        <StatsStrip stats={stats} />
        <SelectedPanel
          agents={agents}
          areas={areas}
          streets={streets}
          pins={pins}
          selected={selected}
          onEdit={onEdit}
          onDelete={onDelete}
          onSetAreaStatus={onSetAreaStatus}
          onSetStreetStatus={onSetStreetStatus}
          onSetPinStatus={onSetPinStatus}
        />
      </div>

      <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <div className="grid grid-cols-4 gap-1 rounded-[8px] border border-[var(--lr-line)] bg-[var(--lr-canvas)] p-1">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={clsx(
                "h-9 rounded-[6px] text-xs font-semibold transition-colors",
                tab === item.key
                  ? "bg-[var(--lr-accent-soft)] text-[var(--lr-accent)]"
                  : "text-[var(--lr-ink-3)] hover:bg-[var(--lr-raised)] hover:text-[var(--lr-ink)]",
              )}
            >
              {item.label} <span className="text-[10px] opacity-75">{item.count}</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 overflow-y-auto pr-1">
          {tab === "pins" ? (
            <div className="grid gap-2">
              {pins.length ? (
                pins.map((pin) => (
                  <PinRow
                    key={pin.id}
                    pin={pin}
                    agents={agents}
                    active={selected?.type === "pin" && selected.id === pin.id}
                    onClick={() => onSelect({ type: "pin", id: pin.id })}
                  />
                ))
              ) : (
                <EmptyList text="Nessun pin con questi filtri." />
              )}
            </div>
          ) : null}

          {tab === "areas" ? (
            <div className="grid gap-2">
              {areas.length ? (
                areas.map((area) => {
                  const agent = findAgent(agents, area.agentId);
                  return (
                    <RowButton
                      key={area.id}
                      active={selected?.type === "area" && selected.id === area.id}
                      onClick={() => onSelect({ type: "area", id: area.id })}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <Shapes className="mt-0.5 size-4 shrink-0 text-[var(--lr-accent)]" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--lr-ink)]">
                            {area.name}
                          </p>
                          <p className="mt-1 truncate text-xs text-[var(--lr-ink-2)]">
                            <span
                              className="mr-1.5 inline-block size-2 rounded-full"
                              style={{ backgroundColor: area.color ?? agent?.color ?? "var(--lr-accent)" }}
                              aria-hidden="true"
                            />
                            {agentName(agents, area.agentId)} - {MAP_STATUS_LABELS[area.status]}
                          </p>
                          <p className="mt-1 text-xs text-[var(--lr-ink-3)]">
                            {streetsByArea.get(area.id) ?? 0} strade collegate
                          </p>
                        </div>
                      </div>
                    </RowButton>
                  );
                })
              ) : (
                <EmptyList text="Nessuna area con questi filtri." />
              )}
            </div>
          ) : null}

          {tab === "streets" ? (
            <div className="grid gap-2">
              {streets.length ? (
                streets.map((street) => (
                  <RowButton
                    key={street.id}
                    active={selected?.type === "street" && selected.id === street.id}
                    onClick={() => onSelect({ type: "street", id: street.id })}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <Route className="mt-0.5 size-4 shrink-0 text-[var(--lr-accent)]" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--lr-ink)]">
                          {street.name}
                        </p>
                        <p className="mt-1 truncate text-xs text-[var(--lr-ink-2)]">
                          {agentName(agents, street.agentId)} - {MAP_STATUS_LABELS[street.status]}
                        </p>
                        {street.lastCompletedAt ? (
                          <p className="mt-1 text-xs text-[var(--lr-ink-3)]">
                            Completata {formatDateTime(street.lastCompletedAt)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </RowButton>
                ))
              ) : (
                <EmptyList text="Nessuna strada con questi filtri." />
              )}
            </div>
          ) : null}

          {tab === "activity" ? (
            <div className="grid gap-2">
              {activityLogs.length ? (
                activityLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-[7px] border border-[var(--lr-line)] bg-[var(--lr-canvas)] p-3"
                  >
                    <div className="flex items-start gap-3">
                      <Clock className="mt-0.5 size-4 shrink-0 text-[var(--lr-accent)]" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--lr-ink)]">
                          {log.actionType.replaceAll("_", " ")}
                        </p>
                        {log.notes ? (
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--lr-ink-2)]">
                            {log.notes}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-[var(--lr-ink-3)]">
                          {formatDateTime(log.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyList text="Ancora nessuna attività salvata." />
              )}
            </div>
          ) : null}
        </div>
      </section>
    </aside>
  );
}
