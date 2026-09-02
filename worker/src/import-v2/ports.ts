import type {
  CrmPersonSnapshot,
  CrmPropertySnapshot,
  CrmPropertySummary,
  ImportV2Checkpoint,
  ImportV2Failure,
  ImportV2Plan,
  PersonResolution,
  PersonWriteModel,
  PropertyResolution,
  SourceOwner,
  SourceProperty,
  SyncedPerson,
} from "./public-types.js";

export type MergeRequest = {
  taxCode: string;
  canonicalPersonId: string;
  duplicatePersonIds: string[];
  fieldSelection: "all_left";
  desired: PersonWriteModel;
};

export type OwnershipWrite = {
  personId: string;
  taxCode: string;
  fullName: string;
  sharePercentage: number | null;
  role: "Proprietario Principale" | "Comproprietario";
};

export interface TecnocloudV2Port {
  assertSession(): Promise<void>;
  searchPeopleByExactTaxCode(taxCode: string): Promise<CrmPersonSnapshot[]>;
  createPerson(desired: PersonWriteModel): Promise<CrmPersonSnapshot>;
  overwritePerson(personId: string, desired: PersonWriteModel): Promise<CrmPersonSnapshot>;
  mergePeople(request: MergeRequest): Promise<CrmPersonSnapshot>;
  listAllPropertiesForPeople(personIds: string[], plan: ImportV2Plan): Promise<CrmPropertySummary[]>;
  findPropertiesByCadastralIdentity(plan: ImportV2Plan): Promise<CrmPropertySummary[]>;
  createProperty(plan: ImportV2Plan, primaryPersonId: string): Promise<CrmPropertySnapshot>;
  updateProperty(propertyId: string, plan: ImportV2Plan): Promise<CrmPropertySnapshot>;
  /** Replaces private full/bare ownerships; corporate and usufruct links survive untouched. */
  replaceManagedOwnerships(propertyId: string, desired: OwnershipWrite[]): Promise<CrmOwnershipSnapshotResult>;
  readProperty(propertyId: string): Promise<CrmPropertySnapshot>;
  ensureActivity(propertyId: string, plan: ImportV2Plan): Promise<{ activityId: string | null; outcome: "created" | "existing" | "disabled" }>;
  recover(stage: ImportV2Checkpoint["stage"], error: unknown): Promise<void>;
}

export type CrmOwnershipSnapshotResult = {
  propertyId: string;
  owners: Array<{ personId: string; taxCode: string | null; sharePercentage: number | null; rightType: string | null; role?: string | null }>;
  removedPersonIds: string[];
};

export interface ImportV2Store {
  loadOrCreate(plan: ImportV2Plan): Promise<ImportV2Checkpoint>;
  save(checkpoint: ImportV2Checkpoint): Promise<void>;
  recordEvent(checkpoint: ImportV2Checkpoint, event: string, details?: Record<string, unknown>): Promise<void>;
  quarantine(checkpoint: ImportV2Checkpoint, failure: ImportV2Failure): Promise<void>;
  pause(checkpoint: ImportV2Checkpoint, failure: ImportV2Failure): Promise<void>;
  quarantineSource(source: SourceProperty, failure: ImportV2Failure): Promise<void>;
}

export type { PersonResolution, PropertyResolution, SourceOwner, SyncedPerson };
