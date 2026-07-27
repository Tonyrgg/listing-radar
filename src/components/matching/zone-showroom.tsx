"use client";

import {
  Landmark,
  MapPinned,
  Milestone,
  Plus,
  Save,
  Settings2,
  Tags,
  Trash2,
} from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  deleteZoneAction,
  saveZoneAction,
} from "@/app/(private)/matching-actions";
import type { InternalZone } from "@/lib/matching/types";

const inputClass =
  "h-11 w-full rounded-[7px] border border-[var(--line-strong)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--ink-strong)] outline-none focus:border-[var(--surface-accent)]";

export function ZoneShowroom({
  zones,
}: Readonly<{ zones: InternalZone[] }>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<InternalZone | null>(null);

  function submit(formData: FormData) {
    const split = (key: string) =>
      String(formData.get(key) ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
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
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <section className="grid content-start gap-4 md:grid-cols-2">
        {zones.map((zone) => (
          <button
            type="button"
            onClick={() => setEditing(zone)}
            key={zone.id}
            className={`group/zone min-h-56 overflow-hidden rounded-[11px] border bg-[var(--surface-panel)] text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--surface-accent)] ${
              editing?.id === zone.id
                ? "border-[var(--surface-accent)]"
                : "border-[var(--line-soft)] hover:border-[var(--line-strong)]"
            }`}
          >
            <div className="relative flex min-h-24 items-start justify-between overflow-hidden border-b border-[var(--line-soft)] bg-[oklch(0.155_0.012_155)] p-4">
              <span className="grid size-10 place-items-center rounded-[8px] bg-[var(--surface-muted)] text-[var(--surface-accent)]">
                <MapPinned aria-hidden="true" className="size-5" />
              </span>
              <MapPinned
                aria-hidden="true"
                className="absolute -bottom-7 -right-3 size-28 text-[oklch(0.29_0.02_155)] transition-transform group-hover/zone:-translate-x-1"
                strokeWidth={0.8}
              />
              <span className="relative z-10 rounded-full border border-[var(--line-soft)] bg-[var(--surface-panel)] px-2.5 py-1 text-[10px] font-bold text-[var(--ink-soft)]">
                {zone.is_active ? "In uso" : "Disattivata"}
              </span>
            </div>
            <div className="p-4">
              <h2 className="text-lg font-semibold text-[var(--ink-strong)]">
                {zone.name}
              </h2>
              <p className="mt-1 line-clamp-2 text-sm leading-5 text-[var(--ink-soft)]">
                {zone.description ||
                  "Aggiungi una descrizione per riconoscerla meglio."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <ZoneFact
                  icon={Milestone}
                  value={zone.associated_streets.length}
                  label="vie"
                />
                <ZoneFact
                  icon={Tags}
                  value={zone.aliases.length}
                  label="alias"
                />
                <ZoneFact
                  icon={Landmark}
                  value={zone.landmarks.length}
                  label="riferimenti"
                />
              </div>
            </div>
          </button>
        ))}

        {!zones.length ? (
          <div className="col-span-full grid min-h-64 place-items-center rounded-[11px] border border-dashed border-[var(--line-strong)] p-8 text-center">
            <div>
              <MapPinned className="mx-auto size-7 text-[var(--surface-accent)]" />
              <h2 className="mt-4 font-semibold text-[var(--ink-strong)]">
                Crea la prima zona dell’ufficio
              </h2>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                Per esempio Zona Villa, Centro Storico o Zona Stazione.
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <form
        action={submit}
        key={editing?.id ?? "new"}
        className="h-fit rounded-[11px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5 xl:sticky xl:top-5"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-[8px] bg-[var(--surface-muted)] text-[var(--surface-accent)]">
              {editing ? (
                <Settings2 aria-hidden="true" className="size-5" />
              ) : (
                <Plus aria-hidden="true" className="size-5" />
              )}
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[var(--ink-subtle)]">
                {editing ? "Zona selezionata" : "Nuova zona"}
              </p>
              <h2 className="font-semibold text-[var(--ink-strong)]">
                {editing ? editing.name : "Aggiungi alla mappa mentale"}
              </h2>
            </div>
          </div>
          {editing ? (
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="min-h-9 rounded-[7px] border border-[var(--line-soft)] px-3 text-xs font-bold text-[var(--ink-soft)]"
            >
              Nuova
            </button>
          ) : null}
        </div>

        <div className="mt-5 space-y-4">
          <Field label="Nome della zona">
            <input
              name="name"
              required
              defaultValue={editing?.name}
              placeholder="Es. Zona Villa"
              className={inputClass}
            />
          </Field>
          <Field label="Come la descriveresti?">
            <textarea
              name="description"
              defaultValue={editing?.description ?? ""}
              rows={3}
              className={`${inputClass} h-auto py-3`}
            />
          </Field>
          <Field label="Vie comprese" hint="separate da virgola">
            <textarea
              name="streets"
              defaultValue={editing?.associated_streets.join(", ")}
              rows={3}
              placeholder="Via 4 Novembre, Via della Repubblica"
              className={`${inputClass} h-auto py-3`}
            />
          </Field>
          <Field label="Nomi alternativi" hint="separati da virgola">
            <input
              name="aliases"
              defaultValue={editing?.aliases.join(", ")}
              placeholder="Villa, Villa comunale"
              className={inputClass}
            />
          </Field>
          <Field label="Punti di riferimento" hint="separati da virgola">
            <input
              name="landmarks"
              defaultValue={editing?.landmarks.join(", ")}
              placeholder="Stazione, Ospedale"
              className={inputClass}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-3 rounded-[8px] bg-[var(--surface-muted)] px-3 text-sm font-semibold text-[var(--ink-soft)]">
            <input
              name="is_active"
              type="checkbox"
              defaultChecked={editing?.is_active ?? true}
            />
            Usa questa zona nelle nuove richieste
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-2 rounded-[8px] bg-[var(--surface-accent)] px-4 text-sm font-bold text-[var(--button-ink)]"
          >
            <Save aria-hidden="true" className="size-4" />
            {pending ? "Salvataggio…" : "Salva zona"}
          </button>
          {editing ? (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Eliminare questa zona? È possibile solo se non è utilizzata.",
                  )
                ) {
                  start(async () => {
                    await deleteZoneAction(editing.id);
                    setEditing(null);
                    router.refresh();
                  });
                }
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border border-red-400/40 px-4 text-sm font-semibold text-red-300"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Elimina
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: Readonly<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}>) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-[var(--ink-soft)]">
      <span>
        {label}
        {hint ? (
          <span className="ml-1 font-normal text-[var(--ink-subtle)]">
            ({hint})
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function ZoneFact({
  icon: Icon,
  value,
  label,
}: Readonly<{
  icon: typeof Milestone;
  value: number;
  label: string;
}>) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[7px] bg-[var(--surface-muted)] px-2 py-1.5 text-xs text-[var(--ink-soft)]">
      <Icon className="size-3.5" />
      <strong className="text-[var(--ink-strong)]">{value}</strong> {label}
    </span>
  );
}
