"use client";

import { Check, MapPinned, Save } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveRequestZonesAction } from "@/app/(private)/matching-actions";
import type { InternalZone } from "@/lib/matching/types";
import { ZoneMap } from "./zone-map";

export function RequestZonePicker({ requestId, zones, initialZoneIds, initialExcludedZoneIds }: Readonly<{
  requestId: string;
  zones: InternalZone[];
  initialZoneIds: string[];
  initialExcludedZoneIds: string[];
}>) {
  const router = useRouter();
  const [selected, setSelected] = useState(() => new Set(initialZoneIds));
  const [excluded, setExcluded] = useState(() => new Set(initialExcludedZoneIds));
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function toggle(zoneId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      return next;
    });
    setExcluded((current) => {
      if (!current.has(zoneId)) return current;
      const next = new Set(current);
      next.delete(zoneId);
      return next;
    });
    setMessage("");
  }

  function save() {
    start(async () => {
      try {
        setError("");
        const result = await saveRequestZonesAction(requestId, [...selected], [...excluded]);
        setMessage(`${result.count} ${result.count === 1 ? "zona salvata" : "zone salvate"}.`);
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Zone non salvate.");
      }
    });
  }

  const activeZones = zones.filter((zone) => zone.is_active);
  const shapes = activeZones.filter((zone) => zone.geometry).map((zone) => ({
    shapeId: zone.id,
    zoneId: zone.id,
    name: zone.name,
    color: zone.color,
    geometry: zone.geometry!,
  }));

  return (
    <div className="grid gap-3">
      {shapes.length ? (
        <ZoneMap compact shapes={shapes} selectedZoneIds={[...selected]} excludedZoneIds={[...excluded]} onZoneToggle={toggle} />
      ) : (
        <div className="grid min-h-48 place-items-center rounded-[8px] border border-dashed border-[var(--line-strong)] text-center text-sm text-[var(--ink-soft)]">
          <div><MapPinned aria-hidden="true" className="mx-auto size-5 text-[var(--surface-accent)]" /><p className="mt-2">Disegna i perimetri nella scheda Zone immobiliari per abilitarne la selezione sulla mappa.</p></div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {activeZones.map((zone) => {
          const checked = selected.has(zone.id);
          const isExcluded = excluded.has(zone.id);
          return (
            <button
              type="button"
              className={`inline-flex min-h-9 items-center gap-2 rounded-[7px] border px-3 text-xs font-bold ${checked ? "border-[var(--surface-accent)] bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]" : isExcluded ? "border-red-400/40 bg-red-400/10 text-red-300" : "border-[var(--line-soft)] text-[var(--ink-soft)]"}`}
              aria-pressed={checked}
              onClick={() => toggle(zone.id)}
              key={zone.id}
            >
              {checked ? <Check aria-hidden="true" className="size-3.5" /> : null}{zone.name}{isExcluded ? " · esclusa dal CRM" : !zone.geometry ? " · senza perimetro" : ""}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line-soft)] pt-3">
        <button type="button" onClick={save} disabled={pending} className="inline-flex min-h-10 items-center gap-2 rounded-[7px] bg-[var(--surface-accent)] px-4 text-sm font-bold text-[var(--button-ink)]">
          <Save aria-hidden="true" className="size-4" /> {pending ? "Salvataggio…" : "Salva zone desiderate"}
        </button>
        <span className="text-xs text-[var(--ink-subtle)]">{selected.size} desiderate · {excluded.size} escluse</span>
        {message ? <span className="text-xs font-semibold text-[var(--surface-accent)]">{message}</span> : null}
        {error ? <span className="text-xs font-semibold text-[var(--status-error)]">{error}</span> : null}
      </div>
    </div>
  );
}
