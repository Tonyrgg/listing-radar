"use client";

import type { Agent } from "@/lib/map/types";
import type { MapFiltersState } from "@/lib/map/types";
import {
  AREA_STATUS_OPTIONS,
  MAP_STATUS_LABELS,
  PIN_CATEGORY_LABELS,
  PIN_CATEGORY_OPTIONS,
  PIN_PRIORITY_LABELS,
  PIN_PRIORITY_OPTIONS,
  PIN_STATUS_LABELS,
  PIN_STATUS_OPTIONS,
  STREET_STATUS_OPTIONS,
} from "@/lib/map/constants";

function FieldShell({
  label,
  children,
}: Readonly<{
  label: string;
  children: React.ReactNode;
}>) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function SelectShell({
  value,
  onChange,
  children,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}>) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full rounded-[6px] border border-[var(--line-soft)] bg-[var(--surface-canvas)] px-2 text-xs font-semibold text-[var(--ink-strong)] outline-none"
    >
      {children}
    </select>
  );
}

function VisibilityToggle({
  label,
  checked,
  onChange,
}: Readonly<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}>) {
  return (
    <label className="flex h-9 cursor-pointer items-center justify-between gap-3 rounded-[6px] border border-[var(--line-soft)] bg-[var(--surface-canvas)] px-2 text-xs font-semibold text-[var(--ink-strong)]">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[var(--surface-accent)]"
      />
    </label>
  );
}

export function MapFilters({
  agents,
  filters,
  onChange,
}: Readonly<{
  agents: Agent[];
  filters: MapFiltersState;
  onChange: (filters: MapFiltersState) => void;
}>) {
  const patch = (next: Partial<MapFiltersState>) =>
    onChange({ ...filters, ...next });

  return (
    <section className="grid gap-3">
      <div className="grid gap-2">
        <FieldShell label="Agente">
          <SelectShell
            value={filters.agentId}
            onChange={(agentId) => patch({ agentId })}
          >
            <option value="all">Tutti</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </SelectShell>
        </FieldShell>

        <div className="grid grid-cols-3 gap-2">
          <VisibilityToggle
            label="Aree"
            checked={filters.showAreas}
            onChange={(showAreas) => patch({ showAreas })}
          />
          <VisibilityToggle
            label="Strade"
            checked={filters.showStreets}
            onChange={(showStreets) => patch({ showStreets })}
          />
          <VisibilityToggle
            label="Pin"
            checked={filters.showPins}
            onChange={(showPins) => patch({ showPins })}
          />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <FieldShell label="Status aree">
          <SelectShell
            value={filters.areaStatus}
            onChange={(areaStatus) =>
              patch({ areaStatus: areaStatus as MapFiltersState["areaStatus"] })
            }
          >
            <option value="all">Tutti</option>
            {AREA_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {MAP_STATUS_LABELS[status]}
              </option>
            ))}
          </SelectShell>
        </FieldShell>

        <FieldShell label="Status strade">
          <SelectShell
            value={filters.streetStatus}
            onChange={(streetStatus) =>
              patch({
                streetStatus: streetStatus as MapFiltersState["streetStatus"],
              })
            }
          >
            <option value="all">Tutti</option>
            {STREET_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {MAP_STATUS_LABELS[status]}
              </option>
            ))}
          </SelectShell>
        </FieldShell>

        <FieldShell label="Categoria pin">
          <SelectShell
            value={filters.pinCategory}
            onChange={(pinCategory) =>
              patch({
                pinCategory: pinCategory as MapFiltersState["pinCategory"],
              })
            }
          >
            <option value="all">Tutte</option>
            {PIN_CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>
                {PIN_CATEGORY_LABELS[category]}
              </option>
            ))}
          </SelectShell>
        </FieldShell>

        <FieldShell label="Status pin">
          <SelectShell
            value={filters.pinStatus}
            onChange={(pinStatus) =>
              patch({ pinStatus: pinStatus as MapFiltersState["pinStatus"] })
            }
          >
            <option value="all">Tutti</option>
            {PIN_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {PIN_STATUS_LABELS[status]}
              </option>
            ))}
          </SelectShell>
        </FieldShell>

        <FieldShell label="Priorita pin">
          <SelectShell
            value={filters.pinPriority}
            onChange={(pinPriority) =>
              patch({
                pinPriority: pinPriority as MapFiltersState["pinPriority"],
              })
            }
          >
            <option value="all">Tutte</option>
            {PIN_PRIORITY_OPTIONS.map((priority) => (
              <option key={priority} value={priority}>
                {PIN_PRIORITY_LABELS[priority]}
              </option>
            ))}
          </SelectShell>
        </FieldShell>

        <FieldShell label="Follow-up">
          <SelectShell
            value={filters.followUp}
            onChange={(followUp) =>
              patch({ followUp: followUp as MapFiltersState["followUp"] })
            }
          >
            <option value="all">Tutti</option>
            <option value="overdue">Solo scaduti</option>
            <option value="next7">Prossimi 7 giorni</option>
          </SelectShell>
        </FieldShell>
      </div>
    </section>
  );
}
