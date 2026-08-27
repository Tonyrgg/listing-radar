"use client";

import { MAP_DATA_COLORS } from "@/lib/design/map-palette";

import { Save, X } from "lucide-react";
import { useState } from "react";

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
import type {
  Agent,
  CreateMapAreaInput,
  CreateMapPinInput,
  CreateMapStreetInput,
  GeoJsonGeometry,
  MapArea,
  MapPin,
  MapStreet,
  UpdateMapAreaInput,
  UpdateMapPinInput,
  UpdateMapStreetInput,
} from "@/lib/map/types";

export type MapModalState =
  | {
      type: "pin";
      mode: "create";
      latitude: number;
      longitude: number;
    }
  | {
      type: "pin";
      mode: "edit";
      pin: MapPin;
    }
  | {
      type: "area";
      mode: "create";
      geometry: GeoJsonGeometry;
    }
  | {
      type: "area";
      mode: "edit";
      area: MapArea;
    }
  | {
      type: "street";
      mode: "create";
      geometry: GeoJsonGeometry;
    }
  | {
      type: "street";
      mode: "edit";
      street: MapStreet;
    }
  | null;

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function dateTimeToIso(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoToDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function ModalShell({
  title,
  subtitle,
  children,
  onClose,
}: Readonly<{
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onClose: () => void;
}>) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[var(--lr-scrim)] p-4 backdrop-blur-sm">
      <section className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)] shadow-[var(--lr-floating)]">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--lr-line-quiet)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[length:var(--lr-text-label)] font-semibold uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-accent)]">
              {subtitle}
            </p>
            <h2 className="mt-1 text-[length:var(--lr-text-section)] font-semibold text-[var(--lr-ink)]">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            title="Chiudi"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] text-[var(--lr-ink)] hover:bg-[var(--lr-raised)]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        <div className="max-h-[calc(92vh-74px)] overflow-y-auto px-5 py-5">
          {children}
        </div>
      </section>
    </div>
  );
}

function TextField({
  label,
  name,
  defaultValue,
  required,
  type = "text",
  readOnly,
  step,
}: Readonly<{
  label: string;
  name: string;
  defaultValue?: string | number | null;
  required?: boolean;
  type?: string;
  readOnly?: boolean;
  step?: string;
}>) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[length:var(--lr-text-label)] font-semibold uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        readOnly={readOnly}
        step={step}
        defaultValue={defaultValue ?? ""}
        className="h-10 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink)] outline-none read-only:text-[var(--lr-ink-3)]"
      />
    </label>
  );
}

function TextAreaField({
  label,
  name,
  defaultValue,
}: Readonly<{
  label: string;
  name: string;
  defaultValue?: string | null;
}>) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[length:var(--lr-text-label)] font-semibold uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
        {label}
      </span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={4}
        className="resize-y rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3 py-2 text-[length:var(--lr-text-body)] leading-6 text-[var(--lr-ink)] outline-none"
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  children,
}: Readonly<{
  label: string;
  name: string;
  defaultValue?: string | null;
  children: React.ReactNode;
}>) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[length:var(--lr-text-label)] font-semibold uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        className="h-10 rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] bg-[var(--lr-canvas)] px-3 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink)] outline-none"
      >
        {children}
      </select>
    </label>
  );
}

function FormActions({
  pending,
  error,
  onClose,
}: Readonly<{
  pending: boolean;
  error: string | null;
  onClose: () => void;
}>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--lr-line-quiet)] pt-4">
      <p className="min-h-5 text-[length:var(--lr-text-body)] font-medium text-[var(--lr-danger)]">
        {error ?? ""}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 items-center justify-center rounded-[var(--lr-radius-control)] border border-[var(--lr-line)] px-4 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-ink)] hover:bg-[var(--lr-raised)]"
        >
          Annulla
        </button>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--lr-radius-control)] bg-[var(--lr-accent)] px-4 text-[length:var(--lr-text-body)] font-semibold text-[var(--lr-accent-ink)] hover:bg-[var(--lr-accent-hover)] disabled:cursor-wait disabled:opacity-70"
        >
          <Save className="size-4" aria-hidden="true" />
          {pending ? "Salvo" : "Salva"}
        </button>
      </div>
    </div>
  );
}

function AgentOptions({ agents }: Readonly<{ agents: Agent[] }>) {
  return (
    <>
      <option value="">Nessuno</option>
      {agents.map((agent) => (
        <option key={agent.id} value={agent.id}>
          {agent.name}
        </option>
      ))}
    </>
  );
}

function AreaOptions({ areas }: Readonly<{ areas: MapArea[] }>) {
  return (
    <>
      <option value="">Nessuna</option>
      {areas.map((area) => (
        <option key={area.id} value={area.id}>
          {area.name}
        </option>
      ))}
    </>
  );
}

function StreetOptions({ streets }: Readonly<{ streets: MapStreet[] }>) {
  return (
    <>
      <option value="">Nessuna</option>
      {streets.map((street) => (
        <option key={street.id} value={street.id}>
          {street.name}
        </option>
      ))}
    </>
  );
}

function PinForm({
  modal,
  agents,
  areas,
  streets,
  onClose,
  onSave,
}: Readonly<{
  modal: Extract<MapModalState, { type: "pin" }>;
  agents: Agent[];
  areas: MapArea[];
  streets: MapStreet[];
  onClose: () => void;
  onSave: (id: string | null, input: CreateMapPinInput | UpdateMapPinInput) => Promise<void>;
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pin = modal.mode === "edit" ? modal.pin : null;
  const latitude = modal.mode === "create" ? modal.latitude : modal.pin.latitude;
  const longitude = modal.mode === "create" ? modal.longitude : modal.pin.longitude;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const formData = new FormData(event.currentTarget);
      const nextLatitude = Number(formData.get("latitude"));
      const nextLongitude = Number(formData.get("longitude"));

      if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude)) {
        throw new Error("Coordinate pin non valide.");
      }

      await onSave(pin?.id ?? null, {
        title: optionalText(formData.get("title")) ?? "Nuovo pin",
        category: String(formData.get("category") ?? "other") as CreateMapPinInput["category"],
        status: String(formData.get("status") ?? "new") as CreateMapPinInput["status"],
        priority: String(formData.get("priority") ?? "medium") as CreateMapPinInput["priority"],
        agentId: optionalText(formData.get("agentId")),
        areaId: optionalText(formData.get("areaId")),
        streetId: optionalText(formData.get("streetId")),
        listingId: optionalText(formData.get("listingId")),
        latitude: nextLatitude,
        longitude: nextLongitude,
        addressRaw: optionalText(formData.get("addressRaw")),
        notes: optionalText(formData.get("notes")),
        followUpAt: dateTimeToIso(formData.get("followUpAt")),
        lastContactedAt: pin?.lastContactedAt ?? null,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Salvataggio non riuscito.");
      setPending(false);
    }
  }

  return (
    <ModalShell
      title={pin ? "Modifica pin" : "Nuovo pin"}
      subtitle="Punto operativo"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Titolo" name="title" defaultValue={pin?.title} required />
          <SelectField label="Agente" name="agentId" defaultValue={pin?.agentId}>
            <AgentOptions agents={agents} />
          </SelectField>
          <SelectField label="Categoria" name="category" defaultValue={pin?.category ?? "other"}>
            {PIN_CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>
                {PIN_CATEGORY_LABELS[category]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Status" name="status" defaultValue={pin?.status ?? "new"}>
            {PIN_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {PIN_STATUS_LABELS[status]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Priorità" name="priority" defaultValue={pin?.priority ?? "medium"}>
            {PIN_PRIORITY_OPTIONS.map((priority) => (
              <option key={priority} value={priority}>
                {PIN_PRIORITY_LABELS[priority]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Follow-up"
            name="followUpAt"
            type="datetime-local"
            defaultValue={isoToDateTimeLocal(pin?.followUpAt ?? null)}
          />
          <SelectField label="Area collegata" name="areaId" defaultValue={pin?.areaId}>
            <AreaOptions areas={areas} />
          </SelectField>
          <SelectField label="Strada collegata" name="streetId" defaultValue={pin?.streetId}>
            <StreetOptions streets={streets} />
          </SelectField>
          <TextField label="Listing ID opzionale" name="listingId" defaultValue={pin?.listingId} />
          <TextField label="Indirizzo testuale" name="addressRaw" defaultValue={pin?.addressRaw} />
          <TextField label="Latitudine" name="latitude" type="number" step="any" defaultValue={latitude} required />
          <TextField label="Longitudine" name="longitude" type="number" step="any" defaultValue={longitude} required />
        </div>
        <TextAreaField label="Note" name="notes" defaultValue={pin?.notes} />
        <FormActions pending={pending} error={error} onClose={onClose} />
      </form>
    </ModalShell>
  );
}

function AreaForm({
  modal,
  agents,
  onClose,
  onSave,
}: Readonly<{
  modal: Extract<MapModalState, { type: "area" }>;
  agents: Agent[];
  onClose: () => void;
  onSave: (id: string | null, input: CreateMapAreaInput | UpdateMapAreaInput) => Promise<void>;
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = modal.mode === "edit" ? modal.area : null;
  const geometry = modal.mode === "create" ? modal.geometry : modal.area.geometry;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const formData = new FormData(event.currentTarget);
      await onSave(area?.id ?? null, {
        name: optionalText(formData.get("name")) ?? "Nuova area",
        agentId: optionalText(formData.get("agentId")),
        color: optionalText(formData.get("color")),
        geometry,
        status: String(formData.get("status") ?? "not_started") as CreateMapAreaInput["status"],
        notes: optionalText(formData.get("notes")),
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Salvataggio non riuscito.");
      setPending(false);
    }
  }

  return (
    <ModalShell
      title={area ? "Modifica area" : "Nuova area"}
      subtitle="Poligono territoriale"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nome area" name="name" defaultValue={area?.name} required />
          <SelectField label="Agente" name="agentId" defaultValue={area?.agentId}>
            <AgentOptions agents={agents} />
          </SelectField>
          <TextField label="Colore opzionale" name="color" type="color" defaultValue={area?.color ?? MAP_DATA_COLORS.info} />
          <SelectField label="Status" name="status" defaultValue={area?.status ?? "not_started"}>
            {AREA_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {MAP_STATUS_LABELS[status]}
              </option>
            ))}
          </SelectField>
        </div>
        <TextAreaField label="Note" name="notes" defaultValue={area?.notes} />
        <FormActions pending={pending} error={error} onClose={onClose} />
      </form>
    </ModalShell>
  );
}

function StreetForm({
  modal,
  agents,
  areas,
  onClose,
  onSave,
}: Readonly<{
  modal: Extract<MapModalState, { type: "street" }>;
  agents: Agent[];
  areas: MapArea[];
  onClose: () => void;
  onSave: (id: string | null, input: CreateMapStreetInput | UpdateMapStreetInput) => Promise<void>;
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const street = modal.mode === "edit" ? modal.street : null;
  const geometry = modal.mode === "create" ? modal.geometry : modal.street.geometry;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const formData = new FormData(event.currentTarget);
      const status = String(formData.get("status") ?? "not_started") as CreateMapStreetInput["status"];
      await onSave(street?.id ?? null, {
        name: optionalText(formData.get("name")) ?? "Nuova strada",
        agentId: optionalText(formData.get("agentId")),
        areaId: optionalText(formData.get("areaId")),
        geometry,
        status,
        lastCompletedAt:
          status === "completed" && !street?.lastCompletedAt
            ? new Date().toISOString()
            : street?.lastCompletedAt ?? null,
        notes: optionalText(formData.get("notes")),
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Salvataggio non riuscito.");
      setPending(false);
    }
  }

  return (
    <ModalShell
      title={street ? "Modifica strada" : "Nuova strada"}
      subtitle="Linea sul territorio"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nome strada" name="name" defaultValue={street?.name} required />
          <SelectField label="Agente" name="agentId" defaultValue={street?.agentId}>
            <AgentOptions agents={agents} />
          </SelectField>
          <SelectField label="Area collegata" name="areaId" defaultValue={street?.areaId}>
            <AreaOptions areas={areas} />
          </SelectField>
          <SelectField label="Status" name="status" defaultValue={street?.status ?? "not_started"}>
            {STREET_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {MAP_STATUS_LABELS[status]}
              </option>
            ))}
          </SelectField>
        </div>
        <TextAreaField label="Note" name="notes" defaultValue={street?.notes} />
        <FormActions pending={pending} error={error} onClose={onClose} />
      </form>
    </ModalShell>
  );
}

export function MapModals({
  modal,
  agents,
  areas,
  streets,
  onClose,
  onSavePin,
  onSaveArea,
  onSaveStreet,
}: Readonly<{
  modal: MapModalState;
  agents: Agent[];
  areas: MapArea[];
  streets: MapStreet[];
  onClose: () => void;
  onSavePin: (id: string | null, input: CreateMapPinInput | UpdateMapPinInput) => Promise<void>;
  onSaveArea: (id: string | null, input: CreateMapAreaInput | UpdateMapAreaInput) => Promise<void>;
  onSaveStreet: (id: string | null, input: CreateMapStreetInput | UpdateMapStreetInput) => Promise<void>;
}>) {
  if (!modal) return null;

  if (modal.type === "pin") {
    return (
      <PinForm
        modal={modal}
        agents={agents}
        areas={areas}
        streets={streets}
        onClose={onClose}
        onSave={onSavePin}
      />
    );
  }

  if (modal.type === "area") {
    return (
      <AreaForm
        modal={modal}
        agents={agents}
        onClose={onClose}
        onSave={onSaveArea}
      />
    );
  }

  return (
    <StreetForm
      modal={modal}
      agents={agents}
      areas={areas}
      onClose={onClose}
      onSave={onSaveStreet}
    />
  );
}
