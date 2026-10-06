import { randomUUID } from "node:crypto";
import { normalizeSisterStreet } from "../core/street-scan.js";
import { stripSisterMunicipalityPrefix } from "../core/normalize.js";
import { addressIdentity, buildPlan } from "../import-v2/identity.js";
import { importV2Sources } from "../import-v2/source.js";
import { isAcquisitionExcluded } from "../services/acquisition-queue.js";
import type { SourceProperty } from "../import-v2/model.js";
import type { HistorySnapshot, HistoryJob } from "./history-source.js";
import { type HistoricalWork, type Street, type TerritoryState, unitKey, latest } from "./model.js";
import type { TerritoryStore } from "./store.js";
import type { SisterStreetRunCheckpoint } from "../services/sister-street-run.js";
import { territoryDigest } from "./sync.js";

export type HistoryMappings = Record<string, string>;
const sourceRevision = (source: SourceProperty) => territoryDigest({ ...source, owners: [...source.owners].sort((a, b) => a.sourcePersonId.localeCompare(b.sourcePersonId)) });
const timestamp = (value: string | null | undefined, fallback: string) => value && Number.isFinite(Date.parse(value)) ? value : fallback;
const importProof = (item: HistoryJob["items"][number] | undefined, property: HistoryJob["graph"]["properties"][number], job: HistoryJob["job"], source: SourceProperty) => {
  const crmId = item?.checkpoint?.crmPropertyId ?? property.crm_record_id ?? null;
  let compatible = true;
  if (item?.plan) {
    try { compatible = buildPlan(item.plan.source).fingerprint === buildPlan(source).fingerprint; }
    catch { compatible = false; }
  }
  const verified = compatible && item?.stage === "completed" && item.status === "completed" && !item.last_error && Boolean(crmId);
  const date = item?.completed_at ?? job.completed_at;
  return { crmId, verified, at: verified && date && Number.isFinite(Date.parse(date)) ? date : null };
};
const acquisitionComplete = (job: HistoryJob["job"]) => job.status === "completed" || ["acquisition_reviewed", "properties_processed", "verified", "completed"].includes(job.last_completed_step ?? "");
function historicalSources(entry: HistoryJob) {
  const graph = { ...entry.graph, properties: entry.graph.properties.map(p => ({ ...p, raw_payload: { ...p.raw_payload, import_v2: undefined } })) };
  return new Map(importV2Sources(entry.job, graph, () => ({ enabled: false, description: null, contactMode: "Telefonata", status: "Da eseguire" }), { businessOwnerRowIndexes: new Set(entry.ignoredBusinessRows) }).map(source => [source.sourcePropertyId, source]));
}

/** The inventory precedes filtering. Duplicate result rows count as one unit. */
function acquisitionInventory(entry: HistoryJob, state: TerritoryState, sources: Map<string, SourceProperty>) {
  const checkpoint = entry.job.acquisition?.acquisitionCheckpoint as SisterStreetRunCheckpoint | undefined;
  if (!checkpoint?.results?.length) return null;
  const inventory: Record<string, string[]> = {};
  let unresolved = false;
  const add = (municipality: string, sheet: string, parcel: string, subaltern: string, address: string | null) => {
    if (municipality.toUpperCase() !== "BITONTO" || !sheet || !parcel || !address) { unresolved = true; return; }
    const source = [...sources.values()].find(source => source.municipality === municipality && source.cadastral.sheet === sheet && source.cadastral.parcel === parcel && source.cadastral.subaltern === subaltern);
    const probe: SourceProperty = source ?? { sourcePropertyId: "inventory", jobId: entry.job.id, municipality, fullAddress: address, cadastral: { sheet, parcel, subaltern, income: null, urbanSection: null, parcelDenomination: null }, category: "", propertyClass: null, consistency: null, owners: [], activity: { enabled: false, description: null, contactMode: "Telefonata", status: "Da eseguire" } };
    const matches = matchHistoricalStreet({ ...probe, fullAddress: address }, state.streets);
    if (matches.length !== 1) { unresolved = true; return; }
    // A cadastral lot without a subaltern can be counted in the inventory,
    // while remaining blocked by Import V2's stricter writing requirements.
    const key = [municipality, probe.cadastral.urbanSection ?? "", sheet, parcel, subaltern].map(x => x.trim().toUpperCase()).join("|");
    (inventory[matches[0]!.id] ??= []).push(key);
  };
  let available = false;
  for (const result of checkpoint.results) {
    if (result.inventoryProperties) {
      available = true;
      for (const property of result.inventoryProperties) add(property.municipality, property.sheet, property.parcel, property.subaltern, property.address);
    } else if (result.recordLedger?.length) {
      available = true;
      for (const row of result.recordLedger) {
        const [municipality, sheet, parcel, subaltern] = row.key.split("|");
        add(municipality ?? "", sheet ?? "", parcel ?? "", subaltern ?? "", row.label.split(" · F. ")[0] ?? null);
      }
    } else if (result.outcome !== "empty") unresolved = true;
  }
  if (!available) return null;
  for (const id of Object.keys(inventory)) inventory[id] = [...new Set(inventory[id])];
  return { inventory, complete: checkpoint.status === "completed" && !unresolved && checkpoint.results.every(result => ["found", "empty"].includes(result.outcome)) };
}

/** Upgrade only evidence already present in a local export, without replay or reassessment. */
export function hydrateHistoryProgress(state: TerritoryState, snapshot: HistorySnapshot) {
  if (snapshot.version !== 1 || snapshot.readOnly !== true || !Array.isArray(snapshot.jobs)) throw new Error("Esportazione storico non riconosciuta");
  for (const entry of snapshot.jobs) {
    const record = state.history?.find(h => h.id === entry.job.id); if (!record) continue;
    record.acquiredAt ??= timestamp(entry.job.created_at ?? entry.job.started_at, record.at);
    record.acquisitionComplete ??= acquisitionComplete(entry.job);
    const sources = historicalSources(entry), items = new Map(entry.items.map(i => [i.property_id, i]));
    for (const property of entry.graph.properties) {
      const source = sources.get(property.id); if (!source) continue;
      const revision = sourceRevision(source);
      const proof = importProof(items.get(property.id), property, entry.job, source);
      if (!proof.verified || !proof.crmId) continue;
      const issue = record.issues.find(i => i.propertyId === property.id && i.source && sourceRevision(i.source) === revision);
      if (issue) { issue.importVerified = true; issue.verifiedAt = proof.at; issue.crmId = proof.crmId; }
      for (const unit of Object.values(state.units)) for (const observation of unit.observations) if (observation.runId === `history:${entry.job.id}` && observation.historyPropertyId === property.id && sourceRevision(observation.source) === revision) {
        observation.importVerified = true; observation.crmId = proof.crmId;
        if (!observation.importedAt || (proof.at && Date.parse(proof.at) > Date.parse(observation.importedAt))) observation.importedAt = proof.at;
      }
    }
  }
}

function insertObservation(state: TerritoryState, source: SourceProperty, propertyId: string, jobId: string, streetId: string, at: string, exportedAt: string, verifiedAt: string | null, crmId: string | null, verified = Boolean(verifiedAt && crmId)) {
  const key = unitKey(source);
  const unit = state.units[key] ??= { key, streetIds: [], observations: [], corrections: {}, note: "", assessment: null, importedAt: null, crmId: null };
  if (!unit.streetIds.includes(streetId)) unit.streetIds.push(streetId);
  const revision = sourceRevision(source);
  const sameObservation = (o: typeof unit.observations[number]) => o.runId === `history:${jobId}` && o.historyPropertyId === propertyId && sourceRevision(o.source) === revision;
  const added = !unit.observations.some(sameObservation);
  if (added) {
    unit.observations.push({ at, runId: `history:${jobId}`, streetId, source, origin: "sister", historyPropertyId: propertyId, historyRevision: revision });
    unit.observations.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (latest(unit).historyPropertyId === propertyId) {
      unit.sourceVersionId = randomUUID();
      unit.assessment = { kind: "unknown", reason: verified ? "Import precedente concluso; serve una rilettura attuale del gestionale." : "Acquisizione precedente recuperata; presenza nel gestionale ancora da verificare.", checkedAt: exportedAt, candidateId: crmId, sourceId: source.sourcePropertyId };
    }
  }
  const observation = unit.observations.find(sameObservation)!;
  observation.streetId ??= streetId;
  if (verified && crmId) { observation.importVerified = true; observation.crmId = crmId; if (!observation.importedAt || (verifiedAt && Date.parse(verifiedAt) >= Date.parse(observation.importedAt))) observation.importedAt = verifiedAt; }
  if (verified && crmId) unit.crmId ??= crmId;
  if (verifiedAt && crmId && (!unit.importedAt || Date.parse(verifiedAt) >= Date.parse(unit.importedAt))) { unit.importedAt = verifiedAt; unit.crmId = crmId; }
  return added;
}
export function matchHistoricalStreet(source: SourceProperty, streets: Street[], explicit?: string) {
  if (explicit) { const street = streets.find(s => s.id === explicit && !s.needsReview && s.catalogKind !== "network"); if (!street) throw new Error("Codvia esplicito non valido"); return [street]; }
  const address = stripSisterMunicipalityPrefix(source.fullAddress, source.municipality);
  const identity = addressIdentity(address);
  // Street memory can recognise an exact official name without a civic.
  // This does not relax the stricter CRM property identity comparison.
  const name = normalizeSisterStreet(identity?.street ?? address.replace(/\s+(?:PIANO|SCALA|EDIFICIO|INTERNO)\b.*$/i, "").trim());
  if (!name) return [];
  return streets.filter(s => s.catalogKind !== "network" && !s.needsReview && [s.name, s.sisterName].some(n => normalizeSisterStreet(n) === name));
}

/** Imports observations, never resumes or replays the stable worker's checkpoints. */
export async function adoptHistory(store: TerritoryStore, snapshot: HistorySnapshot, mappings: HistoryMappings = {}) {
  if (snapshot.version !== 1 || snapshot.readOnly !== true || !Array.isArray(snapshot.jobs)) throw new Error("Esportazione storico non riconosciuta");
  if (Object.values(store.read().units).some(u => u.observations.some(o => o.origin === "simulation"))) throw new Error("Lo storico reale non entra nell'archivio simulato");
  const report = { jobs: 0, addedObservations: 0, importedEvidence: 0, issues: 0, units: 0 };
  await store.change(state => {
    if (state.runs.some(run => run.state === "running")) throw new Error("Attendi la fine delle operazioni del laboratorio");
    if (Object.values(state.checkpoints).some(checkpoint => checkpoint.stage !== "completed")) throw new Error("Riprendi prima gli import parziali del laboratorio");
    state.history ??= [];
    const jobs = [...snapshot.jobs].sort((a, b) => Date.parse(a.job.updated_at ?? a.job.created_at ?? snapshot.exportedAt) - Date.parse(b.job.updated_at ?? b.job.created_at ?? snapshot.exportedAt));
    for (const entry of jobs) {
      const { job, graph, items } = entry;
      const record: HistoricalWork = { id: job.id, streetIds: [], street: job.street, status: job.status, at: timestamp(job.updated_at ?? job.created_at, snapshot.exportedAt), completedAt: job.completed_at ?? null, acquired: graph.properties.length, imported: 0, associated: 0, issues: [] };
      record.acquiredAt = timestamp(job.created_at ?? job.started_at, record.at);
      record.acquisitionComplete = acquisitionComplete(job);
      const byId = new Map(items.map(item => [item.property_id, item]));
      // Completed/unsupported import markers do not delete the acquisition history.
      const sources = historicalSources(entry);
      const inventory = acquisitionInventory(entry, state, sources);
      if (inventory) { record.inventoryByStreet = inventory.inventory; record.inventoryComplete = inventory.complete; record.streetIds.push(...Object.keys(inventory.inventory)); }
      const jobStreet = state.streets.filter(s => s.catalogKind !== "network" && !s.needsReview && normalizeSisterStreet(s.sisterName) === normalizeSisterStreet(job.street ?? ""));
      if (jobStreet.length === 1 && !record.streetIds.includes(jobStreet[0]!.id)) record.streetIds.push(jobStreet[0]!.id);
      for (const property of graph.properties) {
        if (property.municipality.trim().toUpperCase() !== "BITONTO") { record.issues.push({ propertyId: property.id, address: property.address, reason: "Fuori dal Comune di Bitonto" }); continue; }
        const source = sources.get(property.id);
        if (!source || isAcquisitionExcluded(property)) { record.issues.push({ propertyId: property.id, address: property.address, reason: "Riga esclusa nell'acquisizione originale; conservata nello storico" }); continue; }
        try { unitKey(source); } catch { record.issues.push({ propertyId: property.id, address: property.address, reason: "Identità catastale incompleta" }); continue; }
        const item = byId.get(property.id);
        const { crmId: historicalCrmId, verified, at: verifiedAt } = importProof(item, property, job, source);
        const row = property as typeof property & { updated_at?: string; created_at?: string };
        // CRM checkpoint updates are not new SISTER observations. An older
        // import resumed today must never outrank yesterday's acquisition.
        const at = timestamp(row.created_at ?? job.started_at ?? job.created_at, record.acquiredAt ?? record.at);
        if (verified) { record.imported++; report.importedEvidence++; }
        const explicit = mappings[property.id] ?? state.historicalStreetMappings?.[property.id];
        const matches = matchHistoricalStreet(source, state.streets, explicit);
        if (matches.length !== 1) { record.issues.push({ propertyId: property.id, address: property.address, reason: matches.length ? "Nome presente su più Codvia: serve un'associazione esplicita" : "Via da associare all'inventario ufficiale", source, at, verifiedAt, crmId: historicalCrmId, importVerified: verified }); continue; }
        const street = matches[0]!;
        if (explicit) (state.historicalStreetMappings ??= {})[property.id] = street.id;
        if (!record.streetIds.includes(street.id)) record.streetIds.push(street.id);
        record.associated++;
        if (insertObservation(state, source, property.id, job.id, street.id, at, snapshot.exportedAt, verifiedAt, historicalCrmId, verified)) report.addedObservations++;
      }
      const prior = state.history.findIndex(h => h.id === job.id);
      if (prior < 0) state.history.push(record); else state.history[prior] = record;
      if (prior < 0) for (const streetId of record.streetIds) state.events.push({ id: randomUUID(), streetId, at: snapshot.exportedAt, text: `Storico recuperato: ${record.associated} immobili associati, ${record.imported} import precedenti conclusi` });
      report.jobs++; report.issues += record.issues.length;
    }
    report.units = Object.keys(state.units).length;
  });
  return report;
}

/** An explicit association, audited separately from automated name matching. */
export async function associateHistory(store: TerritoryStore, propertyId: string, streetId: string) {
  await store.change(state => {
    const street = state.streets.find(s => s.id === streetId && !s.needsReview && s.catalogKind !== "network");
    if (!street) throw new Error("Scegli una via valida dell'inventario");
    const job = state.history?.find(h => h.issues.some(i => i.propertyId === propertyId));
    const issue = job?.issues.find(i => i.propertyId === propertyId);
    if (!job || !issue?.source || !issue.at) throw new Error("Questa riga non può essere associata: resta conservata nello storico");
    if (state.runs.some(r => r.state === "running") || Object.values(state.checkpoints).some(c => c.stage !== "completed")) throw new Error("Concludi prima le operazioni parziali del laboratorio");
    const now = new Date().toISOString();
    insertObservation(state, issue.source, propertyId, job.id, street.id, issue.at, now, issue.verifiedAt ?? null, issue.crmId ?? null, issue.importVerified ?? Boolean(issue.verifiedAt && issue.crmId));
    job.issues = job.issues.filter(i => i.propertyId !== propertyId); job.associated++;
    (state.historicalStreetMappings ??= {})[propertyId] = street.id;
    if (!job.streetIds.includes(street.id)) job.streetIds.push(street.id);
    state.events.push({ id: randomUUID(), streetId, at: now, text: "Associazione storica al Codvia confermata manualmente", unitKey: unitKey(issue.source) });
  });
}
