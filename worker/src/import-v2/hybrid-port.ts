import type { ImportV2Checkpoint, ImportV2Plan, PersonWriteModel } from "./public-types.js";
import type {
  CrmOwnershipSnapshotResult,
  MergeRequest,
  OwnershipSyncOptions,
  OwnershipWrite,
  TecnocloudV2Port,
} from "./ports.js";

export type TecnocloudOperation =
  | "search_people"
  | "read_person"
  | "create_person"
  | "overwrite_person"
  | "merge_people"
  | "list_person_properties"
  | "search_property_cadastral"
  | "create_property"
  | "update_property"
  | "replace_ownerships"
  | "read_property"
  | "ensure_activity";

export interface HttpCapabilityPolicy {
  supportsRead(operation: TecnocloudOperation): boolean;
  supportsVerifiedWrite(operation: TecnocloudOperation): boolean;
}

/**
 * HTTP is used only for a contract that has been observed and verified against
 * Tecnocloud. Unsupported operations stay on the independent UI driver.
 */
export class HybridTecnocloudV2Port implements TecnocloudV2Port {
  constructor(
    private readonly http: TecnocloudV2Port,
    private readonly ui: TecnocloudV2Port,
    private readonly capabilities: HttpCapabilityPolicy,
  ) {}

  assertSession() { return this.ui.assertSession(); }

  searchPeopleByExactTaxCode(taxCode: string) {
    return this.read("search_people", () => this.http.searchPeopleByExactTaxCode(taxCode), () => this.ui.searchPeopleByExactTaxCode(taxCode));
  }

  readPerson(personId: string, expectedTaxCode?: string | null) {
    return this.read("read_person", () => this.http.readPerson(personId, expectedTaxCode), () => this.ui.readPerson(personId, expectedTaxCode));
  }

  createPerson(desired: PersonWriteModel) {
    return this.write("create_person", () => this.http.createPerson(desired), () => this.ui.createPerson(desired));
  }

  overwritePerson(personId: string, desired: PersonWriteModel) {
    return this.write("overwrite_person", () => this.http.overwritePerson(personId, desired), () => this.ui.overwritePerson(personId, desired));
  }

  mergePeople(request: MergeRequest) {
    return this.write("merge_people", () => this.http.mergePeople(request), () => this.ui.mergePeople(request));
  }

  listAllPropertiesForPeople(personIds: string[], plan: ImportV2Plan) {
    return this.read("list_person_properties", () => this.http.listAllPropertiesForPeople(personIds, plan), () => this.ui.listAllPropertiesForPeople(personIds, plan));
  }

  findPropertiesByCadastralIdentity(plan: ImportV2Plan) {
    return this.read("search_property_cadastral", () => this.http.findPropertiesByCadastralIdentity(plan), () => this.ui.findPropertiesByCadastralIdentity(plan));
  }

  createProperty(plan: ImportV2Plan, primaryPersonId: string) {
    return this.write("create_property", () => this.http.createProperty(plan, primaryPersonId), () => this.ui.createProperty(plan, primaryPersonId));
  }

  updateProperty(propertyId: string, plan: ImportV2Plan) {
    return this.write("update_property", () => this.http.updateProperty(propertyId, plan), () => this.ui.updateProperty(propertyId, plan));
  }

  replaceManagedOwnerships(propertyId: string, desired: OwnershipWrite[], options?: OwnershipSyncOptions): Promise<CrmOwnershipSnapshotResult> {
    return this.write("replace_ownerships", () => this.http.replaceManagedOwnerships(propertyId, desired, options), () => this.ui.replaceManagedOwnerships(propertyId, desired, options));
  }

  readProperty(propertyId: string) {
    return this.read("read_property", () => this.http.readProperty(propertyId), () => this.ui.readProperty(propertyId));
  }

  ensureActivity(propertyId: string, plan: ImportV2Plan) {
    return this.write("ensure_activity", () => this.http.ensureActivity(propertyId, plan), () => this.ui.ensureActivity(propertyId, plan));
  }

  async recover(stage: ImportV2Checkpoint["stage"], error: unknown): Promise<void> {
    await this.ui.recover(stage, error);
  }

  private read<T>(operation: TecnocloudOperation, http: () => Promise<T>, ui: () => Promise<T>): Promise<T> {
    return this.capabilities.supportsRead(operation) ? http() : ui();
  }

  private write<T>(operation: TecnocloudOperation, http: () => Promise<T>, ui: () => Promise<T>): Promise<T> {
    return this.capabilities.supportsVerifiedWrite(operation) ? http() : ui();
  }
}
