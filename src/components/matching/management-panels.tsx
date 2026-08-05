"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deletePropertyAction, deleteRequestAction, deleteZoneAction, duplicateRequestAction,
  linkClientAction, recalculateAction, saveClientAction, saveFeatureAction,
  saveMatchingConfigAction, savePropertyAction, saveZoneAction,
  updateRequestStatusAction,
} from "@/app/(private)/matching-actions";
import type {
  Client, FeatureDefinition, InternalZone, MatchingConfig, PortfolioProperty,
} from "@/lib/matching/types";
import { zoneContainingPoint } from "@/lib/map/geometry";
import { ZoneMap } from "@/components/matching/zone-map";

const inputClass = "h-10 w-full rounded-[7px] border border-[var(--line-soft)] bg-[var(--surface-muted)] px-3 text-sm text-[var(--ink-strong)] outline-none focus:border-[var(--surface-accent)]";
const propertyTypes = [
  ["apartment","Appartamento"],["independent_house","Casa indipendente"],
  ["villa","Villa"],["townhouse","Villetta a schiera"],["penthouse","Attico"],
  ["ground_floor","Piano terra"],["entire_building","Intero stabile"],
  ["commercial_space","Locale commerciale"],["office","Ufficio"],
  ["warehouse","Deposito / magazzino"],["garage","Garage / box"],
  ["land","Terreno"],["other","Altra tipologia"],
];

export function RecalculateButton({ scope, id }: Readonly<{ scope: "all" | "request" | "property"; id?: string }>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <button type="button" disabled={pending} onClick={() => start(async () => { await recalculateAction(scope, id); router.refresh(); })} className="min-h-10 rounded-[8px] border border-[var(--surface-accent)] px-4 text-sm font-bold text-[var(--surface-accent)]">{pending ? "Calcolo in corso…" : "Ricalcola match"}</button>;
}

export function RequestControls({
  id, status, clients, clientId,
}: Readonly<{ id: string; status: string; clients: Client[]; clientId: string | null }>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (action: () => Promise<unknown>) => start(async () => {
    try { setError(""); await action(); router.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Operazione non riuscita."); }
  });
  function createClient(formData: FormData) {
    run(async () => {
      const client = await saveClientAction({ full_name: formData.get("full_name") || null, phone: formData.get("phone") || null, email: formData.get("email") || null, notes: null, external_crm_id: null });
      if (client?.id) await linkClientAction(id, client.id);
    });
  }
  return <section className="rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4">
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid min-w-48 flex-1 gap-1 text-xs font-semibold text-[var(--ink-soft)]">Stato richiesta<select disabled={pending} value={status} onChange={(event) => run(() => updateRequestStatusAction(id, event.target.value))} className={inputClass}><option value="draft">Bozza</option><option value="active">Attiva</option><option value="urgent">Urgente</option><option value="suspended">Sospesa</option><option value="satisfied">Soddisfatta</option><option value="cancelled">Annullata</option><option value="archived">Archiviata</option></select></label>
      <label className="grid min-w-52 flex-1 gap-1 text-xs font-semibold text-[var(--ink-soft)]">Cliente collegato<select disabled={pending} value={clientId ?? ""} onChange={(event) => run(() => linkClientAction(id, event.target.value || null))} className={inputClass}><option value="">Richiesta anonima</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.full_name || client.phone || "Cliente senza nome"}</option>)}</select></label>
      <button type="button" disabled={pending} onClick={() => run(async () => { const copyId = await duplicateRequestAction(id); router.push(`/requests/${copyId}`); })} className="min-h-10 rounded-[7px] border border-[var(--line-soft)] px-4 text-sm font-semibold text-[var(--ink-soft)]">Duplica</button>
      <button type="button" disabled={pending} onClick={() => { if (window.confirm("Eliminare definitivamente questa richiesta?")) run(async () => { await deleteRequestAction(id); router.push("/requests"); }); }} className="min-h-10 rounded-[7px] border border-red-400/40 px-4 text-sm font-semibold text-red-300">Elimina</button>
    </div>
    <form action={createClient} className="mt-4 grid gap-2 border-t border-[var(--line-soft)] pt-4 sm:grid-cols-[1fr_180px_220px_auto]"><input name="full_name" placeholder="Nome nuovo cliente" className={inputClass} /><input name="phone" placeholder="Telefono" className={inputClass} /><input name="email" type="email" placeholder="Email" className={inputClass} /><button disabled={pending} className="min-h-10 rounded-[7px] bg-[var(--surface-accent)] px-4 text-sm font-bold text-[var(--button-ink)]">Crea e collega</button></form>
    {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
  </section>;
}

export function DeletePropertyButton({ id }: Readonly<{ id: string }>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <button type="button" disabled={pending} onClick={() => { if (window.confirm("Eliminare definitivamente questo immobile?")) start(async () => { await deletePropertyAction(id); router.push("/portfolio"); }); }} className="min-h-10 rounded-[8px] border border-red-400/40 px-4 text-sm font-semibold text-red-300">Elimina immobile</button>;
}

export function PropertyEditor({
  zones, features, property,
}: Readonly<{ zones: InternalZone[]; features: FeatureDefinition[]; property?: PortfolioProperty & { feature_values?: Record<string, unknown> } }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [address, setAddress] = useState(property?.address ?? "");
  const [contractType, setContractType] = useState<"sale" | "rent">(property?.contract_type ?? "sale");
  const [selectedZone, setSelectedZone] = useState(property?.internal_zone_id ?? "");
  const [latitude, setLatitude] = useState<number | null>(property?.latitude ?? null);
  const [longitude, setLongitude] = useState<number | null>(property?.longitude ?? null);
  const suggestedZone = useMemo(() => {
    const normalized = address.trim().toLocaleLowerCase("it");
    if (!normalized) return null;
    return zones.find((zone) => zone.associated_streets.some((street) => {
      const candidate = street.trim().toLocaleLowerCase("it");
      return candidate && normalized.includes(candidate);
    })) ?? null;
  }, [address, zones]);
  const values = property?.feature_values ?? {};
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  function submit(formData: FormData) {
    setError("");
    start(async () => {
      try {
        const number = (key: string) => formData.get(key) ? Number(formData.get(key)) : null;
        const feature_values = features.map((feature) => ({
          feature_definition_id: feature.id,
          value: formData.get(`feature_${feature.id}`) === "on",
        }));
        const result = await savePropertyAction({
          id: property?.id, title: formData.get("title"), contract_type: formData.get("contract_type"),
          property_type: formData.get("property_type"), municipality: formData.get("municipality"),
          address: formData.get("address") || null, internal_zone_id: formData.get("internal_zone_id") || null,
          latitude, longitude,
          price: number("price"), monthly_rent: number("monthly_rent"), internal_sqm: number("internal_sqm"),
          commercial_sqm: number("commercial_sqm"), rooms: number("rooms"), bedrooms: number("bedrooms"),
          bathrooms: number("bathrooms"), floor: number("floor"), building_floors: number("building_floors"),
          condition: formData.get("condition") || null, availability_status: formData.get("availability_status") || null,
          available_from: formData.get("available_from") || null, description: formData.get("description") || null,
          notes: formData.get("notes") || null, external_crm_id: formData.get("external_crm_id") || null,
          mandate_status: formData.get("mandate_status"), feature_values,
        });
        setOpen(false); router.push(`/portfolio/${result.id}`); router.refresh();
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito."); }
    });
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="min-h-10 rounded-[8px] bg-[var(--surface-accent)] px-4 text-sm font-bold text-[var(--button-ink)]">{property ? "Modifica immobile" : "Nuovo immobile"}</button>;
  return <div className="fixed inset-0 z-[1200] grid place-items-center bg-[oklch(0.08_0.008_155_/_0.82)] p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><form action={submit} role="dialog" aria-modal="true" aria-label={property ? "Modifica immobile" : "Nuovo immobile"} className="max-h-[94dvh] w-full max-w-[1040px] overflow-y-auto rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface-panel)] p-5 sm:p-6">
    <div className="mb-5 flex items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-[var(--surface-accent)]">Scheda portafoglio</p><h2 className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">{property ? "Modifica immobile" : "Nuovo immobile"}</h2><p className="mt-1 text-sm text-[var(--ink-soft)]">Inserisci subito i dati indispensabili. Posizione, dotazioni e note possono essere completate dopo.</p></div><button type="button" onClick={() => setOpen(false)} className="min-h-10 rounded-[7px] border border-[var(--line-soft)] px-3 text-sm font-semibold text-[var(--ink-soft)]">Chiudi</button></div>
    {error ? <p className="mb-4 rounded-[7px] bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Titolo<input name="title" required defaultValue={property?.title} className={inputClass} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Contratto<select name="contract_type" value={contractType} onChange={(event) => setContractType(event.target.value as "sale" | "rent")} className={inputClass}><option value="sale">Vendita</option><option value="rent">Affitto</option></select></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Tipologia<select name="property_type" defaultValue={property?.property_type ?? "apartment"} className={inputClass}>{propertyTypes.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Comune<input name="municipality" defaultValue={property?.municipality ?? "Bitonto"} className={inputClass} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Indirizzo<input name="address" value={address} onChange={(event) => setAddress(event.target.value)} className={inputClass} />{suggestedZone && selectedZone !== suggestedZone.id ? <button type="button" onClick={() => setSelectedZone(suggestedZone.id)} className="text-left text-[11px] font-bold text-[var(--surface-accent)]">Via riconosciuta: usa {suggestedZone.name}</button> : null}</label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Zona immobiliare<select name="internal_zone_id" value={selectedZone} onChange={(event) => setSelectedZone(event.target.value)} className={inputClass}><option value="">Da assegnare / fuori perimetro</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.zone_number ? `${zone.zone_number} · ` : ""}{zone.name}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">{contractType === "sale" ? "Prezzo richiesto" : "Canone mensile"}<input key={contractType} name={contractType === "sale" ? "price" : "monthly_rent"} type="number" min="0" step="any" defaultValue={(contractType === "sale" ? property?.price : property?.monthly_rent) ?? ""} className={inputClass} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Superficie interna<input name="internal_sqm" type="number" min="0" step="any" defaultValue={property?.internal_sqm ?? ""} className={inputClass} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Locali<input name="rooms" type="number" min="0" step="any" defaultValue={property?.rooms ?? ""} className={inputClass} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Stato immobile<select name="condition" defaultValue={property?.condition ?? ""} className={inputClass}><option value="">Non indicato</option><option value="new">Nuovo</option><option value="renovated">Ristrutturato</option><option value="normal">Normale</option><option value="to_renovate">Da ristrutturare</option><option value="poor">Scarso</option></select></label>
    </div>
    <details className="mt-5 rounded-[9px] border border-[var(--line-soft)]" open={Boolean(property)}>
      <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-bold text-[var(--ink-strong)]">Posizione e dettagli facoltativi</summary>
      <div className="border-t border-[var(--line-soft)] p-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Superficie commerciale<input name="commercial_sqm" type="number" min="0" step="any" defaultValue={property?.commercial_sqm ?? ""} className={inputClass} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Camere<input name="bedrooms" type="number" min="0" step="any" defaultValue={property?.bedrooms ?? ""} className={inputClass} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Bagni<input name="bathrooms" type="number" min="0" step="any" defaultValue={property?.bathrooms ?? ""} className={inputClass} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Piano<input name="floor" type="number" step="any" defaultValue={property?.floor ?? ""} className={inputClass} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Piani edificio<input name="building_floors" type="number" min="0" step="any" defaultValue={property?.building_floors ?? ""} className={inputClass} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Disponibilità<select name="availability_status" defaultValue={property?.availability_status ?? ""} className={inputClass}><option value="">Non indicata</option><option value="available_now">Subito</option><option value="available_at_deed">Al rogito</option><option value="occupied">Occupato</option><option value="rented">Locato</option><option value="future_availability">Futura</option></select></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Disponibile dal<input name="available_from" type="date" defaultValue={property?.available_from ?? ""} className={inputClass} /></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Stato incarico<select name="mandate_status" defaultValue={property?.mandate_status ?? "active"} className={inputClass}><option value="draft">Bozza</option><option value="active">Attivo</option><option value="suspended">Sospeso</option><option value="expired">Scaduto</option><option value="sold">Venduto</option><option value="rented">Affittato</option><option value="archived">Archiviato</option></select></label>
      <label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">ID gestionale<input name="external_crm_id" defaultValue={property?.external_crm_id ?? ""} className={inputClass} /></label>
      </div>
    <div className="mt-5"><h3 className="text-sm font-semibold text-[var(--ink-strong)]">Caratteristiche</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{features.filter((feature) => feature.field_type === "boolean").map((feature) => <label key={feature.id} className="flex min-h-10 items-center gap-2 rounded-[7px] border border-[var(--line-soft)] px-3 text-sm text-[var(--ink-soft)]"><input name={`feature_${feature.id}`} type="checkbox" defaultChecked={Boolean(values[feature.id])} />{feature.label}</label>)}</div></div>
    <section className="mt-5 overflow-hidden rounded-[9px] border border-[var(--line-soft)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] px-4 py-3">
        <div><h3 className="text-sm font-semibold text-[var(--ink-strong)]">Posizione immobiliare</h3><p className="mt-1 text-xs text-[var(--ink-soft)]">Clicca il punto esatto. La zona immobiliare viene assegnata dal suo perimetro, mai dalle aree operative degli agenti.</p></div>
        {latitude != null && longitude != null ? <button type="button" onClick={() => { setLatitude(null); setLongitude(null); }} className="text-xs font-bold text-[var(--ink-soft)]">Rimuovi punto</button> : null}
      </div>
      <div className="p-2">
        <ZoneMap
          compact
          shapes={zones.filter((zone) => zone.geometry).map((zone) => ({ shapeId: zone.id, zoneId: zone.id, zoneNumber: zone.zone_number, name: zone.name, color: zone.color, geometry: zone.geometry! }))}
          highlightedZoneId={selectedZone || null}
          point={latitude != null && longitude != null ? { latitude, longitude } : null}
          allowPointSelection
          onPointChange={(point) => {
            setLatitude(point.latitude);
            setLongitude(point.longitude);
            const detected = zoneContainingPoint(zones, point);
            if (detected) setSelectedZone(detected.id);
          }}
        />
      </div>
    </section>
    <div className="mt-5 grid gap-3 md:grid-cols-2"><label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Descrizione<textarea name="description" rows={4} defaultValue={property?.description ?? ""} className={`${inputClass} h-auto py-2`} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Note interne<textarea name="notes" rows={4} defaultValue={property?.notes ?? ""} className={`${inputClass} h-auto py-2`} /></label></div>
      </div>
    </details>
    <button disabled={pending} className="mt-5 min-h-10 rounded-[8px] bg-[var(--surface-accent)] px-5 text-sm font-bold text-[var(--button-ink)]">{pending ? "Salvataggio…" : "Salva immobile"}</button>
  </form></div>;
}

export function ZoneEditor({ zones }: Readonly<{ zones: InternalZone[] }>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<InternalZone | null>(null);
  function submit(formData: FormData) {
    const split = (key: string) => String(formData.get(key) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    start(async () => {
      await saveZoneAction({ id: editing?.id, name: formData.get("name"), description: formData.get("description") || null, landmarks: split("landmarks"), aliases: split("aliases"), associated_streets: split("streets"), geometry: editing?.geometry ?? null, color: editing?.color ?? "#5fbf7a", is_active: formData.get("is_active") === "on" });
      setEditing(null); router.refresh();
    });
  }
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"><div className="space-y-3">{zones.map((zone) => <button type="button" onClick={() => setEditing(zone)} key={zone.id} className="block w-full rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-4 text-left"><div className="flex justify-between"><h2 className="font-semibold text-[var(--ink-strong)]">{zone.name}</h2><span className="text-xs text-[var(--ink-subtle)]">{zone.is_active ? "Attiva" : "Disattivata"}</span></div><p className="mt-2 text-sm text-[var(--ink-soft)]">{zone.description || "Nessuna descrizione"}</p><p className="mt-3 text-xs text-[var(--ink-subtle)]">{zone.associated_streets.length} vie · {zone.aliases.length} alias</p></button>)}{!zones.length ? <p className="rounded-[9px] border border-dashed border-[var(--line-soft)] p-8 text-center text-sm text-[var(--ink-soft)]">Nessuna zona. Crea il primo riferimento usato dall’ufficio.</p> : null}</div><form action={submit} key={editing?.id ?? "new"} className="h-fit rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5"><h2 className="font-semibold text-[var(--ink-strong)]">{editing ? "Modifica zona" : "Nuova zona"}</h2><div className="mt-4 space-y-3"><label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Nome<input name="name" required defaultValue={editing?.name} className={inputClass} /></label><label className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">Descrizione<textarea name="description" defaultValue={editing?.description ?? ""} className={`${inputClass} h-20 py-2`} /></label>{[["landmarks","Punti di riferimento"],["aliases","Alias"],["streets","Vie associate"]].map(([key,label]) => <label key={key} className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">{label} <span className="font-normal">(separati da virgola)</span><textarea name={key} defaultValue={(key === "landmarks" ? editing?.landmarks : key === "aliases" ? editing?.aliases : editing?.associated_streets)?.join(", ")} className={`${inputClass} h-16 py-2`} /></label>)}<label className="flex items-center gap-2 text-sm text-[var(--ink-soft)]"><input name="is_active" type="checkbox" defaultChecked={editing?.is_active ?? true} />Zona attiva</label></div><div className="mt-4 flex flex-wrap gap-2"><button disabled={pending} className="min-h-10 rounded-[7px] bg-[var(--surface-accent)] px-4 text-sm font-bold text-[var(--button-ink)]">Salva</button>{editing ? <><button type="button" onClick={() => setEditing(null)} className="min-h-10 rounded-[7px] border border-[var(--line-soft)] px-4 text-sm font-semibold text-[var(--ink-soft)]">Nuova</button><button type="button" onClick={() => { if (window.confirm("Eliminare questa zona? È possibile solo se non è utilizzata.")) start(async () => { await deleteZoneAction(editing.id); setEditing(null); router.refresh(); }); }} className="min-h-10 rounded-[7px] border border-red-400/40 px-4 text-sm font-semibold text-red-300">Elimina</button></> : null}</div></form></div>;
}

export function MatchingSettingsEditor({ features, config }: Readonly<{ features: FeatureDefinition[]; config: MatchingConfig }>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function saveConfig(formData: FormData) {
    start(async () => {
      await saveMatchingConfigAction({
        thresholds: { compatible: Number(formData.get("compatible")), almostCompatible: Number(formData.get("almost")), weak: Number(formData.get("weak")) },
        budgetTolerance: { near: Number(formData.get("near")) / 100, weak: Number(formData.get("toleranceWeak")) / 100 },
        commercialSqm: { minimumFactor: Number(formData.get("sqmMin")), maximumFactor: Number(formData.get("sqmMax")) },
      }); router.refresh();
    });
  }
  return <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]"><form action={saveConfig} className="h-fit rounded-[9px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-5"><h2 className="font-semibold text-[var(--ink-strong)]">Regole generali</h2><p className="mt-1 text-sm text-[var(--ink-soft)]">Le modifiche si applicano al prossimo ricalcolo.</p><div className="mt-5 grid grid-cols-2 gap-3">{[["compatible","Compatibile da",config.thresholds.compatible],["almost","Quasi da",config.thresholds.almostCompatible],["weak","Debole da",config.thresholds.weak],["near","Tolleranza vicina %",config.budgetTolerance.near*100],["toleranceWeak","Tolleranza debole %",config.budgetTolerance.weak*100],["sqmMin","Coeff. mq min",config.commercialSqm.minimumFactor],["sqmMax","Coeff. mq max",config.commercialSqm.maximumFactor]].map(([key,label,value]) => <label key={String(key)} className="grid gap-1 text-xs font-semibold text-[var(--ink-soft)]">{label}<input name={String(key)} type="number" step="any" defaultValue={Number(value)} className={inputClass} /></label>)}</div><button disabled={pending} className="mt-5 min-h-10 rounded-[7px] bg-[var(--surface-accent)] px-4 text-sm font-bold text-[var(--button-ink)]">Salva regole</button></form><div className="space-y-2">{features.map((feature) => <form key={feature.id} action={(formData) => start(async () => { await saveFeatureAction({ id: feature.id, key: feature.key, label: formData.get("label"), category: feature.category, field_type: feature.field_type, applies_to: feature.applies_to, default_weight: Number(formData.get("weight")), is_active: formData.get("active") === "on", sort_order: feature.sort_order }); router.refresh(); })} className="grid items-center gap-3 rounded-[8px] border border-[var(--line-soft)] bg-[var(--surface-panel)] p-3 sm:grid-cols-[1fr_100px_90px_auto]"><input name="label" defaultValue={feature.label} className={inputClass} /><input aria-label="Peso" name="weight" type="number" min="0" max="30" defaultValue={feature.default_weight} className={inputClass} /><label className="flex items-center gap-2 text-xs text-[var(--ink-soft)]"><input name="active" type="checkbox" defaultChecked={feature.is_active} />Attiva</label><button className="min-h-9 rounded-[7px] border border-[var(--line-soft)] px-3 text-xs font-bold text-[var(--ink-strong)]">Salva</button></form>)}</div></div>;
}
