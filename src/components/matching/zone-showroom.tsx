"use client";

import { MAP_DATA_COLORS } from "@/lib/design/map-palette";

import { ConfirmAction } from "@/components/ui/feedback";

import {
  Check,
  Eraser,
  Focus,
  Info,
  Landmark,
  Maximize2,
  Milestone,
  Minimize2,
  MousePointer2,
  Plus,
  PenLine,
  Save,
  ScanSearch,
  Shapes,
  Tags,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  backfillRequestZonesAction,
  clearZoneGeometryAction,
  deleteZoneAction,
  saveZoneAction,
} from "@/app/(private)/matching-actions";
import type { InternalZone } from "@/lib/matching/types";
import { readableTextColor } from "@/lib/map/colors";
import type { GeoJsonGeometry } from "@/lib/map/types";
import styles from "./section-design.module.css";
import { ZoneMap } from "./zone-map";

const DEFAULT_COLOR: string = MAP_DATA_COLORS.positive;
export function ZoneShowroom({ zones }: Readonly<{ zones: InternalZone[] }>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<InternalZone | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [vertexEditing, setVertexEditing] = useState(false);
  const [draftGeometry, setDraftGeometry] = useState<GeoJsonGeometry | null>(null);
  const [zoneColor, setZoneColor] = useState(DEFAULT_COLOR);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const mapPanelRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLFormElement>(null);

  const orderedZones = useMemo(() => [...zones].sort((left, right) => {
    const leftNumber = left.zone_number ?? 999;
    const rightNumber = right.zone_number ?? 999;
    return leftNumber - rightNumber || left.name.localeCompare(right.name, "it");
  }), [zones]);
  const nextZoneNumber = useMemo(
    () => Math.min(99, Math.max(0, ...zones.map((zone) => zone.zone_number ?? 0)) + 1),
    [zones],
  );

  const shapes = useMemo(() => orderedZones.filter((zone) => zone.geometry).map((zone) => {
    return {
      shapeId: zone.id,
      zoneId: zone.id,
      zoneNumber: zone.zone_number,
      name: zone.name,
      color: zone.color,
      geometry: zone.geometry!,
    };
  }), [orderedZones]);

  const mapExpanded = fullscreen || fallbackFullscreen;
  const mappedZoneCount = shapes.length;

  useEffect(() => {
    function syncFullscreen() {
      setFullscreen(document.fullscreenElement === mapPanelRef.current);
    }

    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    if (!fallbackFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fallbackFullscreen]);

  function chooseZone(zone: InternalZone | null) {
    setEditing(zone);
    setZoneColor(zone?.color || DEFAULT_COLOR);
    setDraftGeometry(null);
    setDrawing(false);
    setVertexEditing(false);
    setMessage("");
    setError("");
  }

  async function toggleFullscreen() {
    if (fallbackFullscreen) {
      setFallbackFullscreen(false);
      return;
    }

    try {
      if (document.fullscreenElement === mapPanelRef.current) {
        await document.exitFullscreen();
      } else if (mapPanelRef.current?.requestFullscreen) {
        await mapPanelRef.current.requestFullscreen();
      } else {
        setFallbackFullscreen(true);
      }
    } catch {
      setFallbackFullscreen((current) => !current);
    }
  }

  async function continueToEditor() {
    if (document.fullscreenElement === mapPanelRef.current) await document.exitFullscreen();
    setFallbackFullscreen(false);
    window.setTimeout(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }

  function startNewDrawing() {
    chooseZone(null);
    setDrawing(true);
  }

  function startVertexEditing() {
    if (!editing?.geometry) return;
    setDrawing(false);
    setDraftGeometry(editing.geometry);
    setVertexEditing(true);
    setMessage("");
    setError("");
  }

  function cancelVertexEditing() {
    setVertexEditing(false);
    setDraftGeometry(null);
    setMessage("");
    setError("");
  }

  function saveEditedGeometry() {
    if (!editing || !draftGeometry) return;
    const selectedZone = editing;
    const geometry = draftGeometry;
    start(async () => {
      try {
        setError("");
        await saveZoneAction({
          id: selectedZone.id,
          zone_number: selectedZone.zone_number,
          name: selectedZone.name,
          description: selectedZone.description,
          landmarks: selectedZone.landmarks,
          aliases: selectedZone.aliases,
          associated_streets: selectedZone.associated_streets,
          geometry,
          color: zoneColor,
          is_active: selectedZone.is_active,
        });
        setVertexEditing(false);
        setDraftGeometry(null);
        setEditing({ ...selectedZone, geometry });
        setMessage(`Perimetro di ${selectedZone.name} aggiornato.`);
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Aggiornamento del perimetro non riuscito.");
      }
    });
  }

  const mapInstruction = vertexEditing
    ? `Modifica ${editing?.name ?? "il perimetro"}: trascina i punti pieni oppure usa quelli intermedi per aggiungere nuovi vertici.`
    : drawing
    ? "Clicca i vertici del perimetro e chiudilo sul primo punto."
    : draftGeometry
      ? "Perimetro pronto: completa i dati e salva la zona."
      : editing
        ? `${editing.name} selezionata. Ridisegna per sostituire il perimetro salvato.`
        : "Seleziona un perimetro esistente oppure avvia un nuovo disegno.";

  function submit(formData: FormData) {
    const split = (key: string) => String(formData.get(key) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    start(async () => {
      try {
        setError("");
        await saveZoneAction({
          id: editing?.id,
          zone_number: formData.get("zone_number"),
          name: formData.get("name"),
          description: formData.get("description") || null,
          landmarks: split("landmarks"),
          aliases: split("aliases"),
          associated_streets: split("streets"),
          geometry: draftGeometry ?? editing?.geometry ?? null,
          color: zoneColor,
          is_active: formData.get("is_active") === "on",
        });
        setMessage("Zona immobiliare salvata.");
        setDraftGeometry(null);
        setEditing(null);
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
      }
    });
  }

  function runBackfill() {
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
      <section
        ref={mapPanelRef}
        className={`${styles.mapPanel} ${mapExpanded ? styles.mapPanelFullscreen : ""}`}
      >
        <header className={styles.mapHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Perimetri immobiliari</p>
            <h2 className={styles.panelTitle}>Disegna i quartieri usati da immobili e richieste</h2>
            <p className={styles.mapHint}>Questi perimetri descrivono la posizione degli immobili. Le aree operative assegnate agli agenti restano separate.</p>
          </div>
          <div className={styles.mapStats} aria-label={`${mappedZoneCount} zone su ${zones.length} hanno un perimetro`}>
            <strong>{mappedZoneCount}/{zones.length}</strong>
            <span>perimetri pronti</span>
          </div>
        </header>
        <div className={styles.mapToolbar} aria-label="Strumenti della mappa">
          <div className={styles.mapModes}>
            <button
              type="button"
              className={`${styles.mapModeButton} ${!drawing && !vertexEditing ? styles.mapModeActive : ""}`}
              aria-pressed={!drawing && !vertexEditing}
              onClick={() => { setDrawing(false); if (vertexEditing) cancelVertexEditing(); }}
            >
              <MousePointer2 aria-hidden="true" className="size-4" /> Esplora
            </button>
            <button
              type="button"
              className={`${styles.mapModeButton} ${drawing ? styles.mapModeActive : ""}`}
              aria-pressed={drawing}
              onClick={() => { setVertexEditing(false); setDraftGeometry(null); setDrawing(true); }}
            >
              <Shapes aria-hidden="true" className="size-4" /> {editing?.geometry || draftGeometry ? "Ridisegna" : "Disegna zona"}
            </button>
            {editing?.geometry ? (
              <button
                type="button"
                className={`${styles.mapModeButton} ${vertexEditing ? styles.mapModeActive : ""}`}
                aria-pressed={vertexEditing}
                onClick={vertexEditing ? cancelVertexEditing : startVertexEditing}
              >
                <PenLine aria-hidden="true" className="size-4" /> Modifica punti
              </button>
            ) : null}
            <button type="button" className={styles.mapModeButton} onClick={startNewDrawing}>
              <Plus aria-hidden="true" className="size-4" /> Nuova zona
            </button>
          </div>
          <div className={styles.mapTools}>
            <button type="button" className={styles.mapToolButton} onClick={() => setFitRequest((value) => value + 1)} title="Inquadra tutti i perimetri">
              <Focus aria-hidden="true" className="size-4" /> <span>Inquadra</span>
            </button>
            <button type="button" className={styles.mapToolButton} onClick={toggleFullscreen} aria-pressed={mapExpanded}>
              {mapExpanded ? <Minimize2 aria-hidden="true" className="size-4" /> : <Maximize2 aria-hidden="true" className="size-4" />}
              <span>{mapExpanded ? "Esci da schermo intero" : "Schermo intero"}</span>
            </button>
          </div>
        </div>
        <div className={`${styles.mapStatus} ${drawing || vertexEditing ? styles.mapStatusActive : ""}`} role="status">
          <Info aria-hidden="true" className="size-4" />
          <span>{mapInstruction}</span>
          {vertexEditing ? (
            <div className={styles.mapStatusActions}>
              <button type="button" onClick={cancelVertexEditing} disabled={pending}><Undo2 aria-hidden="true" className="size-3.5" /> Annulla</button>
              <button type="button" onClick={saveEditedGeometry} disabled={pending}><Check aria-hidden="true" className="size-3.5" /> {pending ? "Salvataggio…" : "Applica modifiche"}</button>
            </div>
          ) : draftGeometry ? (
            <div className={styles.mapStatusActions}>
              <button type="button" onClick={() => setDraftGeometry(null)}>Scarta</button>
              {mapExpanded ? <button type="button" onClick={continueToEditor}><Check aria-hidden="true" className="size-3.5" /> Completa dati</button> : null}
            </div>
          ) : null}
        </div>
        <div className={styles.mapBody}>
          <ZoneMap
            shapes={shapes}
            highlightedZoneId={editing?.id}
            draftGeometry={vertexEditing ? null : draftGeometry}
            drawing={drawing}
            showZoneLabels
            vertexEditing={vertexEditing}
            editingZoneId={editing?.id}
            editingGeometry={draftGeometry}
            fitRequest={fitRequest}
            onGeometryCreated={setDraftGeometry}
            onGeometryEdited={setDraftGeometry}
            onDrawingConsumed={() => setDrawing(false)}
            onZoneToggle={(zoneId) => chooseZone(zones.find((zone) => zone.id === zoneId) ?? null)}
          />
        </div>
      </section>

      <div className={styles.coverageBar}>
        <p className={styles.coverageCopy}><strong>{zones.filter((zone) => zone.geometry).length}/{zones.length}</strong> zone immobiliari hanno un perimetro. Il recupero CRM non sovrascrive selezioni già presenti.</p>
        <button type="button" className={styles.secondaryButton} onClick={runBackfill} disabled={pending}><ScanSearch aria-hidden="true" className="size-4" /> Recupera zone dal CRM</button>
      </div>
      {message ? <p className="text-[length:var(--lr-text-body)] text-[var(--lr-accent)]">{message}</p> : null}
      {error ? <p className="text-[length:var(--lr-text-body)] text-[var(--lr-danger)]">{error}</p> : null}

      <div className={styles.workspace}>
        <section className={styles.zoneList} aria-label="Zone immobiliari configurate">
          {orderedZones.map((zone) => (
            <button type="button" data-zone-name={zone.name} onClick={() => chooseZone(zone)} className={`${styles.zoneButton} ${editing?.id === zone.id ? styles.zoneSelected : ""}`} key={zone.id}>
              <div className={styles.zoneTop}>
                <div className={styles.zoneIdentity}>
                  <span
                    className={`${styles.zoneNumber} ${zone.zone_number ? "" : styles.zoneNumberUnassigned}`}
                    style={zone.zone_number ? { backgroundColor: zone.color || DEFAULT_COLOR, color: readableTextColor(zone.color || DEFAULT_COLOR) } : undefined}
                    aria-label={zone.zone_number ? `Zona numero ${zone.zone_number}` : "Zona senza numero"}
                  >
                    {zone.zone_number ?? "—"}
                  </span>
                  <div>
                  <h2 className={styles.zoneName}>{zone.name}</h2>
                  <p className={styles.zoneDescription}>{zone.description || "Nessuna descrizione immobiliare."}</p>
                  </div>
                </div>
                <span className={styles.badge}>{zone.geometry ? "Perimetro salvato" : zone.is_active ? "Perimetro da disegnare" : "Disattivata"}</span>
              </div>
              <div className={styles.zoneFacts}>
                <span className={styles.zoneFact}><Milestone aria-hidden="true" className="size-3.5" /> {zone.associated_streets.length} vie</span>
                <span className={styles.zoneFact}><Tags aria-hidden="true" className="size-3.5" /> {zone.aliases.length} alias</span>
                <span className={styles.zoneFact}><Landmark aria-hidden="true" className="size-3.5" /> {zone.landmarks.length} riferimenti</span>
              </div>
            </button>
          ))}
          {!zones.length ? <div className={styles.emptyState}><p>Crea la prima zona immobiliare di Bitonto.</p></div> : null}
        </section>

        <form ref={editorRef} action={submit} key={editing?.id ?? "new"} className={styles.editor}>
          <header className={styles.editorHeader}>
            <div><p className={styles.sectionEyebrow}>{editing ? "Zona immobiliare selezionata" : "Nuova zona immobiliare"}</p><h2 className={styles.panelTitle}>{editing?.name || "Aggiungi zona"}</h2></div>
            {editing ? <button type="button" className={styles.secondaryButton} onClick={() => chooseZone(null)}><Plus aria-hidden="true" className="size-4" /> Nuova</button> : null}
          </header>
          <div className={styles.editorBody}>
            <Field label="Numero zona" hint="univoco sulla mappa"><input className={styles.input} name="zone_number" type="number" min="1" max="99" required defaultValue={editing?.zone_number ?? nextZoneNumber} /></Field>
            <Field label="Nome della zona"><input className={styles.input} name="name" required defaultValue={editing?.name} placeholder="Es. Zona Villa" /></Field>
            <Field label="Descrizione"><textarea className={styles.input} name="description" rows={3} defaultValue={editing?.description ?? ""} /></Field>
            <Field label="Colore del perimetro"><input className={styles.input} type="color" value={zoneColor} onChange={(event) => setZoneColor(event.target.value)} /></Field>
            <Field label="Vie comprese" hint="separate da virgola"><textarea className={styles.input} name="streets" rows={3} defaultValue={editing?.associated_streets.join(", ")} /></Field>
            <Field label="Nomi alternativi" hint="separati da virgola"><input className={styles.input} name="aliases" defaultValue={editing?.aliases.join(", ")} /></Field>
            <Field label="Punti di riferimento" hint="separati da virgola"><input className={styles.input} name="landmarks" defaultValue={editing?.landmarks.join(", ")} /></Field>
            <label className={styles.checkbox}><input name="is_active" type="checkbox" defaultChecked={editing?.is_active ?? true} /> Usa questa zona per immobili, richieste e matching</label>
          </div>
          <footer className={styles.editorFooter}>
            <button className={styles.primaryButton} disabled={pending}><Save aria-hidden="true" className="size-4" /> {pending ? "Salvataggio…" : "Salva zona immobiliare"}</button>
            {editing?.geometry ? <button type="button" className={styles.secondaryButton} onClick={() => start(async () => { await clearZoneGeometryAction(editing.id); chooseZone(null); router.refresh(); })}><Eraser aria-hidden="true" className="size-4" /> Rimuovi perimetro</button> : null}
            {editing ? <ConfirmAction className={styles.dangerButton} title="Eliminare questa zona immobiliare?" description="Si può eliminare solo una zona che non è usata da immobili o richieste. Se è in uso, l'operazione non andrà a buon fine." confirmLabel="Sì, elimina" onConfirm={() => start(async () => { await deleteZoneAction(editing.id); chooseZone(null); router.refresh(); })}><Trash2 aria-hidden="true" className="size-4" /> Elimina</ConfirmAction> : null}
          </footer>
        </form>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: Readonly<{ label: string; hint?: string; children: React.ReactNode }>) {
  return <label className={styles.field}><span>{label}{hint ? <span className="ml-1 font-normal text-[var(--lr-ink-3)]">({hint})</span> : null}</span>{children}</label>;
}
