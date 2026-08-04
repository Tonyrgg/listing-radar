"use client";

import { Landmark, MapPinned, Milestone, Plus, Save, ScanSearch, Tags, Trash2, Unlink } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  backfillRequestZonesAction,
  deleteZoneAction,
  saveZoneAction,
  unlinkZoneAreaAction,
} from "@/app/(private)/matching-actions";
import type { InternalZone } from "@/lib/matching/types";
import type { GeoJsonGeometry, MapArea } from "@/lib/map/types";
import styles from "./section-design.module.css";
import { ZoneMap } from "./zone-map";

const DEFAULT_COLOR = "#5fbf7a";

export function ZoneShowroom({ zones, areas }: Readonly<{ zones: InternalZone[]; areas: MapArea[] }>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<InternalZone | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [draftGeometry, setDraftGeometry] = useState<GeoJsonGeometry | null>(null);
  const [areaId, setAreaId] = useState("");
  const [areaColor, setAreaColor] = useState(DEFAULT_COLOR);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const linkedAreaIds = useMemo(() => new Set(zones.map((zone) => zone.map_area_id).filter(Boolean)), [zones]);
  const shapes = useMemo(() => areas.map((area) => {
    const zone = zones.find((item) => item.map_area_id === area.id);
    return { areaId: area.id, zoneId: zone?.id ?? null, name: zone?.name ?? area.name, color: area.color, geometry: area.geometry };
  }), [areas, zones]);

  function chooseZone(zone: InternalZone | null) {
    setEditing(zone);
    setAreaId(zone?.map_area_id ?? "");
    setAreaColor(zone?.map_area?.color || DEFAULT_COLOR);
    setDraftGeometry(null);
    setDrawing(false);
    setMessage("");
    setError("");
  }

  function submit(formData: FormData) {
    const split = (key: string) => String(formData.get(key) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    start(async () => {
      try {
        setError("");
        await saveZoneAction({
          id: editing?.id,
          name: formData.get("name"),
          description: formData.get("description") || null,
          landmarks: split("landmarks"),
          aliases: split("aliases"),
          associated_streets: split("streets"),
          map_area_id: areaId || null,
          geometry: draftGeometry,
          area_color: areaColor,
          is_active: formData.get("is_active") === "on",
        });
        setMessage("Zona e perimetro salvati.");
        setDraftGeometry(null);
        setEditing(null);
        setAreaId("");
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
      }
    });
  }

  function runBackfill() {
    if (!window.confirm("Recuperare dalle richieste CRM solo le zone riconosciute esplicitamente per nome, alias, via o riferimento?")) return;
    start(async () => {
      try {
        setError("");
        const result = await backfillRequestZonesAction();
        setMessage(`${result.requestsUpdated} richieste aggiornate, ${result.linksCreated} collegamenti creati.`);
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Recupero non riuscito.");
      }
    });
  }

  return (
    <div className={styles.page}>
      <section className={styles.mapPanel}>
        <header className={styles.mapToolbar}>
          <div>
            <p className={styles.sectionEyebrow}>Perimetri operativi</p>
            <h2 className={styles.panelTitle}>Disegna e collega le zone</h2>
            <p className={styles.mapHint}>Le aree tratteggiate esistono nella mappa ma non sono ancora collegate a una zona.</p>
          </div>
          <div className={styles.mapToolbarActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => setDrawing(true)} disabled={drawing}>
              <MapPinned aria-hidden="true" className="size-4" /> {editing?.map_area_id || draftGeometry ? "Ridisegna perimetro" : "Disegna perimetro"}
            </button>
            {draftGeometry ? <button type="button" className={styles.secondaryButton} onClick={() => setDraftGeometry(null)}>Annulla disegno</button> : null}
          </div>
        </header>
        <div className={styles.mapBody}>
          <ZoneMap
            shapes={shapes}
            highlightedZoneId={editing?.id}
            draftGeometry={draftGeometry}
            drawing={drawing}
            onGeometryCreated={(geometry) => { setDraftGeometry(geometry); setAreaId(editing?.map_area_id ?? ""); }}
            onDrawingConsumed={() => setDrawing(false)}
            onZoneToggle={(zoneId) => chooseZone(zones.find((zone) => zone.id === zoneId) ?? null)}
          />
        </div>
      </section>

      <div className={styles.coverageBar}>
        <p className={styles.coverageCopy}><strong>{zones.filter((zone) => zone.map_area_id).length}/{zones.length}</strong> zone hanno un perimetro. Il recupero CRM non sovrascrive selezioni già presenti.</p>
        <button type="button" className={styles.secondaryButton} onClick={runBackfill} disabled={pending}><ScanSearch aria-hidden="true" className="size-4" /> Recupera zone dal CRM</button>
      </div>
      {message ? <p className="text-sm text-[var(--surface-accent)]">{message}</p> : null}
      {error ? <p className="text-sm text-[var(--status-error)]">{error}</p> : null}

      <div className={styles.workspace}>
        <section className={styles.zoneList} aria-label="Zone configurate">
          {zones.map((zone) => (
            <button type="button" onClick={() => chooseZone(zone)} className={`${styles.zoneButton} ${editing?.id === zone.id ? styles.zoneSelected : ""}`} key={zone.id}>
              <div className={styles.zoneTop}>
                <div>
                  <h2 className={styles.zoneName}>{zone.name}</h2>
                  <p className={styles.zoneDescription}>{zone.description || "Nessuna descrizione operativa."}</p>
                </div>
                <span className={styles.badge}>{zone.map_area_id ? "Perimetro salvato" : zone.is_active ? "Senza perimetro" : "Disattivata"}</span>
              </div>
              <div className={styles.zoneFacts}>
                <span className={styles.zoneFact}><Milestone aria-hidden="true" className="size-3.5" /> {zone.associated_streets.length} vie</span>
                <span className={styles.zoneFact}><Tags aria-hidden="true" className="size-3.5" /> {zone.aliases.length} alias</span>
                <span className={styles.zoneFact}><Landmark aria-hidden="true" className="size-3.5" /> {zone.landmarks.length} riferimenti</span>
              </div>
            </button>
          ))}
          {!zones.length ? <div className={styles.emptyState}><p>Crea la prima zona usata dall’ufficio.</p></div> : null}
        </section>

        <form action={submit} key={editing?.id ?? "new"} className={styles.editor}>
          <header className={styles.editorHeader}>
            <div><p className={styles.sectionEyebrow}>{editing ? "Zona selezionata" : "Nuova zona"}</p><h2 className={styles.panelTitle}>{editing?.name || "Aggiungi zona"}</h2></div>
            {editing ? <button type="button" className={styles.secondaryButton} onClick={() => chooseZone(null)}><Plus aria-hidden="true" className="size-4" /> Nuova</button> : null}
          </header>
          <div className={styles.editorBody}>
            <Field label="Nome della zona"><input className={styles.input} name="name" required defaultValue={editing?.name} placeholder="Es. Zona Villa" /></Field>
            <Field label="Descrizione"><textarea className={styles.input} name="description" rows={3} defaultValue={editing?.description ?? ""} /></Field>
            <Field label="Area della mappa" hint="puoi collegarne una già disegnata">
              <select className={styles.select} value={areaId} onChange={(event) => { setAreaId(event.target.value); setDraftGeometry(null); }}>
                <option value="">Nessuna area collegata</option>
                {areas.filter((area) => !linkedAreaIds.has(area.id) || area.id === editing?.map_area_id).map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}
              </select>
            </Field>
            <Field label="Colore perimetro"><input className={styles.input} type="color" value={areaColor} onChange={(event) => setAreaColor(event.target.value)} /></Field>
            <Field label="Vie comprese" hint="separate da virgola"><textarea className={styles.input} name="streets" rows={3} defaultValue={editing?.associated_streets.join(", ")} /></Field>
            <Field label="Nomi alternativi" hint="separati da virgola"><input className={styles.input} name="aliases" defaultValue={editing?.aliases.join(", ")} /></Field>
            <Field label="Punti di riferimento" hint="separati da virgola"><input className={styles.input} name="landmarks" defaultValue={editing?.landmarks.join(", ")} /></Field>
            <label className={styles.checkbox}><input name="is_active" type="checkbox" defaultChecked={editing?.is_active ?? true} /> Usa questa zona nelle nuove richieste</label>
          </div>
          <footer className={styles.editorFooter}>
            <button className={styles.primaryButton} disabled={pending}><Save aria-hidden="true" className="size-4" /> {pending ? "Salvataggio…" : "Salva zona"}</button>
            {editing?.map_area_id ? <button type="button" className={styles.secondaryButton} onClick={() => start(async () => { await unlinkZoneAreaAction(editing.id); chooseZone(null); router.refresh(); })}><Unlink aria-hidden="true" className="size-4" /> Scollega area</button> : null}
            {editing ? <button type="button" className={styles.dangerButton} onClick={() => { if (window.confirm("Eliminare questa zona? È possibile solo se non è utilizzata.")) start(async () => { await deleteZoneAction(editing.id); chooseZone(null); router.refresh(); }); }}><Trash2 aria-hidden="true" className="size-4" /> Elimina</button> : null}
          </footer>
        </form>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: Readonly<{ label: string; hint?: string; children: React.ReactNode }>) {
  return <label className={styles.field}><span>{label}{hint ? <span className="ml-1 font-normal text-[var(--ink-subtle)]">({hint})</span> : null}</span>{children}</label>;
}
