export const IMPORT_V2_STAGES = [
  "queued",
  "planned",
  "people_resolved",
  "people_synced",
  "property_resolved",
  "property_synced",
  "ownerships_synced",
  "verified",
  "activity_synced",
  "completed",
] as const;

export type ImportV2Stage = (typeof IMPORT_V2_STAGES)[number];
export type ImportV2TerminalState = "completed" | "quarantined" | "paused";

export type SourceContact = {
  phones: string[];
  emails: string[];
};

export type SourceOwner = {
  sourcePersonId: string;
  taxCode: string;
  fullName: string;
  birthDate: string | null;
  birthPlace: string | null;
  birthProvince: string | null;
  rightType: string;
  sharePercentage: number | null;
  contacts: SourceContact;
  /** Set only for explicitly authorised production test records. */
  privateNotes?: string | null;
};

export type CadastralIdentity = {
  urbanSection: string | null;
  sheet: string;
  parcel: string;
  parcelDenomination: string | null;
  subaltern: string;
  income: number | null;
};

export type SourceProperty = {
  sourcePropertyId: string;
  jobId: string;
  municipality: string;
  fullAddress: string;
  cadastral: CadastralIdentity;
  category: string;
  propertyClass: string | null;
  consistency: string | null;
  /** Evidence persisted by SISTER acquisition even though companies are not imported. */
  hasBusinessOwners?: boolean;
  activity: {
    enabled: boolean;
    description: string | null;
    contactMode: "Telefonata" | "Contatto diretto";
    status: "Da eseguire" | "Eseguito";
  };
  owners: SourceOwner[];
  /** Set only for explicitly authorised production test records. */
  cadastralNotes?: string | null;
};

export type CrmPersonSnapshot = {
  id: string;
  taxCode: string;
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  birthDate: string | null;
  birthPlace: string | null;
  birthProvince: string | null;
  phones: string[];
  emails: string[];
};

export type CrmPropertySummary = {
  id: string;
  displayName: string;
  fullAddress: string | null;
  cadastral: CadastralIdentity | null;
};

export type CrmOwnershipSnapshot = {
  linkId: string;
  personId: string;
  taxCode: string | null;
  sharePercentage: number | null;
  rightType: string | null;
  role?: string | null;
};

export type CrmPropertySnapshot = CrmPropertySummary & {
  owners: CrmOwnershipSnapshot[];
};

export type PersonResolution = {
  sourcePersonId: string;
  taxCode: string;
  matches: CrmPersonSnapshot[];
};

export type SyncedPerson = {
  sourcePersonId: string;
  taxCode: string;
  crmPersonId: string;
  mergePerformed: boolean;
};

export type PropertyResolution =
  | { kind: "create"; propertyId: null; evidence: Record<string, unknown> }
  | { kind: "exact" | "address_update"; propertyId: string; evidence: Record<string, unknown> };

export type ImportV2Plan = {
  version: 2;
  fingerprint: string;
  source: SourceProperty;
};

export type ImportV2Checkpoint = {
  itemId: string;
  jobId: string;
  propertyId: string;
  stage: ImportV2Stage;
  plan: ImportV2Plan | null;
  people: PersonResolution[];
  syncedPeople: SyncedPerson[];
  propertyResolution: PropertyResolution | null;
  crmPropertyId: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: ImportV2Failure | null;
  updatedAt: string;
};

export type ImportV2FailureKind =
  | "invalid_source"
  | "ambiguous_identity"
  | "transient_portal"
  | "global_session"
  | "global_portal"
  | "verification_failed"
  | "unsupported_case";

export type ImportV2Failure = {
  kind: ImportV2FailureKind;
  message: string;
  retryable: boolean;
  global: boolean;
  stage: ImportV2Stage;
  details: Record<string, unknown>;
  occurredAt: string;
};

export type ImportV2Outcome = {
  itemId: string;
  propertyId: string;
  crmPropertyId: string | null;
  syncedPeople: SyncedPerson[];
  state: ImportV2TerminalState;
  stage: ImportV2Stage;
  failure: ImportV2Failure | null;
};
