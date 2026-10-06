import { randomUUID } from "node:crypto";
import type { CrmPersonSnapshot, CrmPropertySnapshot, CrmPropertySummary, ImportV2Plan, SourceProperty } from "../import-v2/model.js";
import type { MergeRequest, OwnershipWrite, OwnershipSyncOptions, TecnocloudV2Port } from "../import-v2/ports.js";
import { isManagedCrmOwnership } from "../import-v2/ownership-policy.js";
import type { PersonWriteModel } from "../import-v2/contacts.js";
import { sameCadastralIdentity } from "../import-v2/identity.js";
import type { Street } from "./model.js";
import { TerritoryStore } from "./store.js";
import { decideStreetProperty, type StreetPropertyFilters } from "../core/network-exploration.js";
import { runSettings } from "./run-options.js";

export type ScanSink = (source: SourceProperty) => Promise<void>;
export interface TerritoryProvider {
  origin: "simulation" | "live";
  beginOperation?(operation: "scan" | "compare" | "apply"): void;
  endOperation?(): void;
  scan(street: Street, runId: string, checkpoint: unknown, sink: ScanSink, save: (checkpoint: unknown) => Promise<void>, paused: () => boolean, filters?: StreetPropertyFilters): Promise<boolean>;
  candidates(street: Street, source: SourceProperty): Promise<{ rows: CrmPropertySummary[]; complete: boolean }>;
  port(): Promise<TecnocloudV2Port>;
  canWrite(key: string, source?: SourceProperty): boolean;
  authorizeWrite(source: SourceProperty, kind: "create" | "update"): void;
}

export function simulationSource(street: Street, index: number, runId: string): SourceProperty {
  return { sourcePropertyId: randomUUID(), jobId: runId, municipality: "BITONTO", fullAddress: `${street.name} ${index * 2}`, cadastral: { urbanSection: null, sheet: "LAB", parcel: street.id, parcelDenomination: null, subaltern: String(index), income: 250 }, category: "A/3", propertyClass: "2", consistency: "4 vani", activity: { enabled: false, description: null, contactMode: "Telefonata", status: "Da eseguire" }, owners: [{ sourcePersonId: "lab-owner", taxCode: index === 5 ? "DA_COMPLETARE" : "RSSMRA80A01A662A", fullName: "Rossi Mario", birthDate: null, birthPlace: null, birthProvince: null, rightType: "Propriet\u00e0", sharePercentage: 100, contacts: { phones: [], emails: [] } }] };
}

/** Persistent simulated CRM, exercised by the same Import V2 engine as real runs. */
export class SimulationProvider implements TerritoryProvider {
  readonly origin = "simulation" as const;
  constructor(private readonly store: TerritoryStore, private readonly delayMs = 120) {}
  canWrite() { return true; }
  authorizeWrite() {}
  async scan(street: Street, runId: string, checkpoint: unknown, sink: ScanSink, save: (checkpoint: unknown) => Promise<void>, paused: () => boolean, filters = runSettings().filters) {
    const prior = checkpoint as { next?: number } | null;
    const inventoryProperties = Array.from({ length: 6 }, (_, i) => {
      const source = simulationSource(street, i + 1, runId);
      return { municipality: source.municipality, sheet: source.cadastral.sheet, parcel: source.cadastral.parcel, subaltern: source.cadastral.subaltern, address: source.fullAddress, category: source.category };
    });
    const checkpointAt = (next: number) => ({ next, results: [{ outcome: "found", inventoryProperties }] });
    for (let index = prior?.next ?? 1; index <= 6; index++) {
      if (paused()) return false;
      if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
      const source = simulationSource(street, index, runId);
      const eligible = decideStreetProperty({ ...source.cadastral, municipality: source.municipality, address: `${street.name} N. ${index * 2} Piano ${index - 1}`, category: source.category!, class: source.propertyClass, consistency: source.consistency, cadastralIncome: source.cadastral.income, censusZone: null, rawPayload: {} }, filters).eligible;
      if (!eligible) { await save(checkpointAt(index + 1)); continue; }
      await sink(source);
      await this.store.change(state => {
        if (index !== 3 && index !== 4) return;
        const records = index === 4 ? 2 : 1;
        for (let n = 0; n < records; n++) {
          const id = `lab-${street.id}-${index}-${n}`;
          state.virtualCrm[id] ??= { id, displayName: source.fullAddress, fullAddress: source.fullAddress, cadastral: source.cadastral, owners: [] };
        }
      });
      await save(checkpointAt(index + 1));
    }
    return true;
  }
  async candidates(_street: Street, source: SourceProperty) {
    if (source.cadastral.subaltern === "6") return { rows: [], complete: false };
    return { rows: Object.values(this.store.read().virtualCrm).filter(r => sameCadastralIdentity({ ...source.cadastral, income: null }, r.cadastral ? { ...r.cadastral, income: null } : null)), complete: true };
  }
  async port(): Promise<TecnocloudV2Port> { return new VirtualCrmPort(this.store); }
}

class VirtualCrmPort implements TecnocloudV2Port {
  constructor(private readonly store: TerritoryStore) {}
  async assertSession() {}
  async searchPeopleByExactTaxCode(taxCode: string) { return Object.values(this.store.read().virtualPeople).filter(p => p.taxCode === taxCode); }
  async readPerson(id: string): Promise<CrmPersonSnapshot> { const p = this.store.read().virtualPeople[id]; if (!p) throw new Error("Nominativo di prova assente"); return p; }
  async createPerson(desired: PersonWriteModel) { const existing = (await this.searchPeopleByExactTaxCode(desired.taxCode))[0]; return this.overwritePerson(existing?.id ?? randomUUID(), desired); }
  async overwritePerson(id: string, desired: PersonWriteModel) {
    return this.store.change(s => { const p = { ...desired, id }; s.virtualPeople[id] = p; return structuredClone(p); });
  }
  async mergePeople(request: MergeRequest) { await this.store.change(s => { for (const id of request.duplicatePersonIds) delete s.virtualPeople[id]; }); return this.overwritePerson(request.canonicalPersonId, request.desired); }
  async listAllPropertiesForPeople(_ids: string[], plan: ImportV2Plan) { return this.findPropertiesByCadastralIdentity(plan); }
  async findPropertiesByCadastralIdentity(plan: ImportV2Plan) { return Object.values(this.store.read().virtualCrm).filter(p => sameCadastralIdentity(plan.source.cadastral, p.cadastral)); }
  async createProperty(plan: ImportV2Plan) { return this.updateProperty(randomUUID(), plan); }
  async updateProperty(id: string, plan: ImportV2Plan) {
    return this.store.change(s => { const p: CrmPropertySnapshot = { id, displayName: plan.source.fullAddress, fullAddress: plan.source.fullAddress, cadastral: plan.source.cadastral, owners: s.virtualCrm[id]?.owners ?? [] }; s.virtualCrm[id] = p; return structuredClone(p); });
  }
  async replaceManagedOwnerships(id: string, desired: OwnershipWrite[], options: OwnershipSyncOptions = {}) {
    return this.store.change(s => {
      const p = s.virtualCrm[id]; if (!p) throw new Error("Scheda di prova assente");
      const desiredIds = new Set(desired.map(d => d.personId));
      const preserved = p.owners.filter(owner => !desiredIds.has(owner.personId) && (options.keepUnlistedManagedOwners || !isManagedCrmOwnership(owner)));
      const removedPersonIds = p.owners.filter(owner => !desiredIds.has(owner.personId) && !preserved.includes(owner)).map(owner => owner.personId);
      p.owners = [...preserved, ...desired.map(d => ({ linkId: randomUUID(), personId: d.personId, taxCode: d.taxCode, sharePercentage: d.sharePercentage, rightType: "Propriet\u00e0", role: d.role }))];
      return { propertyId: id, owners: structuredClone(p.owners), removedPersonIds };
    });
  }
  async readProperty(id: string) { const p = this.store.read().virtualCrm[id]; if (!p) throw new Error("Scheda di prova assente"); return p; }
  async ensureActivity(propertyId: string, plan: ImportV2Plan) {
    if (!plan.source.activity.enabled) return { activityId: null, outcome: "disabled" as const };
    return this.store.change(s => {
      const activities = s.virtualActivities ??= {};
      const key = `${propertyId}|${plan.source.sourcePropertyId}`;
      if (activities[key]) return { activityId: activities[key].id, outcome: "existing" as const };
      const id = randomUUID();
      activities[key] = { id, propertyId, activity: structuredClone(plan.source.activity) };
      return { activityId: id, outcome: "created" as const };
    });
  }
  async recover() {}
}
