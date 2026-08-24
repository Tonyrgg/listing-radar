"use client";

import { Ban, Check, MapPinned, Save } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveRequestZonesAction } from "@/app/(private)/matching-actions";
import type { InternalZone } from "@/lib/matching/types";
import { ZoneMap } from "./zone-map";
import styles from "./request-zone-picker.module.css";

export function RequestZonePicker({ requestId, zones, initialZoneIds, initialExcludedZoneIds }: Readonly<{
  requestId: string;
  zones: InternalZone[];
  initialZoneIds: string[];
  initialExcludedZoneIds: string[];
}>) {
  const router = useRouter();
  const [selected, setSelected] = useState(() => new Set(initialZoneIds));
  const [excluded, setExcluded] = useState(() => new Set(initialExcludedZoneIds));
  const [mode, setMode] = useState<"preferred" | "excluded">("preferred");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function toggle(zoneId: string) {
    if (mode === "preferred") {
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
    } else {
      setExcluded((current) => {
        const next = new Set(current);
        if (next.has(zoneId)) next.delete(zoneId);
        else next.add(zoneId);
        return next;
      });
      setSelected((current) => {
        if (!current.has(zoneId)) return current;
        const next = new Set(current);
        next.delete(zoneId);
        return next;
      });
    }
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
    zoneNumber: zone.zone_number,
    name: zone.name,
    color: zone.color,
    geometry: zone.geometry!,
  }));

  return (
    <div className={styles.picker}>
      {shapes.length ? (
        <ZoneMap
          compact
          showZoneLabels
          showFullscreenControl
          shapes={shapes}
          selectedZoneIds={[...selected]}
          excludedZoneIds={[...excluded]}
          onZoneToggle={toggle}
          controls={(
            <div className={styles.controls}>
              <button type="button" onClick={() => setMode("preferred")} aria-pressed={mode === "preferred"} className={`${styles.mode} ${mode === "preferred" ? styles.modePreferred : ""}`}>
                <Check aria-hidden="true" /> Desiderate
              </button>
              <button type="button" onClick={() => setMode("excluded")} aria-pressed={mode === "excluded"} className={`${styles.mode} ${mode === "excluded" ? styles.modeExcluded : ""}`}>
                <Ban aria-hidden="true" /> Da evitare
              </button>
              <span className={styles.counts}>{selected.size} desiderate · {excluded.size} escluse</span>
              <button type="button" onClick={save} disabled={pending} className={styles.save}>
                <Save aria-hidden="true" /> {pending ? "Salvo…" : "Salva"}
              </button>
            </div>
          )}
        />
      ) : (
        <div className="grid min-h-48 place-items-center rounded-[8px] border border-dashed border-[var(--lr-line)] text-center text-sm text-[var(--lr-ink-2)]">
          <div><MapPinned aria-hidden="true" className="mx-auto size-5 text-[var(--lr-accent)]" /><p className="mt-2">Disegna i perimetri nella scheda Zone immobiliari per abilitarne la selezione sulla mappa.</p></div>
        </div>
      )}

      {message ? <p className={styles.message}>{message}</p> : null}
      {error ? <p className={`${styles.message} ${styles.error}`}>{error}</p> : null}
    </div>
  );
}
