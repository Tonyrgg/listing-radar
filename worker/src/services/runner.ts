import { WorkerError } from "../core/errors.js";
import { buildCadastralKey, normalizeTaxCode } from "../core/normalize.js";
import { WorkflowStateMachine } from "../core/state-machine.js";
import { logger } from "../logger.js";
import type { AcquisitionReview, CadastralProperty, NormalizedPerson, WorkflowStep, WorkerMode } from "../types.js";
import { PlaywrightCrmAdapter } from "../adapters/crm/index.js";
import { ExcelContactsAdapter } from "../adapters/excel/index.js";
import { PlaywrightSisterAdapter } from "../adapters/sister/index.js";
import type { WorkerConfig } from "../config.js";
import { connectToChrome } from "./chrome.js";
import { WorkerPrompts, type PromptController } from "./prompts.js";
import { type JobRow, type PersonRow, type PropertyRow, WorkerRepository } from "./repository.js";
import { captureDiagnosticScreenshot, pruneDiagnosticScreenshots } from "./screenshots.js";
import { SisterKeepAliveScheduler, type SisterKeepAliveResult } from "./sister-keepalive.js";
import {
  activityCheckpoint,
  buildPropertyActivityTasks,
  PROPERTY_ACTIVITY_DESCRIPTION,
  PROPERTY_ACTIVITY_STATUS,
  readPropertyActivityCheckpoint,
  type PropertyActivityCheckpoint,
} from "./property-activities.js";
import { buildPropertyWorkPlan } from "./property-workflow.js";

function asProperty(row: PropertyRow): CadastralProperty {
  return {
    municipality: row.municipality, sheet: row.sheet, parcel: row.parcel, subaltern: row.subaltern,
    address: row.address, censusZone: row.census_zone, category: row.category, class: row.class,
    consistency: row.consistency, cadastralIncome: row.cadastral_income,
    sourceRef: String(row.raw_payload?.rowIndex ?? ""), rawPayload: row.raw_payload ?? {},
  };
}

function asPerson(row: PersonRow): NormalizedPerson {
  const contactMatch = row.raw_payload?.contact_match && typeof row.raw_payload.contact_match === "object"
    ? row.raw_payload.contact_match as Record<string, unknown>
    : {};
  return {
    fullName: row.full_name, birthPlace: row.birth_place, birthProvince: row.birth_province,
    birthDate: row.birth_date, taxCode: row.tax_code, rightType: row.right_type,
    shareOriginal: row.share_original, shareNumerator: row.share_numerator,
    shareDenominator: row.share_denominator, sharePercentage: row.share_percentage,
    mobiles: row.mobiles ?? [], landlines: row.landlines ?? [], emails: row.emails ?? [],
    whatsapp: Array.isArray(contactMatch.whatsapp) ? contactMatch.whatsapp.filter((value): value is string => typeof value === "string") : [], rawPayload: row.raw_payload ?? {},
  };
}

function personSummary(person: NormalizedPerson, property?: CadastralProperty) {
  return [
    `Nominativo: ${person.fullName}`,
    `Codice fiscale: ${person.taxCode ?? "mancante"}`,
    `Cellulari: ${person.mobiles.join(", ") || "nessuno"}`,
    `Fissi: ${person.landlines.join(", ") || "nessuno"}`,
    `Email: ${person.emails.join(", ") || "nessuna"}`,
    property ? `Immobile: ${buildCadastralKey(property)} — ${property.address ?? "indirizzo assente"}` : null,
    `Quota: ${person.sharePercentage ?? "non interpretabile"}%`,
  ].filter(Boolean).join("\n");
}

function propertyActivitySummary(property: CadastralProperty, ownerNames: string[]) {
  return [
    `Immobile: ${buildCadastralKey(property)} — ${property.address ?? "indirizzo assente"}`,
    `Proprietari collegati: ${ownerNames.join(", ") || "nessuno"}`,
    "Modifica prevista: una sola attività dalla scheda immobile",
    `Stato: ${PROPERTY_ACTIVITY_STATUS}`,
    `Descrizione: ${PROPERTY_ACTIVITY_DESCRIPTION}`,
  ].join("\n");
}

function normalizedWords(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/\W+/).filter((word) => word.length >= 3);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type RunnerEvent =
  | { type: "job-ready"; job: JobRow; dryRun: boolean }
  | { type: "step-started"; jobId: string; step: WorkflowStep }
  | { type: "step-completed"; jobId: string; step: WorkflowStep; next: WorkflowStep; output: Record<string, unknown> }
  | { type: "property-progress"; jobId: string; propertyId: string; index: number; total: number; address: string | null; stage: string; message: string }
  | { type: "sister-keepalive"; result: SisterKeepAliveResult }
  | { type: "job-completed"; jobId: string }
  | { type: "job-archived"; jobId: string }
  | { type: "job-failed"; jobId: string; status: string; message: string; details: Record<string, unknown> };

export interface RunnerOptions {
  prompts?: PromptController;
  onEvent?: (event: RunnerEvent) => void;
  keepAlive?: boolean;
  isCancellationRequested?: (jobId: string) => boolean;
  isPropertySkipRequested?: (jobId: string, propertyId: string) => boolean;
}

export class PropertyWorkerRunner {
  private readonly repository: WorkerRepository;
  private readonly prompts: PromptController;
  private readonly onEvent: (event: RunnerEvent) => void;
  private readonly manageKeepAlive: boolean;
  private readonly isCancellationRequested: (jobId: string) => boolean;
  private readonly isPropertySkipRequested: (jobId: string, propertyId: string) => boolean;

  constructor(private readonly config: WorkerConfig, options: RunnerOptions = {}) {
    this.repository = new WorkerRepository(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
    this.prompts = options.prompts ?? new WorkerPrompts();
    this.onEvent = options.onEvent ?? (() => undefined);
    this.manageKeepAlive = options.keepAlive !== false;
    this.isCancellationRequested = options.isCancellationRequested ?? (() => false);
    this.isPropertySkipRequested = options.isPropertySkipRequested ?? (() => false);
  }

  private throwIfCancellationRequested(jobId: string) {
    if (this.isCancellationRequested(jobId)) {
      throw new WorkerError("Lavorazione annullata dall'utente", "paused", { cancelled: true });
    }
  }

  async run(input: { mode?: WorkerMode; jobId?: string; createNew?: boolean }) {
    const mode = input.mode ?? this.config.WORKER_MODE;
    await pruneDiagnosticScreenshots(this.config.ERROR_SCREENSHOT_DIR, this.config.ERROR_SCREENSHOT_RETENTION_DAYS);
    const tabs = await connectToChrome(this.config.CHROME_CDP_URL, this.config.SISTER_TAB_MATCH, this.config.CRM_TAB_MATCH);
    const keepAlive = new SisterKeepAliveScheduler(tabs.sisterPage, {
      enabled: this.manageKeepAlive && this.config.SISTER_KEEPALIVE_ENABLED,
      minSeconds: this.config.SISTER_KEEPALIVE_MIN_SECONDS,
      maxSeconds: this.config.SISTER_KEEPALIVE_MAX_SECONDS,
      url: this.config.SISTER_KEEPALIVE_URL,
      onResult: (result) => this.onEvent({ type: "sister-keepalive", result }),
    });
    keepAlive.start();
    const sister = new PlaywrightSisterAdapter(tabs.sisterPage);
    const crm = new PlaywrightCrmAdapter(tabs.crmPage, this.config.WORKER_DRY_RUN);
    const contacts = new ExcelContactsAdapter(this.config.CONTACTS_EXCEL_PATH);
    await contacts.load();
    let job = input.jobId
      ? await this.repository.getJob(input.jobId)
      : input.createNew
        ? await this.repository.createJob(mode)
        : (await this.repository.findReadyJob(mode)) ?? await this.repository.createJob(mode);
    const usesLegacyGlobalPropertySearch = Boolean(
      input.jobId
      && job.current_step === "property_searched"
      && job.error_message?.includes("queryviewerfilters"),
    );
    if (usesLegacyGlobalPropertySearch) {
      await this.repository.rewindLegacyPropertySearch(job.id);
      job = await this.repository.getJob(job.id);
      logger.info({ jobId: job.id }, "Job riallineato al flusso immobile correlato al nominativo");
    }
    const state = WorkflowStateMachine.resume(job.last_completed_step);
    if (input.jobId) {
      await this.repository.updateJob(job.id, { status: "running", current_step: state.current, error_message: null, error_details: null });
      job = await this.repository.getJob(job.id);
    }
    this.onEvent({ type: "job-ready", job, dryRun: this.config.WORKER_DRY_RUN });
    logger.info({ jobId: job.id, mode: job.mode, dryRun: this.config.WORKER_DRY_RUN, resumeFrom: state.current }, "Worker avviato");

    try {
      while (true) {
        this.throwIfCancellationRequested(job.id);
        job = await this.repository.getJob(job.id);
        if (job.status === "paused") throw new WorkerError("Job messo in pausa", "paused");
        const step = state.current;
        this.onEvent({ type: "step-started", jobId: job.id, step });
        const stepId = await this.repository.beginStep(job.id, step);
        try {
          const output = await this.executeStep(step, job, sister, crm, contacts);
          this.throwIfCancellationRequested(job.id);
          const next = state.complete(step);
          await this.repository.completeStep(job.id, stepId, step, next, output);
          this.onEvent({ type: "step-completed", jobId: job.id, step, next, output });
          logger.info({ jobId: job.id, step, next }, "Step completato");
          if (output.savedForLater === true) {
            await this.repository.saveAcquisition(job.id);
            this.onEvent({ type: "job-archived", jobId: job.id });
            logger.info({ jobId: job.id }, "Acquisizione salvata per un import futuro");
            return job.id;
          }
          if (step === "completed") break;
        } catch (error) {
          const workerError = error instanceof WorkerError
            ? error
            : new WorkerError(error instanceof Error ? error.message : String(error), "failed");
          let screenshotPath: string | null = null;
          if (workerError.captureScreenshot) {
            const page = workerError.details.portal === "SISTER" ? tabs.sisterPage : tabs.crmPage;
            screenshotPath = await captureDiagnosticScreenshot(page, this.config.ERROR_SCREENSHOT_DIR, job.id, workerError.status).catch(() => null);
          }
          await this.repository.failStep(job.id, stepId, workerError.status, workerError.message, workerError.details, screenshotPath);
          this.onEvent({ type: "job-failed", jobId: job.id, status: workerError.status, message: workerError.message, details: workerError.details });
          throw workerError;
        }
      }
      logger.info({ jobId: job.id }, "Job completato");
      this.onEvent({ type: "job-completed", jobId: job.id });
      return job.id;
    } finally {
      keepAlive.stop();
      this.prompts.close();
      await tabs.browser.close().catch(() => undefined);
    }
  }

  private async executeStep(
    step: WorkflowStep,
    job: JobRow,
    sister: PlaywrightSisterAdapter,
    crm: PlaywrightCrmAdapter,
    contacts: ExcelContactsAdapter,
  ): Promise<Record<string, unknown>> {
    switch (step) {
      case "ready":
        return { ready: true };
      case "sister_results_acquired": {
        await this.prompts.waitForAcquisition();
        if (!(await sister.detectPage())) throw new WorkerError("Pagina risultati SISTER non riconosciuta", "portal_error", { portal: "SISTER" }, true);
        if (!(await crm.detectPage())) throw new WorkerError("Pagina gestionale non riconosciuta", "portal_error", { portal: "CRM" }, true);
        const context = await sister.extractSearchContext();
        await this.repository.setJobContext(job.id, context);
        return { context };
      }
      case "properties_extracted": {
        const extracted = await sister.extractProperties();
        if (!extracted.length) throw new WorkerError("Nessun immobile A/ o C/ trovato", "data_incomplete", { portal: "SISTER" });
        const properties = await this.repository.insertProperties(job.id, extracted);
        return {
          count: properties.length,
          keys: properties.map((property) => property.cadastral_key),
          ignoredCategories: sister.getIgnoredCategories(),
          ignoredEmptyProperties: sister.getIgnoredEmptyProperties(),
        };
      }
      case "owners_extracted": {
        const graph = await this.repository.loadGraph(job.id);
        const ignoredBusinessProperties: string[] = [];
        for (const property of graph.properties) {
          this.throwIfCancellationRequested(job.id);
          const owners = await sister.extractOwners(asProperty(property));
          const sourceRow = Number(property.raw_payload?.sourceOrder ?? property.raw_payload?.rowIndex);
          if (!owners.length && Number.isInteger(sourceRow) && sister.hasIgnoredBusinessOnRow(sourceRow)) {
            await this.repository.removePropertyFromJob(job.id, property.id);
            ignoredBusinessProperties.push(property.cadastral_key);
            continue;
          }
          for (const owner of owners) {
            this.throwIfCancellationRequested(job.id);
            await this.repository.insertOwner(job.id, property.id, owner);
          }
        }
        const finalGraph = await this.repository.loadGraph(job.id);
        const total = finalGraph.people.length;
        await this.repository.updateJob(job.id, { total_people: total, total_properties: finalGraph.properties.length });
        return {
          count: total,
          ignoredRights: sister.getIgnoredRights(),
          ignoredBusinesses: sister.getIgnoredBusinesses(),
          ignoredBusinessProperties,
        };
      }
      case "data_normalized": {
        const graph = await this.repository.loadGraph(job.id);
        const incompleteProperties = graph.properties.filter((item) => !item.sheet || !item.parcel || !item.subaltern);
        const incompletePeople = graph.people.filter((person) => !normalizeTaxCode(person.tax_code) || person.share_percentage == null);
        const propertiesWithoutOwners = graph.properties.filter((property) => !graph.ownerships.some((ownership) => ownership.property_id === property.id));
        const nothingToImport = !graph.properties.length && !graph.people.length;
        if ((!nothingToImport && !graph.people.length) || incompleteProperties.length || incompletePeople.length || propertiesWithoutOwners.length) {
          throw new WorkerError("Dati obbligatori mancanti o quota non interpretabile", "data_incomplete", {
            propertyIds: incompleteProperties.map((item) => item.id), personIds: incompletePeople.map((item) => item.id),
            propertiesWithoutOwners: propertiesWithoutOwners.map((item) => item.id), noOwnersFound: !graph.people.length,
          });
        }
        await Promise.all([
          ...graph.properties.map((item) => this.repository.updatePropertyProcessing(item.id, { processing_status: "normalized" })),
          ...graph.people.map((item) => this.repository.updatePersonProcessing(item.id, { tax_code: normalizeTaxCode(item.tax_code), processing_status: "normalized" })),
        ]);
        return { properties: graph.properties.length, people: graph.people.length, nothingToImport };
      }
      case "acquisition_reviewed": {
        const graph = await this.repository.loadGraph(job.id);
        const review: AcquisitionReview = {
          municipality: job.municipality,
          street: job.street,
          civicNumber: job.civic_number,
          properties: graph.properties.map((property) => ({
            id: property.id,
            cadastralKey: property.cadastral_key,
            address: property.address,
            category: property.category,
            class: property.class,
            consistency: property.consistency,
            cadastralIncome: property.cadastral_income,
            owners: graph.ownerships
              .filter((ownership) => ownership.property_id === property.id)
              .map((ownership) => graph.people.find((person) => person.id === ownership.person_id))
              .filter((person): person is PersonRow => Boolean(person))
              .map((person) => ({
                id: person.id,
                fullName: person.full_name,
                taxCode: person.tax_code,
                birthPlace: person.birth_place,
                birthDate: person.birth_date,
                sharePercentage: graph.ownerships.find((ownership) => ownership.property_id === property.id && ownership.person_id === person.id)?.share_percentage ?? null,
              })),
          })),
        };
        const decision = await this.prompts.reviewAcquisition(review);
        if (decision === "cancel") {
          throw new WorkerError("Acquisizione annullata dal riepilogo. Premi “Riprendi” per controllarla di nuovo.", "paused", { propertyCount: review.properties.length });
        }
        return { confirmed: decision === "proceed", savedForLater: decision === "save", propertyCount: review.properties.length, ownerCount: graph.people.length };
      }
      case "properties_processed":
        return this.processPropertiesInOrder(job, crm, contacts);
      case "person_searched": {
        const graph = await this.repository.loadGraph(job.id);
        for (const row of graph.people) {
          this.throwIfCancellationRequested(job.id);
          if (["matched", "not_found", "duplicate_candidates"].includes(row.processing_status) && Array.isArray(row.raw_payload?.crm_matches)) continue;
          const person = asPerson(row);
          if (!person.taxCode) throw new WorkerError("Codice fiscale mancante", "data_incomplete", { personId: row.id });
          const result = await crm.findPerson({ taxCode: person.taxCode, phones: [], fullName: person.fullName, birthDate: person.birthDate });
          if (result.matches.length > 1) {
            await this.repository.updatePersonProcessing(row.id, {
              crm_record_id: null,
              processing_status: "duplicate_candidates",
              raw_payload: { ...(row.raw_payload ?? {}), crm_matches: result.matches, force_new_person: true },
            });
            continue;
          }
          const onlyMatch = result.matches[0];
          if (onlyMatch?.confidence === "possible") {
            const label = normalizedWords(onlyMatch.label);
            const nameVerified = normalizedWords(person.fullName).every((word) => label.includes(word));
            if (!nameVerified) throw new WorkerError("Corrispondenza telefonica non confermata dai dati anagrafici", "needs_review", { personId: row.id, alternative: onlyMatch });
          }
          await this.repository.updatePersonProcessing(row.id, {
            crm_record_id: result.matches[0]?.id ?? null,
            processing_status: result.matches.length ? "matched" : "not_found",
            raw_payload: { ...(row.raw_payload ?? {}), crm_matches: result.matches },
          });
        }
        return { searched: graph.people.length };
      }
      case "person_created_or_updated": {
        const graph = await this.repository.loadGraph(job.id);
        let processed = 0;
        for (const row of graph.people) {
          this.throwIfCancellationRequested(job.id);
          if (["synced", "dry_run", "merge_pending", "merge_simulated", "merge_blocked"].includes(row.processing_status)) { processed += 1; continue; }
          if (row.processing_status === "creation_started") {
            const inspection = await crm.inspectPersonMerge();
            if (inspection.status === "completed" && inspection.personId) {
              await this.repository.updatePersonProcessing(row.id, { crm_record_id: inspection.personId, processing_status: "synced" });
            } else {
              await this.repository.updatePersonProcessing(row.id, {
                processing_status: "merge_pending",
                raw_payload: { ...(row.raw_payload ?? {}), merge_inspection: inspection },
              });
            }
            processed += 1;
            continue;
          }
          const person = asPerson(row);
          const matches = Array.isArray(row.raw_payload?.crm_matches) ? row.raw_payload.crm_matches : [];
          const duplicateCandidateIds = matches.length > 1
            ? matches.map((match) => match && typeof match === "object" && "id" in match ? String(match.id) : "").filter(Boolean)
            : [];
          const forceNewPerson = row.raw_payload?.force_new_person === true;
          if (job.mode === "assisted") {
            const duplicateNotice = duplicateCandidateIds.length
              ? `\nIl codice fiscale compare in ${duplicateCandidateIds.length} schede. Verrà creato un nuovo nominativo e il merge sarà confermato soltanto dopo l’esito sicuro del Cloud.`
              : "";
            const decision = await this.prompts.confirmSave(`${personSummary(person)}\nModifica prevista: ${row.crm_record_id && !forceNewPerson ? "verifica e aggiornamento nominativo" : "creazione nominativo"}${duplicateNotice}\nCampi: anagrafica SISTER e codice fiscale. I recapiti Excel saranno controllati dopo l'attività.`);
            if (decision === "skip") { await this.repository.updatePersonProcessing(row.id, { processing_status: "skipped" }); continue; }
            if (decision === "review") throw new WorkerError("Nominativo segnato da verificare", "needs_review", { personId: row.id });
            if (decision === "manual") { await this.prompts.waitForManualEdit(); await this.repository.updatePersonProcessing(row.id, { processing_status: "manual" }); processed += 1; continue; }
          }
          await this.logPersonChanges(job.id, row, person);
          if (row.crm_record_id && !forceNewPerson) {
            await crm.updatePerson(row.crm_record_id, person);
            await this.repository.updatePersonProcessing(row.id, { processing_status: this.config.WORKER_DRY_RUN ? "dry_run" : "synced" });
          } else {
            const creation = await crm.createPerson(
              person,
              duplicateCandidateIds,
              duplicateCandidateIds.length
                ? () => this.repository.updatePersonProcessing(row.id, { processing_status: "creation_started" })
                : undefined,
            );
            const mergeStatus = duplicateCandidateIds.length && creation.mergeStatus === "not_required" ? "pending" : creation.mergeStatus;
            await this.repository.updatePersonProcessing(row.id, {
              crm_record_id: creation.personId,
              processing_status: mergeStatus === "simulated" ? "merge_simulated" : ["pending", "ready", "blocked"].includes(mergeStatus) ? "merge_pending" : this.config.WORKER_DRY_RUN ? "dry_run" : "synced",
              raw_payload: { ...(row.raw_payload ?? {}), person_creation: { ...creation, mergeStatus } },
            });
          }
          processed += 1;
        }
        await this.repository.updateJob(job.id, { processed_people: processed });
        return { processed, dryRun: this.config.WORKER_DRY_RUN };
      }
      case "person_merge_reviewed": {
        const graph = await this.repository.loadGraph(job.id);
        let reviewed = 0;
        for (const row of graph.people) {
          this.throwIfCancellationRequested(job.id);
          if (row.processing_status === "merge_simulated") {
            await this.repository.updatePersonProcessing(row.id, { processing_status: "dry_run" });
            reviewed += 1;
            continue;
          }
          if (!["merge_pending", "merge_blocked"].includes(row.processing_status)) continue;
          const inspection = await crm.inspectPersonMerge();
          await this.repository.updatePersonProcessing(row.id, {
            processing_status: inspection.status === "blocked" ? "merge_blocked" : "merge_pending",
            raw_payload: { ...(row.raw_payload ?? {}), merge_inspection: inspection },
          });
          if (inspection.status === "blocked") {
            throw new WorkerError(`Il Cloud ha bloccato il merge: ${inspection.message}. Risolvi manualmente il conflitto e premi “Riprendi”.`, "needs_review", { personId: row.id, merge: inspection }, true);
          }
          if (inspection.status === "pending") {
            throw new WorkerError(`Il merge non è ancora confermabile: ${inspection.message}. Controlla la finestra del gestionale e premi “Riprendi”.`, "needs_review", { personId: row.id, merge: inspection }, true);
          }
          if (inspection.status === "completed" && inspection.personId) {
            await this.repository.updatePersonProcessing(row.id, { crm_record_id: inspection.personId, processing_status: "synced" });
            reviewed += 1;
            continue;
          }
          if (inspection.status !== "ready") {
            throw new WorkerError("Stato merge non riconosciuto. Non è stata eseguita alcuna conferma.", "needs_review", { personId: row.id, merge: inspection }, true);
          }
          const confirmed = await crm.confirmPersonMerge();
          if (confirmed.status !== "completed" || !confirmed.personId) {
            throw new WorkerError(`Il merge non risulta concluso: ${confirmed.message}. Verifica il gestionale e premi “Riprendi”.`, "needs_review", { personId: row.id, merge: confirmed }, true);
          }
          await this.repository.updatePersonProcessing(row.id, {
            crm_record_id: confirmed.personId,
            processing_status: "synced",
            raw_payload: { ...(row.raw_payload ?? {}), merge_inspection: inspection, merge_confirmation: confirmed },
          });
          reviewed += 1;
        }
        return { reviewed, dryRun: this.config.WORKER_DRY_RUN };
      }
      case "property_searched": {
        const graph = await this.repository.loadGraph(job.id);
        for (const row of graph.properties) {
          this.throwIfCancellationRequested(job.id);
          if (["matched", "not_found"].includes(row.processing_status) && Object.prototype.hasOwnProperty.call(row.raw_payload ?? {}, "checked_from_people")) continue;
          const owners = graph.ownerships
            .filter((ownership) => ownership.property_id === row.id)
            .map((ownership) => graph.people.find((person) => person.id === ownership.person_id))
            .filter((person): person is PersonRow => Boolean(person?.crm_record_id));
          const matches: Array<{ id: string; data: Record<string, unknown> }> = [];
          for (const owner of owners) {
            this.throwIfCancellationRequested(job.id);
            const result = await crm.findPropertyForPerson(owner.crm_record_id!, asProperty(row));
            if (result.match && !matches.some((match) => match.id === result.match!.id)) matches.push(result.match);
          }
          if (matches.length > 1) {
            throw new WorkerError("I proprietari risultano collegati a immobili CRM diversi con gli stessi dati catastali. Controlla le schede e premi “Riprendi”.", "needs_review", { propertyId: row.id, alternatives: matches });
          }
          const match = matches[0] ?? null;
          await this.repository.updatePropertyProcessing(row.id, {
            crm_record_id: match?.id ?? null,
            processing_status: match ? "matched" : "not_found",
            raw_payload: { ...(row.raw_payload ?? {}), crm_match: match, checked_from_people: owners.map((owner) => owner.id) },
          });
        }
        return { searched: graph.properties.length };
      }
      case "property_created_or_updated": {
        const graph = await this.repository.loadGraph(job.id);
        let processed = 0;
        for (const row of graph.properties) {
          this.throwIfCancellationRequested(job.id);
          if (["synced", "dry_run"].includes(row.processing_status) && row.crm_record_id) {
            processed += 1;
            continue;
          }
          const property = asProperty(row);
          const owner = graph.ownerships.find((item) => item.property_id === row.id);
          const person = graph.people.find((item) => item.id === owner?.person_id);
          if (job.mode === "assisted" && person) {
            const decision = await this.prompts.confirmSave(`${personSummary(asPerson(person), property)}\nModifica prevista: ${row.crm_record_id ? "aggiornamento immobile" : "creazione immobile"}\nCampi: indirizzo e dati catastali SISTER`);
            if (decision === "skip") { await this.repository.updatePropertyProcessing(row.id, { processing_status: "skipped" }); continue; }
            if (decision === "review") throw new WorkerError("Immobile segnato da verificare", "needs_review", { propertyId: row.id });
            if (decision === "manual") { await this.prompts.waitForManualEdit(); await this.repository.updatePropertyProcessing(row.id, { processing_status: "manual" }); processed += 1; continue; }
          }
          await this.logPropertyChanges(job.id, row, property);
          if (row.crm_record_id) await crm.updateProperty(row.crm_record_id, property);
          else await this.repository.updatePropertyProcessing(row.id, { crm_record_id: await crm.createProperty(property) });
          await this.repository.updatePropertyProcessing(row.id, { processing_status: this.config.WORKER_DRY_RUN ? "dry_run" : "synced" });
          processed += 1;
        }
        await this.repository.updateJob(job.id, { processed_properties: processed });
        return { processed, dryRun: this.config.WORKER_DRY_RUN };
      }
      case "activity_created": {
        const graph = await this.repository.loadGraph(job.id);
        const tasks = buildPropertyActivityTasks(graph).filter((task) => Boolean(task.property.crm_record_id));
        const metrics = { created: 0, simulated: 0, existing: 0, migrated: 0, skipped: 0 };
        const prompted = new Set<string>();
        const persist = async (task: typeof tasks[number], checkpoint: PropertyActivityCheckpoint) => {
          task.property.raw_payload = { ...(task.property.raw_payload ?? {}), worker_activity: checkpoint };
          await this.repository.updatePropertyProcessing(task.property.id, { raw_payload: task.property.raw_payload });
        };

        let pending = [] as typeof tasks;
        for (const task of tasks) {
          const checkpoint = readPropertyActivityCheckpoint(
            task.property.raw_payload,
            this.config.WORKER_DRY_RUN,
            task.property.crm_record_id!,
          );
          if (!checkpoint) {
            pending.push(task);
            continue;
          }
          if (checkpoint.source === "legacy-person-flow") {
            await persist(task, checkpoint);
            metrics.migrated += 1;
          }
          if (checkpoint.state === "simulated") metrics.simulated += 1;
          else if (checkpoint.state === "created") metrics.created += 1;
          else if (["existing", "manual"].includes(checkpoint.state)) metrics.existing += 1;
          else if (checkpoint.state === "skipped") metrics.skipped += 1;
        }

        type ActivityFailure = { task: typeof tasks[number]; error: WorkerError };
        let unresolved: ActivityFailure[] = [];
        const terminalFailures: ActivityFailure[] = [];
        for (let pass = 1; pass <= 2 && pending.length; pass += 1) {
          const failures: ActivityFailure[] = [];
          for (const task of pending) {
            this.throwIfCancellationRequested(job.id);
            const property = asProperty(task.property);
            const previous = task.property.raw_payload?.worker_activity as Partial<PropertyActivityCheckpoint> | undefined;
            const attempts = Number(previous?.attempts ?? 0) + 1;
            if (job.mode === "assisted" && !prompted.has(task.property.id)) {
              prompted.add(task.property.id);
              const decision = await this.prompts.confirmSave(propertyActivitySummary(property, task.owners.map((owner) => owner.full_name)));
              if (decision === "skip") {
                await persist(task, activityCheckpoint({
                  state: "skipped", dryRun: this.config.WORKER_DRY_RUN, crmPropertyId: task.property.crm_record_id!,
                  crmActivityId: null, correlatedProperty: null, attempts, error: null,
                }));
                metrics.skipped += 1;
                continue;
              }
              if (decision === "review") {
                throw new WorkerError("Attività dell’immobile segnata da verificare", "needs_review", { propertyId: task.property.id });
              }
              if (decision === "manual") {
                await this.prompts.waitForManualEdit();
                await persist(task, activityCheckpoint({
                  state: "manual", dryRun: this.config.WORKER_DRY_RUN, crmPropertyId: task.property.crm_record_id!,
                  crmActivityId: null, correlatedProperty: null, attempts, error: null,
                }));
                metrics.existing += 1;
                continue;
              }
            }

            await persist(task, activityCheckpoint({
              state: "preparing", dryRun: this.config.WORKER_DRY_RUN, crmPropertyId: task.property.crm_record_id!,
              crmActivityId: null, correlatedProperty: null, attempts, error: null,
            }));
            try {
              const result = await crm.createPropertyActivity({
                propertyId: task.property.crm_record_id!,
                propertyAddress: task.property.address,
                fallbackPersonId: task.fallbackPersonId,
                fallbackPersonLabel: task.owners[0]?.full_name,
                description: PROPERTY_ACTIVITY_DESCRIPTION,
                status: PROPERTY_ACTIVITY_STATUS,
              });
              await persist(task, activityCheckpoint({
                state: result.outcome, dryRun: this.config.WORKER_DRY_RUN, crmPropertyId: task.property.crm_record_id!,
                crmActivityId: result.crmActivityId, correlatedProperty: result.correlatedProperty,
                attempts: attempts + result.attempts - 1, error: null,
              }));
              metrics[result.outcome] += 1;
            } catch (error) {
              const workerError = error instanceof WorkerError
                ? error
                : new WorkerError(error instanceof Error ? error.message : String(error), "portal_error", { portal: "CRM" }, true);
              await persist(task, activityCheckpoint({
                state: "retryable_error", dryRun: this.config.WORKER_DRY_RUN, crmPropertyId: task.property.crm_record_id!,
                crmActivityId: null, correlatedProperty: null, attempts,
                error: { status: workerError.status, message: workerError.message, details: workerError.details },
              }));
              if (["session_expired", "paused", "data_incomplete"].includes(workerError.status)) throw workerError;
              failures.push({ task, error: workerError });
            }
          }
          if (pass === 1) {
            const nonRetryable = failures.filter(({ error }) => error.status !== "portal_error");
            terminalFailures.push(...nonRetryable);
            pending = failures.filter(({ error }) => error.status === "portal_error").map(({ task }) => task);
            unresolved = [...terminalFailures, ...failures.filter(({ error }) => error.status === "portal_error")];
          } else {
            pending = [];
            unresolved = [...terminalFailures, ...failures];
          }
        }
        if (unresolved.length) {
          const reviewRequired = unresolved.some(({ error }) => error.status === "needs_review");
          throw new WorkerError(
            `${unresolved.length} attività immobiliari non sono state completate dopo il recupero automatico. Le altre sono state conservate.`,
            reviewRequired ? "needs_review" : "portal_error",
            {
              portal: "CRM",
              action: "property-activity-batch",
              unresolved: unresolved.map(({ task, error }) => ({
                propertyId: task.property.id,
                cadastralKey: task.property.cadastral_key,
                status: error.status,
                message: error.message,
                details: error.details,
              })),
            },
            true,
          );
        }
        return { ...metrics, totalProperties: tasks.length, dryRun: this.config.WORKER_DRY_RUN };
      }
      case "contacts_matched": {
        const graph = await this.repository.loadGraph(job.id);
        let matched = 0;
        let updated = 0;
        for (const row of graph.people) {
          this.throwIfCancellationRequested(job.id);
          const match = contacts.findByTaxCode(row.tax_code ?? "");
          await this.repository.updateContacts(row.id, match, row.raw_payload);
          if (!match.matchedRows) continue;
          matched += 1;
          const refreshed = { ...row, mobiles: match.mobiles, landlines: match.landlines, emails: match.emails };
          if (row.crm_record_id) {
            if (job.mode === "assisted") {
              const decision = await this.prompts.confirmSave(`${personSummary(asPerson(refreshed))}\nModifica prevista: aggiunta dei recapiti Excel mancanti`);
              if (decision === "skip") continue;
              if (decision === "review") throw new WorkerError("Recapiti segnati da verificare", "needs_review", { personId: row.id });
              if (decision === "manual") { await this.prompts.waitForManualEdit(); continue; }
            }
            await crm.updatePerson(row.crm_record_id, asPerson(refreshed));
            updated += 1;
          }
        }
        return { peopleWithContacts: matched, crmPeopleUpdated: updated, dryRun: this.config.WORKER_DRY_RUN };
      }
      case "owners_linked": {
        const graph = await this.repository.loadGraph(job.id);
        const plan = buildPropertyWorkPlan(graph);
        const primaryPersonIds = new Set(plan.map((item) => item.primary.person.id));
        for (const item of plan) {
          await this.repository.updateOwnership(item.primary.ownership.id, { processing_status: "verified_existing" });
          for (const owner of item.coowners) {
            await this.repository.updateOwnership(owner.ownership.id, { processing_status: "deferred_correlated_owner" });
          }
        }
        for (const person of graph.people) {
          if (!primaryPersonIds.has(person.id)) await this.repository.updatePersonProcessing(person.id, { processing_status: "deferred_correlated_owner" });
        }
        return { linked: 0, deferred: graph.ownerships.length - plan.length, correlatedOwnersEnabled: false };
      }
      case "verified": {
        const graph = await this.repository.loadGraph(job.id);
        const pending = [...graph.properties, ...graph.people, ...graph.ownerships].filter((item) => ["pending", "extracted", "normalized", "not_found", "matched"].includes(item.processing_status));
        if (pending.length) throw new WorkerError("Verifica finale: elementi non completati", "needs_review", { ids: pending.map((item) => item.id) });
        return { verified: true, properties: graph.properties.length, people: graph.people.length };
      }
      case "completed":
        return { completedAt: new Date().toISOString(), dryRun: this.config.WORKER_DRY_RUN };
    }
  }

  private emitPropertyProgress(job: JobRow, property: PropertyRow, index: number, total: number, stage: string, message: string) {
    this.onEvent({ type: "property-progress", jobId: job.id, propertyId: property.id, index, total, address: property.address, stage, message });
  }

  private async withAutomaticRecovery<T>(
    job: JobRow,
    property: PropertyRow,
    index: number,
    total: number,
    label: string,
    operation: () => Promise<T>,
    maximumAttemptsOverride?: number,
  ): Promise<T> {
    const maximumAttempts = maximumAttemptsOverride ?? (job.mode === "automatic" ? 2 : 1);
    let lastError: unknown;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      this.throwIfCancellationRequested(job.id);
      this.throwIfPropertySkipRequested(job.id, property.id);
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const workerError = error instanceof WorkerError
          ? error
          : new WorkerError(error instanceof Error ? error.message : String(error), "failed");
        if (!["portal_error", "failed"].includes(workerError.status) || attempt === maximumAttempts) {
          throw new WorkerError(
            workerError.message,
            workerError.status,
            {
              ...workerError.details,
              operationLabel: label,
              automaticAttempts: attempt,
              automaticRecoveryExhausted: attempt === maximumAttempts && maximumAttempts > 1,
            },
            workerError.captureScreenshot,
          );
        }
        this.emitPropertyProgress(
          job,
          property,
          index,
          total,
          "recovery",
          `${label}: il portale non ha completato il passaggio. Recupero automatico ${attempt} di ${maximumAttempts - 1}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
      }
    }
    throw lastError;
  }

  private async markPropertyStage(property: PropertyRow, stage: string) {
    property.raw_payload = {
      ...(property.raw_payload ?? {}),
      property_flow: { version: 2, stage, dryRun: this.config.WORKER_DRY_RUN, updatedAt: new Date().toISOString() },
    };
    await this.repository.updatePropertyProcessing(property.id, {
      raw_payload: property.raw_payload,
      ...(stage === "completed" || stage === "skipped" ? { processing_status: stage } : {}),
    });
  }

  private async processPropertiesInOrder(job: JobRow, crm: PlaywrightCrmAdapter, contacts: ExcelContactsAdapter) {
    const graph = await this.repository.loadGraph(job.id);
    if (graph.properties.length !== job.total_properties) {
      throw new WorkerError(
        `Archivio della lavorazione incoerente: attesi ${job.total_properties} immobili, disponibili ${graph.properties.length}. Il worker non toccherà il gestionale.`,
        "data_incomplete",
        {
          action: "job-graph-integrity",
          jobId: job.id,
          expectedProperties: job.total_properties,
          actualProperties: graph.properties.length,
          migrationRequired: "006_property_worker_archives.sql",
        },
      );
    }
    const propertyIds = new Set(graph.properties.map(({ id }) => id));
    const personIds = new Set(graph.people.map(({ id }) => id));
    const invalidOwnerships = graph.ownerships.filter(({ property_id, person_id }) =>
      !propertyIds.has(property_id) || !personIds.has(person_id));
    if (invalidOwnerships.length) {
      throw new WorkerError(
        "L'archivio contiene collegamenti tra immobili e nominativi di lavorazioni diverse. Il worker non toccherà il gestionale.",
        "data_incomplete",
        { action: "job-ownership-integrity", jobId: job.id, invalidOwnershipCount: invalidOwnerships.length },
      );
    }
    let completed = graph.properties.filter((property) =>
      ["completed", "skipped"].includes(property.processing_status)
      || ["completed", "skipped"].includes(String((property.raw_payload?.property_flow as { stage?: string } | undefined)?.stage ?? "")),
    ).length;
    const plan = buildPropertyWorkPlan(graph);
    const primaryPersonIds = new Set(plan.map((item) => item.primary.person.id));
    await Promise.all(graph.people
      .filter((person) => !primaryPersonIds.has(person.id))
      .map((person) => this.repository.updatePersonProcessing(person.id, { processing_status: "deferred_correlated_owner" })));
    propertyLoop: for (const [propertyIndex, item] of plan.entries()) {
      this.throwIfCancellationRequested(job.id);
      const { property, primary, coowners } = item;
      const stageOrder = [
        "ready",
        "primary_contacts_ready",
        "primary_ready",
        "contacts_synced",
        "property_ready",
        "activity_ready",
        "completed",
      ];
      const savedPropertyFlow = property.raw_payload?.property_flow as { stage?: string; version?: number } | undefined;
      let propertyStage = String(savedPropertyFlow?.stage ?? "ready");
      if (
        Number(savedPropertyFlow?.version ?? 0) < 2
        && ["contacts_synced", "property_ready"].includes(propertyStage)
      ) propertyStage = "primary_ready";
      const stageReached = (target: string) => stageOrder.indexOf(propertyStage) >= stageOrder.indexOf(target);
      const advanceStage = async (stage: string) => {
        await this.markPropertyStage(property, stage);
        propertyStage = stage;
      };
      if (["completed", "skipped"].includes(property.processing_status) || stageReached("completed")) continue;
      try {
        if (!stageReached("primary_contacts_ready")) {
          this.throwIfPropertySkipRequested(job.id, property.id);
          this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "contacts", `Leggo da Excel i recapiti di ${primary.person.full_name}, senza ancora toccare il gestionale`);
          await this.withAutomaticRecovery(job, property, propertyIndex + 1, graph.properties.length, "Recapiti Excel", () =>
            this.ensureContacts(job, primary.person, crm, contacts, false));
          await advanceStage("primary_contacts_ready");
        }

        if (!stageReached("primary_ready")) {
          this.throwIfPropertySkipRequested(job.id, property.id);
          this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "primary", `Cerco una sola volta e verifico il proprietario: ${primary.person.full_name}`);
          await this.withAutomaticRecovery(job, property, propertyIndex + 1, graph.properties.length, "Scheda nominativo", () =>
            this.ensurePerson(job, primary.person, crm));
          await advanceStage("primary_ready");
        }

        if (!stageReached("contacts_synced")) {
          this.throwIfPropertySkipRequested(job.id, property.id);
          this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "contacts_sync", "Confronto ogni recapito con tutti i campi del nominativo e aggiungo solo quelli assenti");
          await this.withAutomaticRecovery(job, property, propertyIndex + 1, graph.properties.length, "Assegnazione recapiti", () =>
            this.ensureContacts(job, primary.person, crm, contacts, true));
          await advanceStage("contacts_synced");
        }

        if (!stageReached("property_ready")) {
          this.throwIfPropertySkipRequested(job.id, property.id);
          this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "property", "Confronto gli immobili usando soltanto foglio, particella e subalterno");
          await this.withAutomaticRecovery(job, property, propertyIndex + 1, graph.properties.length, "Passaggio nominativo-immobile", () =>
            this.ensureProperty(job, property, primary.person, crm));
          await advanceStage("property_ready");
        }

        if (!stageReached("activity_ready")) {
          this.throwIfPropertySkipRequested(job.id, property.id);
          this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "activity", "Apro l’attività dall’immobile verificato, compilo la descrizione e salvo");
          await this.withAutomaticRecovery(job, property, propertyIndex + 1, graph.properties.length, "Attività immobile", () =>
            this.ensurePropertyActivity(job, property, primary.person, [primary.person], crm), 1);
          await advanceStage("activity_ready");
        }
        this.throwIfPropertySkipRequested(job.id, property.id);

        this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "ownership", `Confermo ${primary.person.full_name} come proprietario principale con la quota più alta`);
        if (!primary.ownership.crm_link_id && primary.person.crm_record_id) {
          primary.ownership.crm_link_id = `existing-link-${primary.person.crm_record_id}`;
          await this.repository.updateOwnership(primary.ownership.id, {
            crm_link_id: primary.ownership.crm_link_id,
            processing_status: "verified_existing",
          });
        }
        for (const owner of coowners) {
          await this.repository.updateOwnership(owner.ownership.id, { processing_status: "deferred_correlated_owner" });
        }
        property.raw_payload = {
          ...(property.raw_payload ?? {}),
          correlated_owners: {
            state: "deferred",
            count: coowners.length,
            primaryPersonId: primary.person.id,
            primarySharePercentage: primary.ownership.share_percentage,
            updatedAt: new Date().toISOString(),
          },
        };
        await this.repository.updatePropertyProcessing(property.id, { raw_payload: property.raw_payload });
        await advanceStage("completed");
        completed += 1;
        await this.repository.updateJob(job.id, { processed_properties: completed });
        this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "completed", `Immobile ${propertyIndex + 1} di ${graph.properties.length} completato`);
      } catch (error) {
        const workerError = error instanceof WorkerError ? error : new WorkerError(error instanceof Error ? error.message : String(error), "failed");
        if (workerError.details.skipProperty === true || this.isPropertySkipRequested(job.id, property.id)) {
          await this.markPropertyStage(property, "skipped");
          completed += 1;
          await this.repository.updateJob(job.id, { processed_properties: completed });
          this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "skipped", "Immobile saltato; continuo con il successivo");
          continue propertyLoop;
        }
        const checkpoint = isRecord(property.raw_payload?.property_flow) ? property.raw_payload.property_flow : {};
        throw new WorkerError(workerError.message, workerError.status, {
          ...workerError.details,
          propertyId: property.id,
          cadastralKey: property.cadastral_key,
          propertyAddress: property.address,
          propertyIndex: propertyIndex + 1,
          totalProperties: graph.properties.length,
          propertyStage: checkpoint.stage ?? "primary",
        }, workerError.captureScreenshot);
      }
    }
    await this.repository.updateJob(job.id, { processed_properties: completed, processed_people: primaryPersonIds.size });
    return {
      processedProperties: completed,
      totalProperties: graph.properties.length,
      processedPrimaryPeople: primaryPersonIds.size,
      deferredCorrelatedPeople: graph.people.length - primaryPersonIds.size,
      dryRun: this.config.WORKER_DRY_RUN,
    };
  }

  private async ensurePerson(job: JobRow, row: PersonRow, crm: PlaywrightCrmAdapter) {
    const person = asPerson(row);
    if (!person.taxCode) throw new WorkerError("Codice fiscale mancante", "data_incomplete", { personId: row.id });
    const searchInput = {
      taxCode: person.taxCode,
      phones: [...person.mobiles, ...person.landlines],
      fullName: person.fullName,
      birthDate: person.birthDate,
    };
    const existingCheckpoint = isRecord(row.raw_payload?.person_flow) ? row.raw_payload.person_flow : null;
    if (existingCheckpoint?.complete === true && existingCheckpoint.dryRun === this.config.WORKER_DRY_RUN && row.crm_record_id) {
      if (this.config.WORKER_DRY_RUN && row.crm_record_id.startsWith("dry-person-")) return;
      const verifiedCheckpoint = await crm.openExistingPerson(searchInput, row.crm_record_id);
      if (verifiedCheckpoint) {
        row.raw_payload = {
          ...(row.raw_payload ?? {}),
          person_flow: {
            ...existingCheckpoint,
            complete: true,
            identityVerified: true,
            crmPersonId: verifiedCheckpoint.id,
            verifiedAt: new Date().toISOString(),
          },
        };
        await this.repository.updatePersonProcessing(row.id, {
          crm_record_id: verifiedCheckpoint.id,
          processing_status: "reused",
          raw_payload: row.raw_payload,
        });
        return;
      }
      row.crm_record_id = null;
      row.raw_payload = {
        ...(row.raw_payload ?? {}),
        person_flow: {
          ...existingCheckpoint,
          complete: false,
          invalidatedAt: new Date().toISOString(),
          invalidatedReason: "identity_not_verified",
        },
      };
      await this.repository.updatePersonProcessing(row.id, {
        crm_record_id: null,
        processing_status: "normalized",
        raw_payload: row.raw_payload,
      });
    }
    if (["merge_pending", "merge_blocked", "creation_started"].includes(row.processing_status)) {
      await this.resolvePersonMerge(job, row, crm);
      if (!row.crm_record_id) throw new WorkerError("Il merge non ha ancora prodotto una scheda nominativo utilizzabile", "needs_review", { personId: row.id }, true);
      const verifiedAfterMerge = await crm.openExistingPerson(searchInput, row.crm_record_id);
      if (!verifiedAfterMerge) {
        throw new WorkerError(
          "Il merge ha restituito una scheda, ma codice fiscale e nominativo non coincidono con SISTER.",
          "needs_review",
          { personId: row.id, crmPersonId: row.crm_record_id, action: "person-merge-identity" },
          true,
        );
      }
      row.processing_status = this.config.WORKER_DRY_RUN ? "dry_run" : "synced";
      row.raw_payload = { ...(row.raw_payload ?? {}), person_flow: { complete: true, identityVerified: true, dryRun: this.config.WORKER_DRY_RUN, crmPersonId: row.crm_record_id, updatedAt: new Date().toISOString() } };
      await this.repository.updatePersonProcessing(row.id, { crm_record_id: row.crm_record_id, processing_status: row.processing_status, raw_payload: row.raw_payload });
      return;
    }
    const result = await crm.findPerson(searchInput);
    const phoneAssignments = result.matches.filter((match) => isRecord(match.data) && match.data.source === "crm-phone-search");
    const candidates = result.matches.filter((match) => !phoneAssignments.includes(match));
    const verifiedMatches: typeof candidates = [];
    for (const candidate of candidates) {
      const verified = await crm.openExistingPerson(searchInput, candidate.id);
      if (verified) verifiedMatches.push({ ...candidate, data: { ...candidate.data, ...verified.data } });
    }
    row.raw_payload = {
      ...(row.raw_payload ?? {}),
      crm_matches: verifiedMatches,
      contact_assignments_detected: phoneAssignments,
      person_search: {
        searchedAt: new Date().toISOString(),
        candidateCount: candidates.length,
        verifiedCount: verifiedMatches.length,
        exactTaxCodeRequired: true,
      },
    };
    if (verifiedMatches.length > 1) {
      row.crm_record_id = null;
      row.processing_status = "duplicate_candidates";
      await this.repository.updatePersonProcessing(row.id, {
        crm_record_id: null,
        processing_status: row.processing_status,
        raw_payload: row.raw_payload,
      });
      throw new WorkerError(
        "Esistono più schede verificate con lo stesso codice fiscale. Il worker non creerà un altro nominativo e non sceglierà alla cieca.",
        "needs_review",
        { personId: row.id, action: "person-multiple-exact-matches", alternatives: verifiedMatches.map(({ id, label }) => ({ id, label })) },
        true,
      );
    }
    if (verifiedMatches.length === 1) {
      row.crm_record_id = verifiedMatches[0]!.id;
      row.processing_status = this.config.WORKER_DRY_RUN ? "dry_run" : "reused";
      row.raw_payload = {
        ...(row.raw_payload ?? {}),
        person_flow: {
          complete: true,
          existing: true,
          identityVerified: true,
          dryRun: this.config.WORKER_DRY_RUN,
          crmPersonId: row.crm_record_id,
          updatedAt: new Date().toISOString(),
        },
      };
      await this.repository.updatePersonProcessing(row.id, {
        crm_record_id: row.crm_record_id,
        processing_status: row.processing_status,
        raw_payload: row.raw_payload,
      });
      return;
    }
    row.crm_record_id = null;
    row.processing_status = "not_found";
    await this.repository.updatePersonProcessing(row.id, {
      crm_record_id: null,
      processing_status: row.processing_status,
      raw_payload: row.raw_payload,
    });
    if (job.mode === "assisted") {
      const decision = await this.prompts.confirmSave(`${personSummary(person)}\nRicerca per codice fiscale completata: nessuna scheda verificata.\nModifica prevista: creazione del nominativo`);
      if (decision === "skip") { await this.repository.updatePersonProcessing(row.id, { processing_status: "skipped" }); return; }
      if (decision === "review") throw new WorkerError("Nominativo segnato da verificare", "needs_review", { personId: row.id });
      if (decision === "manual") { await this.prompts.waitForManualEdit(); row.processing_status = "manual"; await this.repository.updatePersonProcessing(row.id, { processing_status: "manual" }); return; }
    }
    await this.logPersonChanges(job.id, row, person);
    const creation = await crm.createPerson(person);
    row.crm_record_id = creation.personId;
    row.processing_status = creation.mergeStatus === "simulated" ? "merge_simulated" : ["pending", "ready", "blocked"].includes(creation.mergeStatus) ? "merge_pending" : this.config.WORKER_DRY_RUN ? "dry_run" : "synced";
    row.raw_payload = { ...(row.raw_payload ?? {}), person_creation: creation };
    await this.repository.updatePersonProcessing(row.id, { crm_record_id: row.crm_record_id, processing_status: row.processing_status, raw_payload: row.raw_payload });
    await this.resolvePersonMerge(job, row, crm);
    if (!row.crm_record_id) throw new WorkerError("Il gestionale non ha restituito la scheda del nominativo", "needs_review", { personId: row.id }, true);
    if (!this.config.WORKER_DRY_RUN) {
      const verifiedCreated = await crm.openExistingPerson(searchInput, row.crm_record_id);
      if (!verifiedCreated) {
        throw new WorkerError(
          "Il nominativo è stato salvato, ma la scheda finale non supera la verifica di codice fiscale e nome.",
          "needs_review",
          { personId: row.id, crmPersonId: row.crm_record_id, action: "person-created-identity" },
          true,
        );
      }
    }
    row.processing_status = this.config.WORKER_DRY_RUN ? "dry_run" : "synced";
    row.raw_payload = { ...(row.raw_payload ?? {}), person_flow: { complete: true, existing: false, identityVerified: true, dryRun: this.config.WORKER_DRY_RUN, crmPersonId: row.crm_record_id, updatedAt: new Date().toISOString() } };
    await this.repository.updatePersonProcessing(row.id, { crm_record_id: row.crm_record_id, processing_status: row.processing_status, raw_payload: row.raw_payload });
  }

  private async resolvePersonMerge(job: JobRow, row: PersonRow, crm: PlaywrightCrmAdapter) {
    if (row.processing_status === "merge_simulated") return;
    if (!["merge_pending", "merge_blocked", "creation_started"].includes(row.processing_status)) return;
    const inspection = await crm.inspectPersonMerge();
    row.raw_payload = { ...(row.raw_payload ?? {}), merge_inspection: inspection };
    if (inspection.status === "blocked" || inspection.status === "pending") {
      await this.repository.updatePersonProcessing(row.id, { processing_status: inspection.status === "blocked" ? "merge_blocked" : "merge_pending", raw_payload: row.raw_payload });
      throw new WorkerError(inspection.status === "blocked" ? `Il Cloud ha bloccato il merge: ${inspection.message}` : `Il merge non è ancora pronto: ${inspection.message}`, "needs_review", { personId: row.id, merge: inspection }, true);
    }
    if (inspection.status === "completed" && inspection.personId) row.crm_record_id = inspection.personId;
    else if (inspection.status === "ready") {
      const confirmed = await crm.confirmPersonMerge();
      if (confirmed.status !== "completed" || !confirmed.personId) throw new WorkerError(`Il merge non risulta concluso: ${confirmed.message}`, "needs_review", { personId: row.id, merge: confirmed }, true);
      row.crm_record_id = confirmed.personId;
      row.raw_payload = { ...(row.raw_payload ?? {}), merge_confirmation: confirmed };
    } else if (inspection.status !== "simulated") {
      throw new WorkerError("Lo stato del merge non è riconoscibile", "needs_review", { personId: row.id, merge: inspection }, true);
    }
  }

  private async ensureProperty(job: JobRow, row: PropertyRow, primary: PersonRow, crm: PlaywrightCrmAdapter) {
    if (!primary.crm_record_id) throw new WorkerError("La scheda del proprietario principale non è disponibile", "data_incomplete", { personId: primary.id, propertyId: row.id });
    const property = asProperty(row);
    property.rawPayload = {
      ...property.rawPayload,
      searchContext: {
        municipality: job.municipality,
        street: job.street,
        civicNumber: job.civic_number,
      },
    };
    const persistedCrmMatch = isRecord(row.raw_payload?.crm_match) ? row.raw_payload.crm_match : null;
    const persistedCrmMatchData = isRecord(persistedCrmMatch?.data) ? persistedCrmMatch.data : null;
    const persistedQuarantine = isRecord(row.raw_payload?.unsafe_address_only_match)
      ? row.raw_payload.unsafe_address_only_match
      : null;
    const persistedMatchMethod = String(persistedCrmMatchData?.matchedBy ?? "");
    const unsafePersistedPropertyId = String(
      persistedQuarantine?.crmPropertyId
      ?? (row.crm_record_id && persistedMatchMethod && persistedMatchMethod !== "cadastral" ? row.crm_record_id : ""),
    ) || null;
    if (unsafePersistedPropertyId && row.crm_record_id) {
      row.crm_record_id = null;
      row.raw_payload = {
        ...(row.raw_payload ?? {}),
        unsafe_address_only_match: {
          crmPropertyId: unsafePersistedPropertyId,
          matchedBy: persistedMatchMethod,
          quarantinedAt: new Date().toISOString(),
        },
        crm_match: null,
      };
      await this.repository.updatePropertyProcessing(row.id, {
        crm_record_id: null,
        processing_status: "not_found",
        raw_payload: row.raw_payload,
      });
    }
    const linkedResult = await crm.findPropertyForPerson(
      primary.crm_record_id,
      property,
      unsafePersistedPropertyId ? [unsafePersistedPropertyId] : [],
    );
    if (linkedResult.match) {
      const verifiedLinkedProperty = await crm.verifyProperty(linkedResult.match.id, property);
      if (!verifiedLinkedProperty.match || verifiedLinkedProperty.match.id !== linkedResult.match.id) {
        throw new WorkerError(
          "L’immobile collegato al nominativo non supera la verifica catastale finale. Il worker non lo aggiornerà.",
          "needs_review",
          {
            action: "property-linked-identity-mismatch",
            propertyId: row.id,
            crmPropertyId: linkedResult.match.id,
            crmPersonId: primary.crm_record_id,
            cadastralKey: row.cadastral_key,
          },
          true,
        );
      }
      row.crm_record_id = linkedResult.match.id;
      row.raw_payload = {
        ...(row.raw_payload ?? {}),
        crm_match: verifiedLinkedProperty.match,
        checked_from_people: [primary.id],
        property_search: {
          linkedToVerifiedPerson: true,
          searchedAt: new Date().toISOString(),
          personCrmId: primary.crm_record_id,
        },
      };
      await this.repository.updatePropertyProcessing(row.id, {
        crm_record_id: row.crm_record_id,
        processing_status: "matched",
        raw_payload: row.raw_payload,
      });
    } else if (row.crm_record_id) {
      const submittedId = row.crm_record_id;
      const directVerification = await crm.verifyProperty(submittedId, property);
      if (directVerification.match) {
        throw new WorkerError(
          "L'immobile salvato esiste, ma non compare ancora nella sezione Immobili/Notizie/Incarichi del nominativo verificato. Attendo e riprovo senza crearne un altro.",
          "portal_error",
          {
            portal: "CRM",
            action: "property-created-relation-pending",
            propertyId: row.id,
            crmPropertyId: submittedId,
            crmPersonId: primary.crm_record_id,
          },
          true,
        );
      }
      row.crm_record_id = null;
      row.raw_payload = {
        ...(row.raw_payload ?? {}),
        stale_crm_property_id: submittedId,
        property_sync: {
          complete: false,
          invalidatedAt: new Date().toISOString(),
          invalidatedReason: "identity_not_verified",
        },
      };
      await this.repository.updatePropertyProcessing(row.id, {
        crm_record_id: null,
        processing_status: "not_found",
        raw_payload: row.raw_payload,
      });
    } else {
      row.raw_payload = {
        ...(row.raw_payload ?? {}),
        crm_match: null,
        checked_from_people: [primary.id],
        property_search: {
          linkedToVerifiedPerson: false,
          searchedAt: new Date().toISOString(),
          personCrmId: primary.crm_record_id,
        },
      };
      await this.repository.updatePropertyProcessing(row.id, {
        crm_record_id: null,
        processing_status: "not_found",
        raw_payload: row.raw_payload,
      });
    }
    if (job.mode === "assisted") {
      const decision = await this.prompts.confirmSave(`${personSummary(asPerson(primary), property)}\nModifica prevista: ${row.crm_record_id ? "aggiornamento dell'immobile" : "creazione dell'immobile"}`);
      if (decision === "skip") { await this.repository.updatePropertyProcessing(row.id, { processing_status: "skipped" }); return; }
      if (decision === "review") throw new WorkerError("Immobile segnato da verificare", "needs_review", { propertyId: row.id });
      if (decision === "manual") { await this.prompts.waitForManualEdit(); await this.repository.updatePropertyProcessing(row.id, { processing_status: "manual" }); return; }
    }
    await this.logPropertyChanges(job.id, row, property);
    if (row.crm_record_id) {
      await crm.updateProperty(row.crm_record_id, property);
    } else {
      row.crm_record_id = await crm.createProperty(property);
      row.raw_payload = {
        ...(row.raw_payload ?? {}),
        property_creation: {
          submitted: true,
          crmPropertyId: row.crm_record_id,
          submittedAt: new Date().toISOString(),
        },
      };
      await this.repository.updatePropertyProcessing(row.id, {
        crm_record_id: row.crm_record_id,
        processing_status: "creation_submitted",
        raw_payload: row.raw_payload,
      });
    }
    const identity = await crm.verifyProperty(row.crm_record_id, property);
    if (!identity.match) {
      throw new WorkerError(
        "La scheda immobile finale non coincide con foglio, particella e subalterno SISTER. Il worker non aggiungerà l'attività.",
        "needs_review",
        { propertyId: row.id, crmPropertyId: row.crm_record_id, action: "property-final-identity" },
        true,
      );
    }
    if (!this.config.WORKER_DRY_RUN) {
      const linkedVerification = await crm.findPropertyForPerson(
        primary.crm_record_id,
        property,
        unsafePersistedPropertyId ? [unsafePersistedPropertyId] : [],
      );
      if (!linkedVerification.match || linkedVerification.match.id !== row.crm_record_id) {
        throw new WorkerError(
          "La scheda immobile è corretta, ma il collegamento con il nominativo non è ancora visibile. Il worker riproverà senza ricreare l'immobile.",
          "portal_error",
          {
            portal: "CRM",
            action: "property-final-link-verification",
            propertyId: row.id,
            crmPropertyId: row.crm_record_id,
            crmPersonId: primary.crm_record_id,
          },
          true,
        );
      }
    }
    row.processing_status = this.config.WORKER_DRY_RUN ? "dry_run" : "synced";
    row.raw_payload = {
      ...(row.raw_payload ?? {}),
      property_sync: {
        complete: true,
        identityVerified: true,
        linkedToVerifiedPerson: true,
        dryRun: this.config.WORKER_DRY_RUN,
        crmPropertyId: row.crm_record_id,
        primaryPersonId: primary.id,
        updatedAt: new Date().toISOString(),
      },
    };
    await this.repository.updatePropertyProcessing(row.id, { crm_record_id: row.crm_record_id, processing_status: row.processing_status, raw_payload: row.raw_payload });
  }

  private async ensurePropertyActivity(job: JobRow, property: PropertyRow, primary: PersonRow, owners: PersonRow[], crm: PlaywrightCrmAdapter) {
    if (!property.crm_record_id) throw new WorkerError("La scheda dell'immobile non è disponibile per creare l'attività", "data_incomplete", { propertyId: property.id });
    const existing = readPropertyActivityCheckpoint(property.raw_payload, this.config.WORKER_DRY_RUN, property.crm_record_id);
    if (existing) return;
    if (job.mode === "assisted") {
      const decision = await this.prompts.confirmSave(propertyActivitySummary(asProperty(property), owners.map((owner) => owner.full_name)));
      if (decision === "skip") return;
      if (decision === "review") throw new WorkerError("Attività dell'immobile segnata da verificare", "needs_review", { propertyId: property.id });
      if (decision === "manual") { await this.prompts.waitForManualEdit(); return; }
    }
    const result = await crm.createPropertyActivity({
      propertyId: property.crm_record_id,
      propertyAddress: property.address,
      fallbackPersonId: primary.crm_record_id ?? undefined,
      fallbackPersonLabel: primary.full_name,
      description: PROPERTY_ACTIVITY_DESCRIPTION,
      status: PROPERTY_ACTIVITY_STATUS,
    });
    property.raw_payload = {
      ...(property.raw_payload ?? {}),
      worker_activity: activityCheckpoint({
        state: result.outcome,
        dryRun: this.config.WORKER_DRY_RUN,
        crmPropertyId: property.crm_record_id,
        crmActivityId: result.crmActivityId,
        correlatedProperty: result.correlatedProperty,
        attempts: result.attempts,
        error: null,
      }),
    };
    await this.repository.updatePropertyProcessing(property.id, { raw_payload: property.raw_payload });
  }

  private async ensureContacts(
    job: JobRow,
    row: PersonRow,
    crm: PlaywrightCrmAdapter,
    contacts: ExcelContactsAdapter,
    syncToCrm = true,
  ) {
    const match = contacts.findByTaxCode(row.tax_code ?? "");
    await this.repository.updateContacts(row.id, match, row.raw_payload);
    row.mobiles = match.mobiles; row.landlines = match.landlines; row.emails = match.emails;
    row.raw_payload = { ...(row.raw_payload ?? {}), contact_match: { matchedRows: match.matchedRows, whatsapp: match.whatsapp, overflowPhones: match.overflowPhones, notes: match.notes } };
    if (!syncToCrm) {
      await this.repository.updatePersonProcessing(row.id, {
        mobiles: row.mobiles,
        landlines: row.landlines,
        emails: row.emails,
        raw_payload: row.raw_payload,
        processing_status: "contacts_loaded",
      });
      return;
    }
    const existingFlow = isRecord(row.raw_payload?.contacts_flow) ? row.raw_payload.contacts_flow : null;
    if (
      existingFlow?.complete === true
      && existingFlow.version === 2
      && existingFlow.dryRun === this.config.WORKER_DRY_RUN
      && existingFlow.crmPersonId === row.crm_record_id
    ) return;
    let transfer: Awaited<ReturnType<PlaywrightCrmAdapter["transferPhoneAssignments"]>> | null = null;
    if (match.matchedRows && row.crm_record_id) {
      const assignments = await crm.findPhoneAssignments([...match.mobiles, ...match.landlines]);
      const foreignAssignments = assignments.filter((assignment) => assignment.personId !== row.crm_record_id);
      if (job.mode === "assisted") {
        const decision = await this.prompts.confirmSave([
          personSummary(asPerson(row)),
          "Modifiche previste:",
          "- aggiunta dei recapiti Excel mancanti",
          foreignAssignments.length
            ? `- spostamento di ${foreignAssignments.length} recapiti assegnati a un altro nominativo`
            : "- nessun recapito da rimuovere da altri nominativi",
        ].join("\n"));
        if (decision === "review") throw new WorkerError("Recapiti segnati da verificare", "needs_review", { personId: row.id });
        if (decision === "manual") await this.prompts.waitForManualEdit();
        else if (decision !== "skip") transfer = await crm.transferPhoneAssignments(row.crm_record_id, asPerson(row), assignments);
      } else transfer = await crm.transferPhoneAssignments(row.crm_record_id, asPerson(row), assignments);
      for (const moved of transfer?.moved ?? []) {
        await this.repository.logChange(
          job.id,
          "person",
          row.tax_code ?? row.id,
          "phone_assignment",
          `Nominativo CRM ${moved.fromPersonId}`,
          `Nominativo CRM ${moved.toPersonId}`,
          "EXCEL",
        );
      }
      for (const unresolved of transfer?.unresolved ?? []) {
        await this.repository.logChange(
          job.id,
          "person",
          row.tax_code ?? row.id,
          "phone_assignment_needs_review",
          `${unresolved.personIds.length} schede CRM`,
          "Recapito non spostato; lavorazione proseguita",
          "EXCEL",
        );
      }
    }
    row.raw_payload = {
      ...(row.raw_payload ?? {}),
      contacts_flow: {
        version: 2,
        complete: true,
        dryRun: this.config.WORKER_DRY_RUN,
        crmPersonId: row.crm_record_id,
        matchedRows: match.matchedRows,
        transfer,
        updatedAt: new Date().toISOString(),
      },
    };
    await this.repository.updatePersonProcessing(row.id, { mobiles: row.mobiles, landlines: row.landlines, emails: row.emails, raw_payload: row.raw_payload, processing_status: "contacts_matched" });
  }

  private throwIfPropertySkipRequested(jobId: string, propertyId: string) {
    if (this.isPropertySkipRequested(jobId, propertyId)) {
      throw new WorkerError("Immobile saltato su richiesta dell'utente", "paused", { skipProperty: true, propertyId });
    }
  }

  private async logPersonChanges(jobId: string, row: PersonRow, person: NormalizedPerson) {
    const matches = Array.isArray(row.raw_payload?.crm_matches) ? row.raw_payload.crm_matches : [];
    const match = matches[0] && typeof matches[0] === "object" ? matches[0] as Record<string, unknown> : {};
    const previous = match.data && typeof match.data === "object" ? match.data as Record<string, unknown> : {};
    const fields: Record<string, unknown> = {
      full_name: person.fullName, birth_place: person.birthPlace, birth_province: person.birthProvince,
      birth_date: person.birthDate, tax_code: person.taxCode, mobiles: person.mobiles.join(", "),
      landlines: person.landlines.join(", "), emails: person.emails.join(", "),
    };
    for (const [field, value] of Object.entries(fields)) {
      await this.repository.logChange(jobId, "person", person.taxCode ?? row.id, field, previous[field], value);
    }
  }

  private async logPropertyChanges(jobId: string, row: PropertyRow, property: CadastralProperty) {
    const match = row.raw_payload?.crm_match && typeof row.raw_payload.crm_match === "object" ? row.raw_payload.crm_match as Record<string, unknown> : {};
    const previous = match.data && typeof match.data === "object" ? match.data as Record<string, unknown> : {};
    const fields: Record<string, unknown> = {
      sheet: property.sheet, parcel: property.parcel, subaltern: property.subaltern,
      address: property.address, census_zone: property.censusZone, category: property.category,
      class: property.class, consistency: property.consistency, cadastral_income: property.cadastralIncome,
    };
    for (const [field, value] of Object.entries(fields)) {
      await this.repository.logChange(jobId, "property", buildCadastralKey(property), field, previous[field], value);
    }
  }
}
