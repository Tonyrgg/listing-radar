import { personWriteModel } from "./contacts.js";
import { failureFromError, ImportV2Error } from "./errors.js";
import {
  buildPlan,
  canonicalEmail,
  canonicalPhone,
  canonicalPersonName,
  canonicalTaxCode,
  choosePropertyCandidate,
  formatPersonName,
  sameAddress,
  sameCadastralIdentity,
} from "./identity.js";
import type {
  CrmPersonSnapshot,
  CrmPropertySnapshot,
  ImportV2Checkpoint,
  ImportV2Failure,
  ImportV2Outcome,
  ImportV2Plan,
  ImportV2Stage,
  PersonResolution,
  SourceOwner,
  SourceProperty,
  SyncedPerson,
} from "./model.js";
import type { ImportV2Store, OwnershipWrite, TecnocloudV2Port } from "./ports.js";
import { isManagedCrmOwnership } from "./ownership-policy.js";

const NEXT_STAGE: Record<ImportV2Stage, ImportV2Stage> = {
  queued: "planned",
  planned: "people_resolved",
  people_resolved: "people_synced",
  people_synced: "property_resolved",
  property_resolved: "property_synced",
  property_synced: "ownerships_synced",
  ownerships_synced: "verified",
  verified: "activity_synced",
  activity_synced: "completed",
  completed: "completed",
};

export type ImportV2EngineOptions = {
  maxTransientAttempts: number;
  now?: () => Date;
  isInterruptionRequested?: () => boolean;
  /**
   * Con i comproprietari esclusi l'import si ferma all'intestatario con la
   * quota piu' alta: gli altri non vengono creati ne' collegati, e i
   * collegamenti gia' presenti nel gestionale restano dove sono.
   */
  includeCoOwners?: boolean | (() => boolean);
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function combinedExisting(matches: CrmPersonSnapshot[]): CrmPersonSnapshot | null {
  const canonical = [...matches].sort((left, right) => left.id.localeCompare(right.id))[0];
  if (!canonical) return null;
  return {
    ...canonical,
    phones: unique(matches.flatMap((match) => match.phones.map(canonicalPhone)).filter(Boolean)),
    emails: unique(matches.flatMap((match) => match.emails.map(canonicalEmail)).filter(Boolean)),
  };
}

function sameNullableText(left: string | null, right: string | null): boolean {
  return String(left ?? "").trim().toLocaleUpperCase("it-IT") === String(right ?? "").trim().toLocaleUpperCase("it-IT");
}

function samePersonName(left: string | null, right: string | null): boolean {
  return canonicalPersonName(left) === canonicalPersonName(right);
}

function assertPerson(source: SourceOwner, actual: CrmPersonSnapshot, expectedPhones: string[], expectedEmails: string[]): void {
  if (canonicalTaxCode(actual.taxCode) !== source.taxCode) {
    throw new ImportV2Error("Il nominativo riletto non ha il codice fiscale atteso", "verification_failed", { retryable: true });
  }
  if (source.fullName.trim() && !samePersonName(actual.fullName, source.fullName)) {
    throw new ImportV2Error("Il nominativo riletto non ha nome e cognome attesi", "verification_failed", { retryable: true });
  }
  for (const [field, expected, actualValue] of [
    ["data di nascita", source.birthDate, actual.birthDate],
    ["luogo di nascita", source.birthPlace, actual.birthPlace],
    ["provincia di nascita", source.birthProvince, actual.birthProvince],
  ] as const) {
    if (expected && !sameNullableText(actualValue, expected)) {
      throw new ImportV2Error(`Il nominativo riletto non ha ${field} atteso`, "verification_failed", { retryable: true });
    }
  }
  const actualPhones = new Set(actual.phones.map(canonicalPhone));
  if (expectedPhones.some((phone) => !actualPhones.has(canonicalPhone(phone)))) {
    throw new ImportV2Error("Uno o più numeri di telefono sono scomparsi durante il salvataggio", "verification_failed", { retryable: true });
  }
  const actualEmails = actual.emails.map(canonicalEmail).filter(Boolean).slice(0, 2);
  if (expectedEmails.some((email) => !actualEmails.includes(canonicalEmail(email)))) {
    throw new ImportV2Error("Le email attese non risultano salvate", "verification_failed", { retryable: true });
  }
}

function sharesEqual(left: number | null, right: number | null): boolean {
  if (left == null || right == null) return left == null && right == null;
  return Math.abs(left - right) < 0.01;
}

function assertOwnerships(
  property: CrmPropertySnapshot,
  desired: OwnershipWrite[],
  allowUnlistedManaged = false,
): void {
  const managedOwners = property.owners.filter(isManagedCrmOwnership);
  /* Con i comproprietari esclusi la scheda puo' portare collegamenti gestiti
   * che questo import non ha toccato: conta che ci siano tutti quelli attesi,
   * non che non ce ne siano altri. */
  const countMismatch = allowUnlistedManaged
    ? managedOwners.length < desired.length
    : managedOwners.length !== desired.length;
  if (countMismatch) {
    throw new ImportV2Error("Il numero di intestatari riletto non coincide con SISTER", "verification_failed", {
      retryable: true,
      details: { expected: desired.length, actual: managedOwners.length, ignoredOutOfScope: property.owners.length - managedOwners.length },
    });
  }
  for (const owner of desired) {
    const actual = managedOwners.find((candidate) => candidate.personId === owner.personId);
    if (!actual || !sharesEqual(actual.sharePercentage, owner.sharePercentage)) {
      throw new ImportV2Error("Intestatario o quota non coincidono con SISTER", "verification_failed", {
        retryable: true,
        details: { personId: owner.personId, expectedShare: owner.sharePercentage },
      });
    }
  }
}

export class ImportV2Engine {
  private readonly maxTransientAttempts: number;
  private readonly now: () => Date;
  private readonly isInterruptionRequested: () => boolean;
  private readonly includeCoOwners: () => boolean;

  constructor(
    private readonly crm: TecnocloudV2Port,
    private readonly store: ImportV2Store,
    options: Partial<ImportV2EngineOptions> = {},
  ) {
    this.maxTransientAttempts = Math.max(1, options.maxTransientAttempts ?? 3);
    this.now = options.now ?? (() => new Date());
    this.isInterruptionRequested = options.isInterruptionRequested ?? (() => false);
    const includeCoOwners = options.includeCoOwners ?? true;
    this.includeCoOwners = typeof includeCoOwners === "function" ? includeCoOwners : () => includeCoOwners;
  }

  /** Gli intestatari che questo import deve creare, collegare e verificare. */
  private ownersInScope(owners: SourceOwner[]): SourceOwner[] {
    return this.includeCoOwners() ? owners : [this.primaryOwner(owners)];
  }

  private throwIfInterruptionRequested(): void {
    if (this.isInterruptionRequested()) {
      throw new ImportV2Error("Import V2 messo in pausa dall'operatore", "operator_pause", {
        global: true,
        details: { pauseRequested: true },
      });
    }
  }

  async run(source: SourceProperty): Promise<ImportV2Outcome> {
    let plan;
    try {
      plan = buildPlan(source);
    } catch (error) {
      const failure = failureFromError(error, "queued", this.now());
      await this.store.quarantineSource(source, failure);
      return { itemId: source.sourcePropertyId, propertyId: source.sourcePropertyId, crmPropertyId: null, syncedPeople: [], state: "quarantined", stage: "queued", failure };
    }

    let checkpoint = await this.store.loadOrCreate(plan);
    while (checkpoint.stage !== "completed") {
      try {
        this.throwIfInterruptionRequested();
        await this.crm.assertSession();
        checkpoint = await this.executeStage(checkpoint);
        checkpoint.attempts = 0;
        checkpoint.lastError = null;
        checkpoint.nextAttemptAt = null;
        checkpoint.updatedAt = this.now().toISOString();
        await this.store.save(checkpoint);
        await this.store.recordEvent(checkpoint, "stage_completed", { stage: checkpoint.stage });
      } catch (error) {
        const failure = failureFromError(error, checkpoint.stage, this.now());
        checkpoint.attempts += 1;
        checkpoint.lastError = failure;
        checkpoint.updatedAt = this.now().toISOString();
        if (failure.global) {
          if (failure.kind === "operator_pause") {
            await this.crm.recover(checkpoint.stage, error).catch(() => undefined);
          }
          await this.store.pause(checkpoint, failure);
          return { itemId: checkpoint.itemId, propertyId: checkpoint.propertyId, crmPropertyId: checkpoint.crmPropertyId, syncedPeople: checkpoint.syncedPeople, state: "paused", stage: checkpoint.stage, failure };
        }
        if (failure.retryable && checkpoint.attempts < this.maxTransientAttempts) {
          this.throwIfInterruptionRequested();
          await this.store.save(checkpoint);
          await this.store.recordEvent(checkpoint, "retry_scheduled", { attempt: checkpoint.attempts, failure });
          await this.crm.recover(checkpoint.stage, error);
          continue;
        }
        await this.store.quarantine(checkpoint, failure);
        return { itemId: checkpoint.itemId, propertyId: checkpoint.propertyId, crmPropertyId: checkpoint.crmPropertyId, syncedPeople: checkpoint.syncedPeople, state: "quarantined", stage: checkpoint.stage, failure };
      }
    }
    return { itemId: checkpoint.itemId, propertyId: checkpoint.propertyId, crmPropertyId: checkpoint.crmPropertyId, syncedPeople: checkpoint.syncedPeople, state: "completed", stage: "completed", failure: null };
  }

  private async executeStage(checkpoint: ImportV2Checkpoint): Promise<ImportV2Checkpoint> {
    const plan = checkpoint.plan;
    if (!plan) throw new ImportV2Error("Checkpoint senza piano di importazione", "invalid_source");
    switch (checkpoint.stage) {
      case "queued":
        return { ...checkpoint, stage: NEXT_STAGE.queued };
      case "planned":
        return { ...checkpoint, people: await this.resolvePeople(this.ownersInScope(plan.source.owners)), stage: NEXT_STAGE.planned };
      case "people_resolved":
        return { ...checkpoint, syncedPeople: await this.syncPeople(this.ownersInScope(plan.source.owners), checkpoint), stage: NEXT_STAGE.people_resolved };
      case "people_synced": {
        const { choice, linkedCount, cadastralCount } = await this.resolveProperty(plan, checkpoint.syncedPeople);
        return {
          ...checkpoint,
          propertyResolution: choice.kind === "create"
            ? { kind: "create", propertyId: null, evidence: { linkedCount, cadastralCount } }
            : { kind: choice.kind, propertyId: choice.candidate.id, evidence: { candidate: choice.candidate } },
          stage: NEXT_STAGE.people_synced,
        };
      }
      case "property_resolved": {
        if (!checkpoint.propertyResolution) throw new ImportV2Error("Risoluzione immobile assente", "invalid_source");
        let resolution = checkpoint.propertyResolution;
        if (resolution.kind === "create") {
          // A previous create may have reached Tecnocloud before its local
          // checkpoint was persisted. Re-resolve before any second create.
          const fresh = await this.resolveProperty(plan, checkpoint.syncedPeople);
          if (fresh.choice.kind !== "create") {
            resolution = {
              kind: fresh.choice.kind,
              propertyId: fresh.choice.candidate.id,
              evidence: { recoveredAfterUncertainCreate: true, candidate: fresh.choice.candidate },
            };
          }
        }
        const saved = resolution.kind === "create"
          ? await this.crm.createProperty(plan, this.primaryPersonId(this.ownersInScope(plan.source.owners), checkpoint.syncedPeople))
          : await this.crm.updateProperty(resolution.propertyId, plan);
        return { ...checkpoint, crmPropertyId: saved.id, stage: NEXT_STAGE.property_resolved };
      }
      case "property_synced": {
        const propertyId = this.requirePropertyId(checkpoint);
        const owners = this.ownersInScope(plan.source.owners);
        await this.verifyPeopleBeforeOwnership(owners, checkpoint.syncedPeople);
        this.throwIfInterruptionRequested();
        await this.crm.replaceManagedOwnerships(propertyId, this.desiredOwnerships(owners, checkpoint.syncedPeople), {
          keepUnlistedManagedOwners: !this.includeCoOwners(),
        });
        return { ...checkpoint, stage: NEXT_STAGE.property_synced };
      }
      case "ownerships_synced": {
        const property = await this.crm.readProperty(this.requirePropertyId(checkpoint));
        if (!sameAddress(plan.source.fullAddress, property.fullAddress ?? property.displayName)
          || !sameCadastralIdentity(plan.source.cadastral, property.cadastral)) {
          throw new ImportV2Error("La rilettura dell'immobile non coincide con indirizzo e catasto SISTER", "verification_failed", { retryable: true });
        }
        assertOwnerships(property, this.desiredOwnerships(this.ownersInScope(plan.source.owners), checkpoint.syncedPeople), !this.includeCoOwners());
        return { ...checkpoint, stage: NEXT_STAGE.ownerships_synced };
      }
      case "verified":
        await this.crm.ensureActivity(this.requirePropertyId(checkpoint), plan);
        return { ...checkpoint, stage: NEXT_STAGE.verified };
      case "activity_synced":
        return { ...checkpoint, stage: NEXT_STAGE.activity_synced };
      case "completed":
        return checkpoint;
    }
  }

  private async resolvePeople(owners: SourceOwner[]): Promise<PersonResolution[]> {
    const resolutions: PersonResolution[] = [];
    for (const owner of owners) {
      this.throwIfInterruptionRequested();
      const matches = (await this.crm.searchPeopleByExactTaxCode(owner.taxCode))
        .filter((candidate) => canonicalTaxCode(candidate.taxCode) === owner.taxCode);
      resolutions.push({ sourcePersonId: owner.sourcePersonId, taxCode: owner.taxCode, matches });
    }
    return resolutions;
  }

  private async syncPeople(owners: SourceOwner[], checkpoint: ImportV2Checkpoint): Promise<SyncedPerson[]> {
    const synced: SyncedPerson[] = [...checkpoint.syncedPeople];
    for (const owner of owners) {
      this.throwIfInterruptionRequested();
      if (synced.some((person) => person.sourcePersonId === owner.sourcePersonId && person.taxCode === owner.taxCode)) continue;
      const checkpointResolution = checkpoint.people.find((candidate) => candidate.sourcePersonId === owner.sourcePersonId);
      if (!checkpointResolution) throw new ImportV2Error("Risoluzione nominativo mancante", "invalid_source");
      // The stored resolution is evidence, not an instruction. A merge/create
      // may have succeeded immediately before a crash, so identity is reread.
      const liveMatches = (await this.crm.searchPeopleByExactTaxCode(owner.taxCode))
        .filter((candidate) => canonicalTaxCode(candidate.taxCode) === owner.taxCode);
      const existing = combinedExisting(liveMatches);
      const desired = personWriteModel(owner, existing);
      let saved: CrmPersonSnapshot;
      let mergePerformed = false;
      if (!existing) {
        saved = await this.crm.createPerson(desired);
      } else if (liveMatches.length === 1) {
        saved = await this.crm.overwritePerson(existing.id, desired);
      } else {
        saved = await this.crm.mergePeople({
          taxCode: owner.taxCode,
          canonicalPersonId: existing.id,
          duplicatePersonIds: liveMatches.filter((match) => match.id !== existing.id).map((match) => match.id),
          fieldSelection: "all_left",
          desired,
        });
        mergePerformed = true;
      }
      const after = (await this.crm.searchPeopleByExactTaxCode(owner.taxCode))
        .filter((candidate) => canonicalTaxCode(candidate.taxCode) === owner.taxCode);
      if (after.length > 1) {
        throw new ImportV2Error("Dopo il salvataggio il codice fiscale identifica ancora più nominativi", "verification_failed", {
          retryable: true,
          details: { taxCode: owner.taxCode, candidateIds: after.map((candidate) => candidate.id) },
        });
      }
      /* La ricerca globale Salesforce può restituire zero risultati nei
       * secondi immediatamente successivi a create/overwrite/merge. La scheda
       * restituita dal salvataggio è già stata aperta tramite ID e riletta dal
       * port: zero è quindi ritardo d'indicizzazione, non autorizzazione a
       * creare un secondo nominativo. Più di uno resta invece un errore. */
      if (after.length === 1) saved = after[0]!;
      assertPerson(owner, saved, desired.phones, desired.emails);
      synced.push({ sourcePersonId: owner.sourcePersonId, taxCode: owner.taxCode, crmPersonId: saved.id, mergePerformed });
      // Preserve each verified person before moving to the next. A later
      // owner's transient error must not replay successful writes/merges.
      checkpoint.syncedPeople = [...synced];
      checkpoint.updatedAt = this.now().toISOString();
      await this.store.save(checkpoint);
    }
    return synced;
  }

  private desiredOwnerships(owners: SourceOwner[], synced: SyncedPerson[]): OwnershipWrite[] {
    const primarySourcePersonId = this.primaryOwner(owners).sourcePersonId;
    return owners.map((owner) => {
      const person = synced.find((candidate) => candidate.sourcePersonId === owner.sourcePersonId);
      if (!person) throw new ImportV2Error("Nominativo sincronizzato mancante", "invalid_source");
      return {
        personId: person.crmPersonId,
        taxCode: owner.taxCode,
        fullName: formatPersonName(owner.fullName),
        sharePercentage: owner.sharePercentage,
        role: owner.sourcePersonId === primarySourcePersonId ? "Proprietario Principale" : "Comproprietario",
      };
    });
  }

  private async verifyPeopleBeforeOwnership(owners: SourceOwner[], synced: SyncedPerson[]): Promise<void> {
    for (const owner of owners) {
      this.throwIfInterruptionRequested();
      const person = synced.find((candidate) => candidate.sourcePersonId === owner.sourcePersonId && candidate.taxCode === owner.taxCode);
      if (!person) throw new ImportV2Error("Nominativo sincronizzato mancante", "invalid_source");
      const snapshot = await this.crm.readPerson(person.crmPersonId, owner.taxCode);
      if (snapshot.id !== person.crmPersonId
        || canonicalTaxCode(snapshot.taxCode) !== owner.taxCode
        || (owner.fullName.trim() && !samePersonName(snapshot.fullName, owner.fullName))) {
        throw new ImportV2Error("Il comproprietario non è verificato tramite ID, codice fiscale, nome e cognome", "verification_failed", {
          retryable: true,
          details: { sourcePersonId: owner.sourcePersonId, crmPersonId: person.crmPersonId },
        });
      }
    }
  }

  private primaryOwner(owners: SourceOwner[]): SourceOwner {
    const indexed = owners.map((owner, index) => ({ owner, index }));
    indexed.sort((left, right) => {
      const share = (right.owner.sharePercentage ?? -1) - (left.owner.sharePercentage ?? -1);
      return share || left.index - right.index;
    });
    const primary = indexed[0]?.owner;
    if (!primary) throw new ImportV2Error("Immobile senza proprietario principale", "invalid_source");
    return primary;
  }

  private primaryPersonId(owners: SourceOwner[], synced: SyncedPerson[]): string {
    const primary = this.primaryOwner(owners);
    const person = synced.find((candidate) => candidate.sourcePersonId === primary.sourcePersonId);
    if (!person) throw new ImportV2Error("Nominativo principale sincronizzato mancante", "invalid_source");
    return person.crmPersonId;
  }

  private async resolveProperty(plan: ImportV2Plan, people: SyncedPerson[]) {
    const personIds = people.map((person) => person.crmPersonId);
    // Both operations navigate the same Tecnocloud tab; overlapping them is a
    // race between two unrelated pages and was the source of random stalls.
    const cadastral = await this.crm.findPropertiesByCadastralIdentity(plan);
    const exact = cadastral.filter((candidate) => sameAddress(plan.source.fullAddress, candidate.fullAddress ?? candidate.displayName)
      && sameCadastralIdentity(plan.source.cadastral, candidate.cadastral));
    // The global search already covers all owners, including former owners.
    // Only an exact, unambiguous identity can avoid the linked-list fallback.
    if (exact.length) return {
      choice: choosePropertyCandidate(plan.source, cadastral),
      linkedCount: 0,
      cadastralCount: cadastral.length,
    };
    this.throwIfInterruptionRequested();
    const linked = await this.crm.listAllPropertiesForPeople(personIds, plan);
    return {
      choice: choosePropertyCandidate(plan.source, [...linked, ...cadastral]),
      linkedCount: linked.length,
      cadastralCount: cadastral.length,
    };
  }

  private requirePropertyId(checkpoint: ImportV2Checkpoint): string {
    if (!checkpoint.crmPropertyId) throw new ImportV2Error("Identificativo immobile CRM mancante", "invalid_source");
    return checkpoint.crmPropertyId;
  }
}
