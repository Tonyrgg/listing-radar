"use client";

import type { Agent } from "@/lib/map/types";
import {
  MAP_STATUS_LABELS,
  PIN_PRIORITY_COLORS,
  PIN_PRIORITY_LABELS,
  PIN_PRIORITY_OPTIONS,
  STREET_STATUS_OPTIONS,
} from "@/lib/map/constants";

export function MapLegend({ agents }: Readonly<{ agents: Agent[] }>) {
  return (
    <section className="grid gap-4">
      <div>
        <p className="text-[length:var(--lr-text-meta)] font-semibold text-[var(--lr-ink)]">Agenti</p>
        <div className="mt-2 grid gap-2">
          {agents.length ? (
            agents.map((agent) => (
              <div key={agent.id} className="flex items-center gap-2 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]">
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: agent.color }}
                  aria-hidden="true"
                />
                <span className="truncate">{agent.name}</span>
              </div>
            ))
          ) : (
            <p className="text-[length:var(--lr-text-meta)] leading-5 text-[var(--lr-ink-3)]">
              Applica la migration per caricare Tony e Agente 2.
            </p>
          )}
        </div>
      </div>

      <div>
        <p className="text-[length:var(--lr-text-meta)] font-semibold text-[var(--lr-ink)]">Strade</p>
        <div className="mt-2 grid gap-2">
          {STREET_STATUS_OPTIONS.map((status) => (
            <div key={status} className="flex items-center gap-2 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]">
              <span
                className="h-0.5 w-8 rounded-full bg-[var(--lr-accent)]"
                style={{
                  opacity: status === "not_started" ? 0.45 : status === "not_useful" ? 0.3 : 1,
                  borderTop:
                    status === "not_started" || status === "to_recheck"
                      ? "2px dashed currentColor"
                      : undefined,
                  color:
                    status === "to_recheck"
                      ? "var(--lr-warn)"
                      : status === "not_useful"
                        ? "var(--lr-ink-3)"
                        : "var(--lr-accent)",
                }}
                aria-hidden="true"
              />
              <span>{MAP_STATUS_LABELS[status]}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[length:var(--lr-text-meta)] font-semibold text-[var(--lr-ink)]">Pin</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {PIN_PRIORITY_OPTIONS.map((priority) => (
            <div key={priority} className="flex items-center gap-2 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-2)]">
              <span
                className="size-3 rounded-full ring-2 ring-[var(--lr-canvas)]"
                style={{ backgroundColor: PIN_PRIORITY_COLORS[priority] }}
                aria-hidden="true"
              />
              <span>{PIN_PRIORITY_LABELS[priority]}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
