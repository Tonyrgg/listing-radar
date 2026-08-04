"use client";

import { Landmark, Milestone, Plus, Save, Tags, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { deleteZoneAction, saveZoneAction } from "@/app/(private)/matching-actions";
import type { InternalZone } from "@/lib/matching/types";
import styles from "./section-design.module.css";

export function ZoneShowroom({ zones }: Readonly<{ zones: InternalZone[] }>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<InternalZone | null>(null);

  function submit(formData: FormData) {
    const split = (key: string) => String(formData.get(key) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    start(async () => {
      await saveZoneAction({
        id: editing?.id,
        name: formData.get("name"),
        description: formData.get("description") || null,
        landmarks: split("landmarks"),
        aliases: split("aliases"),
        associated_streets: split("streets"),
        map_area_id: null,
        is_active: formData.get("is_active") === "on",
      });
      setEditing(null);
      router.refresh();
    });
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.zoneList} aria-label="Zone configurate">
        {zones.map((zone) => (
          <button
            type="button"
            onClick={() => setEditing(zone)}
            className={`${styles.zoneButton} ${editing?.id === zone.id ? styles.zoneSelected : ""}`}
            key={zone.id}
          >
            <div className={styles.zoneTop}>
              <div>
                <h2 className={styles.zoneName}>{zone.name}</h2>
                <p className={styles.zoneDescription}>{zone.description || "Nessuna descrizione operativa."}</p>
              </div>
              <span className={styles.badge}>{zone.is_active ? "In uso" : "Disattivata"}</span>
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
          <div>
            <p className={styles.sectionEyebrow}>{editing ? "Zona selezionata" : "Nuova zona"}</p>
            <h2 className={styles.panelTitle}>{editing?.name || "Aggiungi zona"}</h2>
          </div>
          {editing ? <button type="button" className={styles.secondaryButton} onClick={() => setEditing(null)}><Plus aria-hidden="true" className="size-4" /> Nuova</button> : null}
        </header>
        <div className={styles.editorBody}>
          <Field label="Nome della zona"><input className={styles.input} name="name" required defaultValue={editing?.name} placeholder="Es. Zona Villa" /></Field>
          <Field label="Descrizione"><textarea className={styles.input} name="description" rows={3} defaultValue={editing?.description ?? ""} /></Field>
          <Field label="Vie comprese" hint="separate da virgola"><textarea className={styles.input} name="streets" rows={3} defaultValue={editing?.associated_streets.join(", ")} placeholder="Via 4 Novembre, Via della Repubblica" /></Field>
          <Field label="Nomi alternativi" hint="separati da virgola"><input className={styles.input} name="aliases" defaultValue={editing?.aliases.join(", ")} /></Field>
          <Field label="Punti di riferimento" hint="separati da virgola"><input className={styles.input} name="landmarks" defaultValue={editing?.landmarks.join(", ")} /></Field>
          <label className={styles.checkbox}><input name="is_active" type="checkbox" defaultChecked={editing?.is_active ?? true} /> Usa questa zona nelle nuove richieste</label>
        </div>
        <footer className={styles.editorFooter}>
          <button className={styles.primaryButton} disabled={pending}><Save aria-hidden="true" className="size-4" /> {pending ? "Salvataggio…" : "Salva zona"}</button>
          {editing ? (
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => {
                if (window.confirm("Eliminare questa zona? È possibile solo se non è utilizzata.")) {
                  start(async () => { await deleteZoneAction(editing.id); setEditing(null); router.refresh(); });
                }
              }}
            >
              <Trash2 aria-hidden="true" className="size-4" /> Elimina
            </button>
          ) : null}
        </footer>
      </form>
    </div>
  );
}

function Field({ label, hint, children }: Readonly<{ label: string; hint?: string; children: React.ReactNode }>) {
  return <label className={styles.field}><span>{label}{hint ? <span className="ml-1 font-normal text-[var(--ink-subtle)]">({hint})</span> : null}</span>{children}</label>;
}
