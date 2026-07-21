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

function normalizedWords(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/\W+/).filter((word) => word.length >= 3);
}

export type RunnerEvent =
  | { type: "job-ready"; job: JobRow; dryRun: boolean }
  | { type: "step-started"; jobId: string; step: WorkflowStep }
  | { type: "step-completed"; jobId: string; step: WorkflowStep; next: WorkflowStep; output: Record<string, unknown> }
  | { type: "sister-keepalive"; result: SisterKeepAliveResult }
  | { type: "job-completed"; jobId: string }
  | { type: "job-failed"; jobId: string; status: string; message: string; details: Record<string, unknown> };

export interface RunnerOptions {
  prompts?: PromptController;
  onEvent?: (event: RunnerEvent) => void;
  keepAlive?: boolean;
  isCancellationRequested?: (jobId: string) => boolean;
}

export class PropertyWorkerRunner {
  private readonly repository: WorkerRepository;
  private readonly prompts: PromptController;
  private readonly onEvent: (event: RunnerEvent) => void;
  private readonly manageKeepAlive: boolean;
  private readonly isCancellationRequested: (jobId: string) => boolean;

  constructor(private readonly config: WorkerConfig, options: RunnerOptions = {}) {
    this.repository = new WorkerRepository(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
    this.prompts = options.prompts ?? new WorkerPrompts();
    this.onEvent = options.onEvent ?? (() => undefined);
    this.manageKeepAlive = options.keepAlive !== false;
    this.isCancellationRequested = options.isCancellationRequested ?? (() => false);
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
        return { count: properties.length, keys: properties.map((property) => property.cadastral_key), ignoredCategories: sister.getIgnoredCategories() };
      }
      case "owners_extracted": {
        const graph = await this.repository.loadGraph(job.id);
        const peopleIds = new Set(graph.people.map((person) => person.id));
        for (const property of graph.properties) {
          this.throwIfCancellationRequested(job.id);
          for (const owner of await sister.extractOwners(asProperty(property))) {
            this.throwIfCancellationRequested(job.id);
            peopleIds.add((await this.repository.insertOwner(job.id, property.id, owner)).id);
          }
        }
        const total = peopleIds.size;
        await this.repository.updateJob(job.id, { total_people: total });
        return { count: total, ignoredRights: sister.getIgnoredRights() };
      }
      case "data_normalized": {
        const graph = await this.repository.loadGraph(job.id);
        const incompleteProperties = graph.properties.filter((item) => !item.sheet || !item.parcel || !item.subaltern);
        const incompletePeople = graph.people.filter((person) => !normalizeTaxCode(person.tax_code) || person.share_percentage == null);
        const propertiesWithoutOwners = graph.properties.filter((property) => !graph.ownerships.some((ownership) => ownership.property_id === property.id));
        if (!graph.people.length || incompleteProperties.length || incompletePeople.length || propertiesWithoutOwners.length) {
          throw new WorkerError("Dati obbligatori mancanti o quota non interpretabile", "data_incomplete", {
            propertyIds: incompleteProperties.map((item) => item.id), personIds: incompletePeople.map((item) => item.id),
            propertiesWithoutOwners: propertiesWithoutOwners.map((item) => item.id), noOwnersFound: !graph.people.length,
          });
        }
        await Promise.all([
          ...graph.properties.map((item) => this.repository.updatePropertyProcessing(item.id, { processing_status: "normalized" })),
          ...graph.people.map((item) => this.repository.updatePersonProcessing(item.id, { tax_code: normalizeTaxCode(item.tax_code), processing_status: "normalized" })),
        ]);
        return { properties: graph.properties.length, people: graph.people.length };
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
        if (await this.prompts.reviewAcquisition(review) === "cancel") {
          throw new WorkerError("Acquisizione annullata dal riepilogo. Premi “Riprendi” per controllarla di nuovo.", "paused", { propertyCount: review.properties.length });
        }
        return { confirmed: true, propertyCount: review.properties.length, ownerCount: graph.people.length };
      }
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
          if (job.mode === "assisted" && await this.prompts.confirmMerge(`${inspection.message}\nIl gestionale non segnala problemi. Confermare adesso il merge dei nominativi?`) === "manual") {
            throw new WorkerError("Merge lasciato alla gestione manuale. Completalo nel gestionale e premi “Riprendi”.", "needs_review", { personId: row.id, merge: inspection }, true);
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
        let created = 0;
        for (const property of graph.properties) {
          this.throwIfCancellationRequested(job.id);
          if (!property.crm_record_id) continue;
          const existingActivities = property.raw_payload?.worker_activities && typeof property.raw_payload.worker_activities === "object"
            ? property.raw_payload.worker_activities as Record<string, Record<string, unknown>>
            : {};
          const activities = { ...existingActivities };
          const ownerships = graph.ownerships.filter((ownership) => ownership.property_id === property.id);
          for (const ownership of ownerships) {
            this.throwIfCancellationRequested(job.id);
            const person = graph.people.find((candidate) => candidate.id === ownership.person_id);
            if (!person?.crm_record_id || activities[person.id]) continue;
            if (job.mode === "assisted") {
              const decision = await this.prompts.confirmSave(`${personSummary(asPerson(person), asProperty(property))}\nModifica prevista: nuova attività\nStato: Da eseguire\nDescrizione: Inserire attività`);
              if (decision === "skip") continue;
              if (decision === "review") throw new WorkerError("Attività segnata da verificare", "needs_review", { propertyId: property.id, personId: person.id });
              if (decision === "manual") { await this.prompts.waitForManualEdit(); continue; }
            }
            const crmActivityId = await crm.createActivity({
              personId: person.crm_record_id,
              propertyId: property.crm_record_id,
              description: "Inserire attività",
              status: "Da eseguire",
            });
            activities[person.id] = { crmActivityId, status: "Da eseguire", description: "Inserire attività", dryRun: this.config.WORKER_DRY_RUN };
            created += 1;
          }
          await this.repository.updatePropertyProcessing(property.id, { raw_payload: { ...(property.raw_payload ?? {}), worker_activities: activities } });
        }
        return { created, dryRun: this.config.WORKER_DRY_RUN };
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
        let linked = 0;
        const linkedOwnersByProperty = new Map<string, Set<string>>();
        for (const ownership of graph.ownerships) {
          this.throwIfCancellationRequested(job.id);
          if (ownership.crm_link_id) continue;
          const property = graph.properties.find((item) => item.id === ownership.property_id);
          const person = graph.people.find((item) => item.id === ownership.person_id);
          if (!property?.crm_record_id || !person?.crm_record_id || ownership.share_percentage == null) {
            await this.repository.updateOwnership(ownership.id, { processing_status: "skipped" });
            continue;
          }
          let existingOwnerIds = linkedOwnersByProperty.get(property.crm_record_id);
          if (!existingOwnerIds) {
            existingOwnerIds = new Set(await crm.findLinkedOwnerIds(property.crm_record_id));
            linkedOwnersByProperty.set(property.crm_record_id, existingOwnerIds);
          }
          if (existingOwnerIds.has(person.crm_record_id)) {
            await this.repository.updateOwnership(ownership.id, { crm_link_id: `existing-link-${person.crm_record_id}`, processing_status: "verified_existing" });
            linked += 1;
            continue;
          }
          if (job.mode === "assisted") {
            const decision = await this.prompts.confirmSave(`${personSummary(asPerson(person), asProperty(property))}\nModifica prevista: collegamento proprietario e quota`);
            if (decision === "skip") { await this.repository.updateOwnership(ownership.id, { processing_status: "skipped" }); continue; }
            if (decision === "review") throw new WorkerError("Collegamento proprietario segnato da verificare", "needs_review", { ownershipId: ownership.id });
            if (decision === "manual") { await this.prompts.waitForManualEdit(); await this.repository.updateOwnership(ownership.id, { processing_status: "manual" }); linked += 1; continue; }
          }
          const linkId = await crm.linkOwner(property.crm_record_id, person.crm_record_id, ownership.share_percentage);
          await this.repository.updateOwnership(ownership.id, { crm_link_id: linkId, processing_status: this.config.WORKER_DRY_RUN ? "dry_run" : "synced" });
          existingOwnerIds.add(person.crm_record_id);
          linked += 1;
        }
        return { linked, dryRun: this.config.WORKER_DRY_RUN };
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
