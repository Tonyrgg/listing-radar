import {crmRecordKind,assertOrdinaryProperty} from "./record-protection.js";
import { performance } from "node:perf_hooks";
import { mergePrivateNotes, personWriteModel,personNeedsWrite } from "./contacts.js";
import {sameCrmRecordId} from '../core/crm-record-id.js';
import { isTransientCloudError } from "./cloud-retry.js";
import { failureFromError, ImportV2Error } from "./errors.js";
import {
  buildPlan,
  canonicalEmail,
  canonicalBirthPlace,
  canonicalPhone,
  canonicalPersonName,
  canonicalTaxCode,
  choosePropertyCandidate,
  formatPersonName,
  sameCrmPropertyAddress,
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
  CrmPropertySummary,
} from "./model.js";
import type { ImportV2Store, OwnershipWrite, TecnocloudV2Port } from "./ports.js";
import { isManagedCrmOwnership } from "./ownership-policy.js";
import {activityCoverage,activityPrimaryOwner,romeDay,validActivityCoverage,verifiedActivityFacts} from './activity-policy.js';
import {rememberVerifiedActivity,verifiedClientActivities,withClientActivityLock} from './activity-client-lock.js';
import type {ActivityClaim,ActivityWriteGuard} from './activity-write-guard.js';

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
const timingMs = (elapsed: number) => Math.max(0, Math.round(elapsed * 1000) / 1000);

export type ImportV2EngineOptions = {
  activityWriteGuard?:ActivityWriteGuard;
  requireSharedActivityGuard?:boolean;
  skipUnchangedPeople?:boolean;
  calendarActivityPolicy?:boolean;
  /** Shared durable facts, including uncertain saves on other properties. */
  relatedActivityCheckpoints?:()=>ImportV2Checkpoint[];
  replaceUnlistedPrimary?: boolean;
  maxTransientAttempts: number;
  now?: () => Date;
  isInterruptionRequested?: () => boolean;
  /**
   * Con i comproprietari esclusi l'import si ferma all'intestatario con la
   * quota piu' alta: gli altri non vengono creati ne' collegati, e i
   * collegamenti gia' presenti nel gestionale restano dove sono.
   */
  includeCoOwners?: boolean | (() => boolean);
  /**
   * Optional property-first inventory. Refinement runs use the CRM street
   * inventory collected before touching people, while the ordinary import
   * keeps its historical cadastral/person lookup path unchanged.
   */
  propertyCandidates?: (plan: ImportV2Plan) => Promise<CrmPropertySummary[]>;
  /** Never create a CRM property when the property-first inventory has no match. */
  requireExistingProperty?: boolean;
  /** V2 only: prefer the registry import, otherwise the first equal cadastral identity. */
  preferRegistryDuplicates?: boolean;
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
    privateNotes: matches.reduce<string | null>((notes, match) => mergePrivateNotes(notes, match.privateNotes), null),
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
    const agrees = field === "luogo di nascita" ? canonicalBirthPlace(actualValue) === canonicalBirthPlace(expected) : sameNullableText(actualValue, expected);
    if (expected && !agrees) {
      throw new ImportV2Error(`Il nominativo riletto non ha ${field} atteso: SISTER ${expected}; Cloud ${actualValue || "non valorizzato"}`, "verification_failed", { retryable: true });
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
  private readonly propertyCandidates?: (plan: ImportV2Plan) => Promise<CrmPropertySummary[]>;
  private readonly requireExistingProperty: boolean;
  private readonly preferRegistryDuplicates: boolean;
  private readonly replaceUnlistedPrimary: boolean;
  private checkpointSaveElapsedMs = 0;
  private readonly calendarActivityPolicy:boolean;
  private readonly relatedActivityCheckpoints?:()=>ImportV2Checkpoint[];
  private readonly activityWriteGuard?:ActivityWriteGuard;
  private readonly requireSharedActivityGuard:boolean;
  private readonly skipUnchangedPeople:boolean;

  private async saveCheckpoint(checkpoint: ImportV2Checkpoint): Promise<void> {
    const startedAt = performance.now();
    try { await this.store.save(checkpoint); }
    finally { this.checkpointSaveElapsedMs += performance.now() - startedAt; }
  }

  constructor(
    private readonly crm: TecnocloudV2Port,
    private readonly store: ImportV2Store,
    options: Partial<ImportV2EngineOptions> = {},
  ) {
    this.maxTransientAttempts = Math.max(1, options.maxTransientAttempts ?? 3);
    this.calendarActivityPolicy=options.calendarActivityPolicy===true;
    this.relatedActivityCheckpoints=options.relatedActivityCheckpoints;
    this.activityWriteGuard=options.activityWriteGuard;
    this.requireSharedActivityGuard=options.requireSharedActivityGuard===true;
    this.skipUnchangedPeople=options.skipUnchangedPeople===true;
    this.now = options.now ?? (() => new Date());
    this.isInterruptionRequested = options.isInterruptionRequested ?? (() => false);
    const includeCoOwners = options.includeCoOwners ?? true;
    this.includeCoOwners = typeof includeCoOwners === "function" ? includeCoOwners : () => includeCoOwners;
    this.propertyCandidates = options.propertyCandidates;
    this.requireExistingProperty = options.requireExistingProperty === true;
    this.preferRegistryDuplicates = options.preferRegistryDuplicates === true;
    this.replaceUnlistedPrimary = options.replaceUnlistedPrimary === true;
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

  /**
   * `onStage` riceve lo stadio che sta per essere eseguito, cosi' chi guarda
   * la run sa a che punto e' senza dover leggere il database.
   */
  async run(
    source: SourceProperty,
    onStage?: (stage: ImportV2Stage, retry: { attempt: number; maxAttempts: number; previousFailure: ImportV2Failure | null }) => void,
  ): Promise<ImportV2Outcome> {
    let plan;
    try {
      plan = buildPlan(source);
    } catch (error) {
      const failure = failureFromError(error, "queued", this.now());
      await this.store.quarantineSource(source, failure);
      return { itemId: source.sourcePropertyId, propertyId: source.sourcePropertyId, crmPropertyId: null, syncedPeople: [], state: "quarantined", stage: "queued", failure };
    }

    let checkpoint: ImportV2Checkpoint;
    try {
      checkpoint = await this.store.loadOrCreate(plan);
    } catch (error) {
      // No durable checkpoint was read: stop before any CRM action and let
      // the next run reconcile a possibly committed load/create operation.
      if (!isTransientCloudError(error)) throw error;
      const failure = failureFromError(new ImportV2Error(
        "Supabase temporaneamente non raggiungibile. Ripresa disponibile senza scritture CRM.",
        "cloud_unavailable", { global: true, retryable: true, details: { checkpointLoaded: false } },
      ), "queued", this.now());
      return { itemId: source.sourcePropertyId, propertyId: source.sourcePropertyId, crmPropertyId: null, syncedPeople: [], state: "paused", stage: "queued", failure };
    }
    if (checkpoint.stage === "verified" && checkpoint.plan?.source.activity.enabled && !checkpoint.activityWrite) {
      // Before this version a crash after Save left no durable submission boundary.
      // Do not mistake a historical identical Task for that uncertain write.
      checkpoint.activityWrite = { operationId: checkpoint.itemId, preparedAt: checkpoint.updatedAt, submittedAt: checkpoint.updatedAt, baselineIds: [], legacyUncertain: true };
      await this.saveCheckpoint(checkpoint);
    }
    // A saved transition may have lost its audit response during a gateway
    // outage. Reconcile that deterministic event before any further CRM work.
    if (checkpoint.stage !== "queued") {
      try {
        await this.store.recordEvent(checkpoint, "stage_completed", { stage: checkpoint.stage });
      } catch (error) {
        const failure = failureFromError(new ImportV2Error(
          error instanceof Error ? error.message : "Audit Cloud non raggiungibile",
          "cloud_unavailable", { global: true, retryable: true },
        ), checkpoint.stage, this.now());
        return { itemId: checkpoint.itemId, propertyId: checkpoint.propertyId, crmPropertyId: checkpoint.crmPropertyId, syncedPeople: checkpoint.syncedPeople, state: "paused", stage: checkpoint.stage, failure };
      }
    }
    let sessionPreflightDone = false;
    while (checkpoint.stage !== "completed") {
      const executedStage = checkpoint.stage;
      const stageAttempt = checkpoint.attempts + 1;
      const stageStartedAt = performance.now();
      this.checkpointSaveElapsedMs = 0;
      let stageDurationMs = 0;
      let operationDurationMs = 0;
      let operationFinished = false;
      let checkpointSaveDurationMs = 0;
      let operationStartedAt = stageStartedAt;
      try {
        onStage?.(checkpoint.stage, {
          attempt: stageAttempt,
          maxAttempts: this.maxTransientAttempts,
          previousFailure: checkpoint.lastError,
        });
        this.throwIfInterruptionRequested();
        // The browser adapter checks the session before every CRM action and
        // navigation. Keep one engine-level preflight for port implementations
        // and tests, but do not repeat the same DOM probe at every checkpoint.
        if (!sessionPreflightDone) {
          await this.crm.assertSession();
          sessionPreflightDone = true;
        }
        operationStartedAt = performance.now();
        {
          const id=checkpoint.crmPropertyId ?? checkpoint.propertyResolution?.propertyId;
          if(id)await this.crm.assertPropertyWritable?.(id);
          else if(this.propertyCandidates){
            for(const candidate of await this.propertyCandidates(checkpoint.plan!)) {
              const kind=candidate.recordKind ?? crmRecordKind(candidate.displayName);
              if(kind==='news'||kind==='mandate')assertOrdinaryProperty(kind);
              await this.crm.assertPropertyWritable?.(candidate.id);
            }
          }
        }
        checkpoint = await this.executeStage(checkpoint);
        operationDurationMs = timingMs(performance.now() - operationStartedAt - this.checkpointSaveElapsedMs);
        operationFinished = true;
        checkpoint.attempts = 0;
        checkpoint.lastError = null;
        checkpoint.nextAttemptAt = null;
        checkpoint.updatedAt = this.now().toISOString();
        await this.saveCheckpoint(checkpoint);
        checkpointSaveDurationMs = timingMs(this.checkpointSaveElapsedMs);
        stageDurationMs = timingMs(performance.now() - stageStartedAt);
      } catch (error) {
        if (!operationFinished) operationDurationMs = timingMs(performance.now() - operationStartedAt - this.checkpointSaveElapsedMs);
        if (isTransientCloudError(error)) {
          const failure = failureFromError(new ImportV2Error(
            error instanceof Error ? error.message : "Supabase temporaneamente non raggiungibile",
            "cloud_unavailable", { global: true, retryable: true },
          ), checkpoint.stage, this.now());
          return { itemId: checkpoint.itemId, propertyId: checkpoint.propertyId, crmPropertyId: checkpoint.crmPropertyId, syncedPeople: checkpoint.syncedPeople, state: "paused", stage: checkpoint.stage, failure };
        }
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
          await this.saveCheckpoint(checkpoint);
          checkpointSaveDurationMs = timingMs(this.checkpointSaveElapsedMs);
          stageDurationMs = timingMs(performance.now() - stageStartedAt);
          await this.store.recordEvent(checkpoint, "retry_scheduled", { attempt: checkpoint.attempts, failure, executedStage, durationMs: stageDurationMs, operationDurationMs, checkpointSaveDurationMs });
          try { await this.crm.recover(checkpoint.stage, error); }
          catch (recoveryError) {
            const recoveryFailure = failureFromError(recoveryError, checkpoint.stage, this.now());
            if (recoveryFailure.global) await this.store.pause(checkpoint, recoveryFailure);
            else await this.store.quarantine(checkpoint, recoveryFailure);
            return { itemId: checkpoint.itemId, propertyId: checkpoint.propertyId, crmPropertyId: checkpoint.crmPropertyId, syncedPeople: checkpoint.syncedPeople, state: recoveryFailure.global ? "paused" : "quarantined", stage: checkpoint.stage, failure: recoveryFailure };
          }
          continue;
        }
        await this.store.quarantine(checkpoint, failure);
        // Leave the next property a clean dialog context; never repeat a save.
        await this.crm.recover(checkpoint.stage, error).catch(() => undefined);
        return { itemId: checkpoint.itemId, propertyId: checkpoint.propertyId, crmPropertyId: checkpoint.crmPropertyId, syncedPeople: checkpoint.syncedPeople, state: "quarantined", stage: checkpoint.stage, failure };
      }
      try {
        await this.store.recordEvent(checkpoint, "stage_completed", { stage: checkpoint.stage, executedStage, attempt: stageAttempt, durationMs: stageDurationMs, operationDurationMs, checkpointSaveDurationMs });
      } catch (error) {
        const failure = failureFromError(new ImportV2Error(
          error instanceof Error ? error.message : "Audit Cloud non raggiungibile",
          "cloud_unavailable", { global: true, retryable: true },
        ), checkpoint.stage, this.now());
        return { itemId: checkpoint.itemId, propertyId: checkpoint.propertyId, crmPropertyId: checkpoint.crmPropertyId, syncedPeople: checkpoint.syncedPeople, state: "paused", stage: checkpoint.stage, failure };
      }
    }
    onStage?.("completed", { attempt: 1, maxAttempts: this.maxTransientAttempts, previousFailure: null });
    return { itemId: checkpoint.itemId, propertyId: checkpoint.propertyId, crmPropertyId: checkpoint.crmPropertyId, syncedPeople: checkpoint.syncedPeople, state: "completed", stage: "completed", failure: null };
  }

  /** Close an unworkable row without sending any further writes to the CRM. */
  async deferForRefinement(source: SourceProperty, cause: ImportV2Failure): Promise<ImportV2Outcome> {
    let plan: ImportV2Plan;
    try { plan = buildPlan(source); }
    catch (error) {
      const failure = failureFromError(error, "queued", this.now());
      await this.store.quarantineSource(source, failure);
      return { itemId: source.sourcePropertyId, propertyId: source.sourcePropertyId, crmPropertyId: null, syncedPeople: [], state: "quarantined", stage: "queued", failure };
    }
    const checkpoint = await this.store.loadOrCreate(plan);
    if (checkpoint.stage === "completed") return { itemId: checkpoint.itemId, propertyId: checkpoint.propertyId, crmPropertyId: checkpoint.crmPropertyId, syncedPeople: checkpoint.syncedPeople, state: "completed", stage: "completed", failure: null };
    const failure = { ...cause, stage: checkpoint.stage, message: `Saltato, da rifinire: ${cause.message}`, details: { ...cause.details, closedWithoutFurtherWrites: true } };
    await this.store.quarantine(checkpoint, failure);
    return { itemId: checkpoint.itemId, propertyId: checkpoint.propertyId, crmPropertyId: checkpoint.crmPropertyId, syncedPeople: checkpoint.syncedPeople, state: "quarantined", stage: checkpoint.stage, failure };
  }

  private async executeStage(checkpoint: ImportV2Checkpoint): Promise<ImportV2Checkpoint> {
    const plan = checkpoint.plan;
    if (!plan) throw new ImportV2Error("Checkpoint senza piano di importazione", "invalid_source");
    switch (checkpoint.stage) {
      case "queued":
        return { ...checkpoint, stage: NEXT_STAGE.queued };
      case "planned": {
        let propertyResolution = checkpoint.propertyResolution;
        if (!propertyResolution && this.propertyCandidates) {
          const candidates = await this.propertyCandidates(plan);
          let choice = choosePropertyCandidate(plan.source, candidates, this.preferRegistryDuplicates);
          /* In existing-only mode the caller supplies candidates already
           * narrowed to the cadastral coordinates. Rendita and address are
           * values to refresh, not reasons to pretend that the unit is
           * missing. A single coordinate match is therefore updateable. */
          if (this.requireExistingProperty && choice.kind === "create" && candidates.length === 1) {
            choice = { kind: "cadastral_update", candidate: candidates[0]! };
          }
          if (this.requireExistingProperty && choice.kind === "create" && candidates.length > 1) {
            throw new ImportV2Error("Più immobili Cloud condividono la stessa terna catastale", "ambiguous_identity", {
              details: { candidateIds: candidates.map((candidate) => candidate.id) },
            });
          }
          if (choice.kind === "create" && this.requireExistingProperty) {
            throw new ImportV2Error(
              "Immobile non presente nell’inventario Cloud della via: la rifinitura non crea nuove schede",
              "unsupported_case",
              { details: { sourcePropertyId: plan.source.sourcePropertyId, cadastral: plan.source.cadastral, refinementNotPresent: true } },
            );
          }
          propertyResolution = choice.kind === "create"
            ? { kind: "create", propertyId: null, evidence: { inventoryCount: candidates.length } }
            : { kind: choice.kind, propertyId: choice.candidate.id, evidence: { candidate: choice.candidate, propertyFirst: true } };
        }
        return {
          ...checkpoint,
          propertyResolution,
          people: await this.resolvePeople(this.ownersInScope(plan.source.owners)),
          stage: NEXT_STAGE.planned,
        };
      }
      case "people_resolved":
        return { ...checkpoint, syncedPeople: await this.syncPeople(this.ownersInScope(plan.source.owners), checkpoint), stage: NEXT_STAGE.people_resolved };
      case "people_synced": {
        if (checkpoint.propertyResolution) return { ...checkpoint, stage: NEXT_STAGE.people_synced };
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
        if (resolution.kind === "create" && this.requireExistingProperty) {
          throw new ImportV2Error(
            "La rifinitura ha perso il riferimento all’immobile esistente e si è fermata prima di creare duplicati",
            "verification_failed",
            { global: true },
          );
        }
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
        const expectedPersonIds = checkpoint.syncedPeople.map((person) => person.crmPersonId).sort();
        const verifiedPersonIds = [...(checkpoint.ownershipVerifiedPersonIds ?? [])].sort();
        if (JSON.stringify(verifiedPersonIds) !== JSON.stringify(expectedPersonIds)) {
          await this.verifyPeopleBeforeOwnership(owners, checkpoint.syncedPeople);
          checkpoint.ownershipVerifiedPersonIds = expectedPersonIds;
          checkpoint.updatedAt = this.now().toISOString();
          // A relationship retry resumes here instead of reopening every
          // person record that was already verified successfully.
          await this.saveCheckpoint(checkpoint);
        }
        this.throwIfInterruptionRequested();
        const ownerships = await this.crm.replaceManagedOwnerships(propertyId, this.desiredOwnerships(owners, checkpoint.syncedPeople), {
          keepUnlistedManagedOwners: !this.includeCoOwners(),
          ...(this.replaceUnlistedPrimary ? { replaceUnlistedPrimary: true, sourceOwnerTaxCodes: plan.source.owners.map(owner => owner.taxCode) } : {}),
        });
        return { ...checkpoint, ownershipReplacement: ownerships.ownershipReplacement ?? checkpoint.ownershipReplacement, stage: NEXT_STAGE.property_synced };
      }
      case "ownerships_synced": {
        const property = await this.crm.readProperty(this.requirePropertyId(checkpoint));
        if (!sameCrmPropertyAddress(plan.source.fullAddress, property)
          || !sameCadastralIdentity(plan.source.cadastral, property.cadastral)) {
          throw new ImportV2Error("La rilettura dell'immobile non coincide con indirizzo e catasto SISTER", "verification_failed", { retryable: true });
        }
        assertOwnerships(property, this.desiredOwnerships(this.ownersInScope(plan.source.owners), checkpoint.syncedPeople), !this.includeCoOwners());
        return { ...checkpoint,
          ...(plan.source.activity.enabled&&!checkpoint.activityWrite?{activityWrite:{operationId:checkpoint.itemId,preparedAt:this.now().toISOString(),submittedAt:null,baselineIds:[]}}:{}),
          stage: NEXT_STAGE.ownerships_synced };
      }
      case "verified": {
        const client=this.primaryOwner(this.ownersInScope(plan.source.owners));
        return withClientActivityLock(client.taxCode,async()=>{
          this.throwIfInterruptionRequested();
          const completed=await this.completeActivity(checkpoint);
          if(completed.activityEvidence)rememberVerifiedActivity(completed.activityEvidence,this.now());
          return completed;
        });
      }
      case "activity_synced": {
        const evidence=checkpoint.activityEvidence;
        const satisfied=evidence&&(evidence.outcome==='covered'?validActivityCoverage(evidence,this.requirePropertyId(checkpoint))
          :evidence.outcome!=='disabled'&&evidence.descriptionVerified!==false&&evidence.statusVerified!==false);
        if (plan.source.activity.enabled && !satisfied) return { ...checkpoint, stage: "verified" };
        return { ...checkpoint, stage: NEXT_STAGE.activity_synced };
      }
      case "completed":
        return checkpoint;
    }
  }

  private async completeActivity(checkpoint:ImportV2Checkpoint):Promise<ImportV2Checkpoint>{
    const plan=checkpoint.plan!;
    if (plan.source.activity.enabled && !checkpoint.activityWrite) {
      checkpoint.activityWrite = { operationId: checkpoint.itemId, preparedAt: this.now().toISOString(), submittedAt: null, baselineIds: [] };
      await this.saveCheckpoint(checkpoint);
    }
    const propertyId=this.requirePropertyId(checkpoint);
    const primary=this.primaryOwner(this.ownersInScope(plan.source.owners));
    const clientId=this.primaryPersonId(this.ownersInScope(plan.source.owners),checkpoint.syncedPeople);
    let claim:ActivityClaim|undefined;
    let checkedHistory:import('./ports.js').ActivityWriteRequest['history'];
    if(plan.source.activity.enabled&&this.calendarActivityPolicy&&checkpoint.activityWrite?.submittedAt&&checkpoint.activityWrite.savedActivityId){
      // A known saved Task is a read-only recovery. It must not be held up by
      // an unrelated incomplete customer list, nor create a new activity.
      try{
        const recovered=await this.crm.ensureActivity(propertyId,plan,{client:{id:clientId,name:primary.fullName,taxCode:primary.taxCode,phones:primary.contacts.phones},
          state:structuredClone(checkpoint.activityWrite),persist:async state=>{checkpoint.activityWrite=structuredClone(state);await this.saveCheckpoint(checkpoint);}});
        if(recovered.activityId&&sameCrmRecordId(recovered.activityId,checkpoint.activityWrite.savedActivityId)&&recovered.descriptionVerified===true&&recovered.statusVerified===true
          &&sameCrmRecordId(recovered.clientId,clientId)&&sameCrmRecordId(recovered.propertyId,propertyId)&&recovered.activityDay){
          return {...checkpoint,activityEvidence:{...recovered,outcome:'existing',operationId:checkpoint.itemId},stage:NEXT_STAGE.verified};
        }
      }catch(error){const failure=failureFromError(error,'verified',this.now());if(failure.global)throw error;}
    }
    if(plan.source.activity.enabled&&this.calendarActivityPolicy){
      if(!this.crm.readActivityHistory)throw new ImportV2Error('Lettura dello storico attività non disponibile: attività da verificare','verification_failed');
      const current=this.now(),day=romeDay(current);
      checkpoint.activityWrite={...checkpoint.activityWrite!,clientId,clientTaxCode:primary.taxCode,activityDay:checkpoint.activityWrite?.submittedAt?checkpoint.activityWrite.activityDay??day:day};
      await this.saveCheckpoint(checkpoint);
      const related=this.relatedActivityCheckpoints?.()??[];
      const proven=activityCoverage({records:[...verifiedClientActivities(clientId,current),...verifiedActivityFacts(related)],propertyComplete:false,clientComplete:false,checkedAt:current.toISOString()},propertyId,clientId,current);
      if(proven)return {...checkpoint,activityEvidence:{...proven,operationId:checkpoint.itemId},stage:NEXT_STAGE.verified};
      let history=await this.crm.readActivityHistory(propertyId,clientId);
      if(!history.propertyComplete||!history.clientComplete){
        this.throwIfInterruptionRequested();
        history=await this.crm.readActivityHistory(propertyId,clientId);
      }
      const coverage=activityCoverage(history,propertyId,clientId,current);
      if(coverage){
        return {...checkpoint,activityEvidence:{...coverage,operationId:checkpoint.itemId},stage:NEXT_STAGE.verified};
      }
      if(!history.propertyComplete||!history.clientComplete)throw new ImportV2Error('Storico attività incompleto: non posso escludere attività già presenti nel mese o per il cliente oggi. Dati conservati, nessun nuovo inserimento.','verification_failed');
      checkedHistory={propertyId,clientId,baselineIds:history.records.filter(row=>sameCrmRecordId(row.propertyId,propertyId)).map(row=>row.id.slice(0,15)),checkedAt:history.checkedAt};
      const pending=related.find(other=>other.itemId!==checkpoint.itemId&&other.activityWrite?.submittedAt&&!verifiedActivityFacts([other]).length
        &&(sameCrmRecordId(other.activityWrite.clientId,clientId)||(other.activityWrite.clientTaxCode??(other.plan?.source.owners.length?activityPrimaryOwner(other.plan.source.owners).taxCode:null))===primary.taxCode)
        &&(other.activityWrite.activityDay??romeDay(new Date(other.activityWrite.submittedAt)))===day);
      if(pending)throw new ImportV2Error('Un’attività di questo cliente inviata oggi è ancora da verificare. Nessun secondo inserimento.','verification_failed',{details:{pendingActivityItem:pending.itemId}});
      if(!this.activityWriteGuard&&this.requireSharedActivityGuard)throw new ImportV2Error('Controllo attività tra postazioni non disponibile. Ricollega la memoria condivisa prima di inserire nuove attività.','verification_failed');
      if(this.activityWriteGuard){
        claim={clientTaxCode:primary.taxCode,day,operationId:checkpoint.itemId};
        const reservation=await this.activityWriteGuard.reserve(claim);
        if(reservation.proof){
          const covered=activityCoverage({records:[reservation.proof],propertyComplete:false,clientComplete:false,checkedAt:current.toISOString()},propertyId,clientId,current);
          if(covered)return {...checkpoint,activityEvidence:{...covered,operationId:checkpoint.itemId},stage:NEXT_STAGE.verified};
        }
        if(!reservation.granted)throw new ImportV2Error('Questo cliente ha un’attività in lavorazione su un’altra postazione. Nessun secondo inserimento.','verification_failed');
        if(reservation.submitted&&!checkpoint.activityWrite?.submittedAt)throw new ImportV2Error('Il controllo condiviso segnala un’attività già inviata: serve verificarne l’esito prima di un nuovo inserimento.','verification_failed');
        checkpoint.activityWrite={...checkpoint.activityWrite!,sharedClaim:true};await this.saveCheckpoint(checkpoint);
      }
    }
    try{
    const activityEvidence = await this.crm.ensureActivity(this.requirePropertyId(checkpoint), plan, checkpoint.activityWrite ? {
      ...(this.calendarActivityPolicy?{client:{id:clientId,name:primary.fullName,taxCode:primary.taxCode,phones:primary.contacts.phones}}:{}),
      ...(checkedHistory?{history:checkedHistory}:{}),
      state: structuredClone(checkpoint.activityWrite),
      persist: async state => {
        const submitted=Boolean(checkpoint.activityWrite?.submittedAt);
        checkpoint.activityWrite = structuredClone(state); await this.saveCheckpoint(checkpoint);
        if(claim&&state.submittedAt&&!submitted)await this.activityWriteGuard!.submitted(claim);
      },
    } : undefined);
    if (plan.source.activity.enabled && (activityEvidence.outcome === "disabled" || activityEvidence.descriptionVerified === false || activityEvidence.statusVerified === false
      ||this.calendarActivityPolicy&&(!activityEvidence.activityId||activityEvidence.descriptionVerified!==true||activityEvidence.statusVerified!==true
        ||!sameCrmRecordId(activityEvidence.clientId,clientId)||!sameCrmRecordId(activityEvidence.propertyId,propertyId)||activityEvidence.activityDay!==romeDay(this.now())))) {
      throw new ImportV2Error("L'attività prevista dal piano non è stata verificata: immobile conservato, attività da completare", "verification_failed", { retryable: true });
    }
    if(claim&&activityEvidence.activityId)await this.activityWriteGuard!.confirm(claim,{id:activityEvidence.activityId,propertyId,clientId,
      status:plan.source.activity.status,activityDate:null,createdAt:activityEvidence.activityDay!,description:''});
    return { ...checkpoint, activityEvidence: { ...activityEvidence, ...(checkpoint.activityWrite ? { operationId: checkpoint.activityWrite.operationId } : {}) }, stage: NEXT_STAGE.verified };
    }finally{if(claim&&!checkpoint.activityWrite?.submittedAt)await this.activityWriteGuard!.release(claim).catch(()=>undefined);}
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
        saved = this.skipUnchangedPeople&&!personNeedsWrite(existing,desired)
          ?await this.crm.readPerson(existing.id,owner.taxCode):await this.crm.overwritePerson(existing.id, desired);
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
      /* Create and overwrite already return a direct-by-ID reread of the
       * saved record. Repeating the global search here only reopens the
       * account list and the same person. A merge is different: it must also
       * prove that no duplicate with the same CF remains. */
      const after = mergePerformed
        ? (await this.crm.searchPeopleByExactTaxCode(owner.taxCode))
          .filter((candidate) => canonicalTaxCode(candidate.taxCode) === owner.taxCode)
        : [];
      if (mergePerformed && after.length > 1) {
        throw new ImportV2Error("Dopo il salvataggio il codice fiscale identifica ancora più nominativi", "verification_failed", {
          retryable: true,
          details: { taxCode: owner.taxCode, candidateIds: after.map((candidate) => candidate.id) },
        });
      }
      /* Dopo il merge l'indice globale può restituire zero per alcuni
       * secondi. La scheda restituita è già stata riletta direttamente per ID;
       * più di un risultato resta invece un errore deterministico. */
      if (mergePerformed && after.length === 1) saved = after[0]!;
      assertPerson(owner, saved, desired.phones, desired.emails);
      synced.push({ sourcePersonId: owner.sourcePersonId, taxCode: owner.taxCode, crmPersonId: saved.id, mergePerformed });
      // Preserve each verified person before moving to the next. A later
      // owner's transient error must not replay successful writes/merges.
      checkpoint.syncedPeople = [...synced];
      checkpoint.updatedAt = this.now().toISOString();
      await this.saveCheckpoint(checkpoint);
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
        phones: owner.contacts.phones,
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
    return activityPrimaryOwner(owners);
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
    const exact = cadastral.filter((candidate) => sameCrmPropertyAddress(plan.source.fullAddress, candidate)
      && sameCadastralIdentity(plan.source.cadastral, candidate.cadastral));
    // The global search already covers all owners, including former owners.
    // Only an exact, unambiguous identity can avoid the linked-list fallback.
    if (exact.length) return {
      choice: choosePropertyCandidate(plan.source, cadastral, this.preferRegistryDuplicates),
      linkedCount: 0,
      cadastralCount: cadastral.length,
    };
    this.throwIfInterruptionRequested();
    const linked = await this.crm.listAllPropertiesForPeople(personIds, plan);
    return {
      choice: choosePropertyCandidate(plan.source, [...linked, ...cadastral], this.preferRegistryDuplicates),
      linkedCount: linked.length,
      cadastralCount: cadastral.length,
    };
  }

  private requirePropertyId(checkpoint: ImportV2Checkpoint): string {
    if (!checkpoint.crmPropertyId) throw new ImportV2Error("Identificativo immobile CRM mancante", "invalid_source");
    return checkpoint.crmPropertyId;
  }
}
