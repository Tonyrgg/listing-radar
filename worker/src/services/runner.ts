import { WorkerError } from "../core/errors.js";
import { buildCadastralKey, extractFirstCivicNumber, normalizeTaxCode, splitPersonName } from "../core/normalize.js";
import { WorkflowStateMachine } from "../core/state-machine.js";
import { logger } from "../logger.js";
import type { AcquisitionReview, CadastralProperty, ErrorStatus, NormalizedPerson, PropertyMatchResult, WorkflowStep, WorkerMode } from "../types.js";
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
  directContactOrdinalForTask,
  PROPERTY_ACTIVITY_DESCRIPTION,
  PROPERTY_ACTIVITY_CONTACT_MODE,
  NO_ACTIVITY_DESCRIPTION,
  PROPERTY_ACTIVITY_STATUS,
  propertyActivityDefinition,
  type PropertyActivityMode,
  readPropertyActivityCheckpoint,
  type PropertyActivityDefinition,
  type PropertyActivityCheckpoint,
} from "./property-activities.js";
import { buildPropertyWorkPlan } from "./property-workflow.js";
import { indexJobGraph } from "./job-graph.js";
import { ImportV2Coordinator } from "../import-v2/coordinator.js";
import { TecnocloudUiV2Port } from "../import-v2/tecnocloud-ui-port.js";
import type { ImportV2BatchResult } from "../import-v2/queue.js";

export function assertImportV2BatchComplete(result: ImportV2BatchResult): void {
  if (!result.quarantined.length) return;
  const first = result.quarantined[0]!;
  throw new WorkerError(
    `Import V2 non completato: ${result.completed.length} immobili importati, ${result.quarantined.length} non importati. ${first.failure?.message ?? "Verifica non conclusa"}`,
    "needs_review",
    {
      importV2: true,
      propertyId: first.propertyId,
      completed: result.completed.length,
      quarantined: result.quarantined.length,
      failures: result.quarantined.map((outcome) => ({
        propertyId: outcome.propertyId,
        stage: outcome.stage,
        failure: outcome.failure,
      })),
    },
    true,
  );
}

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

function propertyActivitySummary(property: CadastralProperty, ownerNames: string[], definition: PropertyActivityDefinition = {
  contactMode: PROPERTY_ACTIVITY_CONTACT_MODE,
  status: PROPERTY_ACTIVITY_STATUS,
  description: PROPERTY_ACTIVITY_DESCRIPTION,
  directContactOrdinal: null,
}) {
  return [
    `Immobile: ${buildCadastralKey(property)} — ${property.address ?? "indirizzo assente"}`,
    `Proprietari collegati: ${ownerNames.join(", ") || "nessuno"}`,
    "Modifica prevista: una sola attività dalla scheda immobile",
    `Modalità contatto: ${definition.contactMode}`,
    `Stato: ${definition.status}`,
    `Descrizione: ${definition.description}`,
  ].join("\n");
}

function normalizedWords(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/\W+/).filter((word) => word.length >= 3);
}

export function selectRandomCrmCandidate<T>(candidates: T[], randomValue = Math.random()): T | null {
  if (!candidates.length) return null;
  const bounded = Number.isFinite(randomValue) ? Math.max(0, Math.min(0.9999999999999999, randomValue)) : 0;
  return candidates[Math.floor(bounded * candidates.length)] ?? candidates[0] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRejectedTaxCodeError(error: unknown): boolean {
  return isRecord(error) && isRecord(error.details) && error.details.action === "person-tax-code-invalid";
}

function asWorkerError(error: unknown): WorkerError {
  if (error instanceof WorkerError) return error;
  if (isRecord(error) && typeof error.status === "string" && isRecord(error.details)) {
    return new WorkerError(
      typeof error.message === "string" ? error.message : String(error),
      error.status as ErrorStatus,
      error.details,
      error.captureScreenshot === true,
    );
  }
  return new WorkerError(error instanceof Error ? error.message : String(error), "failed");
}

function hasRejectedTaxCodeCheckpoint(person: PersonRow): boolean {
  return isRecord(person.raw_payload?.tax_code_rejection)
    && person.raw_payload.tax_code_rejection.action === "person-tax-code-invalid";
}

function isAcquisitionExcluded(property: PropertyRow): boolean {
  return ["acquisition_skipped", "acquisition_failed"].includes(property.processing_status);
}

const AUTOMATIC_OPERATION_ATTEMPTS = 3;
const AUTOMATIC_PROPERTY_REANALYSES = 3;

function sameContextValue(left: string | null, right: string | null): boolean {
  const normalize = (value: string | null) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return normalize(left) === normalize(right);
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
  isPauseRequested?: (jobId: string) => boolean;
  isStopAfterNextImportRequested?: (jobId: string) => boolean;
  propertyActivityMode?: PropertyActivityMode | (() => PropertyActivityMode);
  isPropertySkipRequested?: (jobId: string, propertyId: string) => boolean;
}

export class PropertyWorkerRunner {
  private interruptActiveBrowser: (() => Promise<void>) | null = null;
  private readonly repository: WorkerRepository;
  private readonly prompts: PromptController;
  private readonly onEvent: (event: RunnerEvent) => void;
  private readonly manageKeepAlive: boolean;
  private readonly isCancellationRequested: (jobId: string) => boolean;
  private readonly isPauseRequested: (jobId: string) => boolean;
  private readonly isStopAfterNextImportRequested: (jobId: string) => boolean;
  private readonly propertyActivityMode: () => PropertyActivityMode;
  private readonly isPropertySkipRequested: (jobId: string, propertyId: string) => boolean;

  constructor(private readonly config: WorkerConfig, options: RunnerOptions = {}) {
    this.repository = new WorkerRepository(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
    this.prompts = options.prompts ?? new WorkerPrompts();
    this.onEvent = options.onEvent ?? (() => undefined);
    this.manageKeepAlive = options.keepAlive !== false;
    this.isCancellationRequested = options.isCancellationRequested ?? (() => false);
    this.isPauseRequested = options.isPauseRequested ?? (() => false);
    this.isStopAfterNextImportRequested = options.isStopAfterNextImportRequested ?? (() => false);
    const activityMode = options.propertyActivityMode;
    this.propertyActivityMode = typeof activityMode === "function"
      ? activityMode
      : () => activityMode ?? "direct_contact";
    this.isPropertySkipRequested = options.isPropertySkipRequested ?? (() => false);
  }

  async interrupt() {
    await this.interruptActiveBrowser?.();
  }

  private throwIfCancellationRequested(jobId: string) {
    if (this.isCancellationRequested(jobId)) {
      throw new WorkerError("Lavorazione annullata dall'utente", "paused", { cancelled: true });
    }
    if (this.isPauseRequested(jobId)) {
      throw new WorkerError("Lavorazione messa in pausa dall'utente", "paused", { pauseRequested: true });
    }
  }

  async run(input: { mode?: WorkerMode; jobId?: string; createNew?: boolean }) {
    const mode = input.mode ?? this.config.WORKER_MODE;
    await pruneDiagnosticScreenshots(this.config.ERROR_SCREENSHOT_DIR, this.config.ERROR_SCREENSHOT_RETENTION_DAYS);
    const tabs = await connectToChrome(this.config.CHROME_CDP_URL, this.config.SISTER_TAB_MATCH, this.config.CRM_TAB_MATCH);
    this.interruptActiveBrowser = () => tabs.browser.close().catch(() => undefined);
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
    const crmV2 = new TecnocloudUiV2Port(tabs.crmPage, this.config.WORKER_DRY_RUN);
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
        /* Quanto e' durato ogni passaggio: senza questo numero non si sa dove
         * se ne va il tempo di una run, e si finisce a indovinare quale attesa
         * togliere. */
        const stepStartedAt = Date.now();
        try {
          const output = await this.executeStep(step, job, sister, crm, crmV2, contacts);
          this.throwIfCancellationRequested(job.id);
          const next = state.complete(step);
          await this.repository.completeStep(job.id, stepId, step, next, output);
          this.onEvent({ type: "step-completed", jobId: job.id, step, next, output });
          logger.info({ jobId: job.id, step, next, durationMs: Date.now() - stepStartedAt }, "Step completato");
          if (output.savedForLater === true) {
            /* La modalita' di attivita' si registra adesso, non all'import: i
             * dati sono stati raccolti con questa, e fra tre giorni la
             * preferenza puo' essere un'altra. */
            await this.repository.saveAcquisition(job.id, {
              kind: job.street && !job.civic_number ? "street" : "civic",
              collectedAt: new Date().toISOString(),
              workerMode: job.mode,
              dryRun: this.config.WORKER_DRY_RUN,
              activityMode: this.propertyActivityMode(),
              place: [job.municipality, job.street, job.civic_number].filter(Boolean).join(" · ") || null,
              properties: output.propertyCount ?? null,
              owners: output.ownerCount ?? null,
            });
            this.onEvent({ type: "job-archived", jobId: job.id });
            logger.info({ jobId: job.id }, "Acquisizione salvata per un import futuro");
            return job.id;
          }
          if (step === "completed") break;
        } catch (error) {
          let workerError = error instanceof WorkerError
            ? error
            : new WorkerError(error instanceof Error ? error.message : String(error), "failed");
          if (workerError.status === "paused" && this.isPauseRequested(job.id) && workerError.details.pauseRequested !== true) {
            workerError = new WorkerError(workerError.message, "paused", { ...workerError.details, pauseRequested: true });
          }
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
      this.interruptActiveBrowser = null;
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
    crmV2: TecnocloudUiV2Port,
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
        const skippedRows: Array<{ propertyId: string; cadastralKey: string; reason: string; source: "manual" | "parachute" }> = [];
        const liveContext = await sister.extractSearchContext();
        if (
          !sameContextValue(liveContext.municipality, job.municipality)
          || !sameContextValue(liveContext.street, job.street)
          || !sameContextValue(liveContext.civicNumber, job.civic_number)
        ) {
          throw new WorkerError(
            "La pagina SISTER aperta non corrisponde piÃ¹ alla ricerca salvata. Nessuna riga verrÃ  acquisita.",
            "needs_review",
            { portal: "SISTER", action: "search-context-identity", expected: { municipality: job.municipality, street: job.street, civicNumber: job.civic_number }, actual: liveContext },
            true,
          );
        }
        for (const [propertyIndex, property] of graph.properties.entries()) {
          this.throwIfCancellationRequested(job.id);
          const acquisition = isRecord(property.raw_payload?.acquisition) ? property.raw_payload.acquisition : {};
          if (isAcquisitionExcluded(property) || acquisition.status === "owners_acquired") continue;
          this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "acquisition", `Leggo i proprietari della riga ${propertyIndex + 1}`);
          if (this.isPropertySkipRequested(job.id, property.id)) {
            await this.markAcquisitionPropertyExcluded(property, "acquisition_skipped", "Riga saltata manualmente durante l'acquisizione");
            skippedRows.push({ propertyId: property.id, cadastralKey: property.cadastral_key, reason: "Riga saltata manualmente durante l'acquisizione", source: "manual" });
            continue;
          }
          let owners: Awaited<ReturnType<PlaywrightSisterAdapter["extractOwners"]>> | null = null;
          let lastExtractionError: WorkerError | null = null;
          let extractionAttempts = 0;
          for (let attempt = 1; attempt <= 2; attempt += 1) {
            extractionAttempts = attempt;
            try {
              owners = await sister.extractOwners(asProperty(property));
              break;
            } catch (error) {
              const workerError = error instanceof WorkerError
                ? error
                : new WorkerError(error instanceof Error ? error.message : String(error), "failed");
              if (workerError.status === "session_expired" || workerError.details.action === "property-row-identity") throw workerError;
              try {
                await sister.ensureResultsPage();
              } catch {
                throw workerError;
              }
              lastExtractionError = workerError;
              if (attempt < 2) {
                this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "acquisition_recovery", `Riga ${propertyIndex + 1}: ripristino la pagina SISTER e riprovo`);
                await new Promise((resolve) => setTimeout(resolve, 600));
              }
            }
          }
          if (!owners) {
            const reason = `Acquisizione isolata dopo 2 tentativi: ${lastExtractionError?.message ?? "errore non riconosciuto"}`;
            await this.markAcquisitionPropertyExcluded(property, "acquisition_failed", reason, lastExtractionError?.details);
            skippedRows.push({ propertyId: property.id, cadastralKey: property.cadastral_key, reason, source: "parachute" });
            continue;
          }
          if (this.isPropertySkipRequested(job.id, property.id)) {
            await this.markAcquisitionPropertyExcluded(property, "acquisition_skipped", "Riga saltata manualmente durante l'acquisizione");
            skippedRows.push({ propertyId: property.id, cadastralKey: property.cadastral_key, reason: "Riga saltata manualmente durante l'acquisizione", source: "manual" });
            continue;
          }
          const sourceRow = Number(property.raw_payload?.sourceOrder ?? property.raw_payload?.rowIndex);
          const businessSubjectsPresent = Number.isInteger(sourceRow) && sister.hasIgnoredBusinessOnRow(sourceRow);
          if (!owners.length && businessSubjectsPresent) {
            await this.markAcquisitionPropertyExcluded(property, "acquisition_skipped", "Riga esclusa: presenti soltanto intestatari aziendali");
            ignoredBusinessProperties.push(property.cadastral_key);
            skippedRows.push({ propertyId: property.id, cadastralKey: property.cadastral_key, reason: "Presenti soltanto intestatari aziendali", source: "parachute" });
            continue;
          }
          if (!owners.length) {
            const reason = "Nessun diritto di proprietÃ  interpretabile nella riga SISTER";
            await this.markAcquisitionPropertyExcluded(property, "acquisition_failed", reason);
            skippedRows.push({ propertyId: property.id, cadastralKey: property.cadastral_key, reason, source: "parachute" });
            continue;
          }
          for (const owner of owners) {
            this.throwIfCancellationRequested(job.id);
            if (this.isPropertySkipRequested(job.id, property.id)) break;
            await this.repository.insertOwner(job.id, property.id, owner);
          }
          if (this.isPropertySkipRequested(job.id, property.id)) {
            await this.markAcquisitionPropertyExcluded(property, "acquisition_skipped", "Riga saltata manualmente durante il salvataggio dell'acquisizione");
            skippedRows.push({ propertyId: property.id, cadastralKey: property.cadastral_key, reason: "Riga saltata manualmente durante il salvataggio dell'acquisizione", source: "manual" });
            continue;
          }
          property.raw_payload = {
            ...(property.raw_payload ?? {}),
            acquisition: {
              status: "owners_acquired",
              attempts: extractionAttempts,
              acquiredAt: new Date().toISOString(),
              businessSubjectsPresent,
            },
          };
          await this.repository.updatePropertyProcessing(property.id, { raw_payload: property.raw_payload, processing_status: "extracted" });
        }
        const finalGraph = await this.repository.loadGraph(job.id);
        const total = finalGraph.people.length;
        await this.repository.updateJob(job.id, { total_people: total, total_properties: finalGraph.properties.length });
        return {
          count: total,
          ignoredRights: sister.getIgnoredRights(),
          ignoredBusinesses: sister.getIgnoredBusinesses(),
          ignoredBusinessProperties,
          skippedRows,
        };
      }
      case "data_normalized": {
        const graph = await this.repository.loadGraph(job.id);
        const activeProperties = graph.properties.filter((property) => !isAcquisitionExcluded(property));
        const activePropertyIds = new Set(activeProperties.map((property) => property.id));
        const activeOwnerships = graph.ownerships.filter((ownership) => activePropertyIds.has(ownership.property_id));
        const activePersonIds = new Set(activeOwnerships.map((ownership) => ownership.person_id));
        const activePeople = graph.people.filter((person) => activePersonIds.has(person.id));
        const propertyIdsWithOwners = new Set(activeOwnerships.map((ownership) => ownership.property_id));
        const incompleteProperties = activeProperties.filter((item) => !item.sheet || !item.parcel || !item.subaltern);
        const incompletePeople = activePeople.filter((person) => !normalizeTaxCode(person.tax_code) || person.share_percentage == null);
        const propertiesWithoutOwners = activeProperties.filter((property) => !propertyIdsWithOwners.has(property.id));
        const nothingToImport = !activeProperties.length && !activePeople.length;
        if ((!nothingToImport && !activePeople.length) || incompleteProperties.length || incompletePeople.length || propertiesWithoutOwners.length) {
          throw new WorkerError("Dati obbligatori mancanti o quota non interpretabile", "data_incomplete", {
            propertyIds: incompleteProperties.map((item) => item.id), personIds: incompletePeople.map((item) => item.id),
            propertiesWithoutOwners: propertiesWithoutOwners.map((item) => item.id), noOwnersFound: !graph.people.length,
          });
        }
        await this.repository.markGraphNormalized(activeProperties, activePeople);
        return { properties: activeProperties.length, people: activePeople.length, excludedProperties: graph.properties.length - activeProperties.length, nothingToImport };
      }
      case "acquisition_reviewed": {
        const graph = await this.repository.loadGraph(job.id);
        const graphIndex = indexJobGraph(graph);
        const review: AcquisitionReview = {
          municipality: job.municipality,
          street: job.street,
          civicNumber: job.civic_number,
          properties: graph.properties.filter((property) => !isAcquisitionExcluded(property)).map((property) => ({
            id: property.id,
            cadastralKey: property.cadastral_key,
            address: property.address,
            category: property.category,
            class: property.class,
            consistency: property.consistency,
            cadastralIncome: property.cadastral_income,
            owners: (graphIndex.ownershipsByPropertyId.get(property.id) ?? [])
              .map((ownership) => ({ ownership, person: graphIndex.peopleById.get(ownership.person_id) }))
              .filter((entry): entry is { ownership: typeof graph.ownerships[number]; person: PersonRow } => Boolean(entry.person))
              .map(({ ownership, person }) => ({
                id: person.id,
                fullName: person.full_name,
                taxCode: person.tax_code,
                birthPlace: person.birth_place,
                birthDate: person.birth_date,
                sharePercentage: ownership.share_percentage,
              })),
          })),
          acquisitionIssues: graph.properties.filter(isAcquisitionExcluded).map((property) => ({
            id: property.id,
            cadastralKey: property.cadastral_key,
            address: property.address,
            status: property.processing_status,
            reason: String((isRecord(property.raw_payload?.acquisition) ? property.raw_payload.acquisition.reason : null) ?? "Riga esclusa dall'acquisizione"),
          })),
        };
        /* Con «Acquisisci e conserva» la domanda non si fa: i dati sono
         * gia' tutti li', e la decisione la prende chi apre l'archivio. */
        const decision = this.config.WORKER_KEEP_ACQUISITION
          ? "save" as const
          : await this.prompts.reviewAcquisition(review);
        if (decision === "cancel") {
          throw new WorkerError("Acquisizione annullata dal riepilogo. Premi “Riprendi” per controllarla di nuovo.", "paused", { propertyCount: review.properties.length });
        }
        return { confirmed: decision === "proceed", savedForLater: decision === "save", propertyCount: review.properties.length, ownerCount: graph.people.length };
      }
      case "properties_processed": {
        const before = await this.repository.loadGraph(job.id);
        for (const person of before.people) {
          const match = contacts.findByTaxCode(person.tax_code ?? "");
          await this.repository.updateContacts(person.id, match, person.raw_payload);
        }
        const graph = await this.repository.loadGraph(job.id);
        const propertyById = new Map(graph.properties.map((property) => [property.id, property]));
        const activityTasks = buildPropertyActivityTasks(graph);
        const mode = this.propertyActivityMode();
        const coordinator = new ImportV2Coordinator(this.repository, crmV2, { maxTransientAttempts: AUTOMATIC_OPERATION_ATTEMPTS });
        const result = await coordinator.runJob(job, (property, owners) => {
          const definition = propertyActivityDefinition(owners, directContactOrdinalForTask(activityTasks, property.id), mode);
          return definition
            ? { enabled: true, description: definition.description, contactMode: definition.contactMode, status: definition.status }
            : { enabled: false, description: null, contactMode: "Contatto diretto", status: "Eseguito" };
        });
        for (const outcome of result.completed) {
          await this.repository.updatePropertyProcessing(outcome.propertyId, {
            crm_record_id: outcome.crmPropertyId,
            processing_status: this.config.WORKER_DRY_RUN ? "dry_run" : "synced",
            raw_payload: { ...(propertyById.get(outcome.propertyId)?.raw_payload ?? {}), import_v2: { state: "completed", itemId: outcome.itemId, completedAt: new Date().toISOString() } },
          });
          for (const person of outcome.syncedPeople) {
            await this.repository.updatePersonProcessing(person.sourcePersonId, { crm_record_id: person.crmPersonId, processing_status: this.config.WORKER_DRY_RUN ? "dry_run" : "synced" });
          }
          for (const ownership of graph.ownerships.filter((item) => item.property_id === outcome.propertyId)) {
            await this.repository.updateOwnership(ownership.id, { processing_status: this.config.WORKER_DRY_RUN ? "dry_run" : "linked" });
          }
        }
        for (const outcome of result.quarantined) {
          await this.repository.updatePropertyProcessing(outcome.propertyId, {
            crm_record_id: outcome.crmPropertyId,
            processing_status: "quarantined",
            raw_payload: { ...(propertyById.get(outcome.propertyId)?.raw_payload ?? {}), import_v2: { state: "quarantined", itemId: outcome.itemId, failure: outcome.failure } },
          });
          for (const person of outcome.syncedPeople) {
            await this.repository.updatePersonProcessing(person.sourcePersonId, { crm_record_id: person.crmPersonId, processing_status: this.config.WORKER_DRY_RUN ? "dry_run" : "synced" });
          }
          for (const ownership of graph.ownerships.filter((item) => item.property_id === outcome.propertyId)) {
            await this.repository.updateOwnership(ownership.id, { processing_status: "quarantined" });
          }
        }
        const after = await this.repository.loadGraph(job.id);
        for (const person of after.people.filter((candidate) => !["synced", "dry_run", "manual", "quarantined"].includes(candidate.processing_status))) {
          const links = after.ownerships.filter((ownership) => ownership.person_id === person.id);
          if (links.length && links.every((ownership) => ownership.processing_status === "quarantined")) {
            await this.repository.updatePersonProcessing(person.id, { processing_status: "quarantined" });
          }
        }
        await this.repository.updateJob(job.id, { processed_properties: result.completed.length });
        if (result.paused) {
          throw new WorkerError(
            result.paused.failure?.message ?? "Import V2 in pausa",
            result.paused.failure?.kind === "global_session" ? "session_expired" : "portal_error",
            { importV2: true, failure: result.paused.failure },
            true,
          );
        }
        assertImportV2BatchComplete(result);
        return { version: 2, completed: result.completed.length, quarantined: result.quarantined.length };
      }
      case "person_searched": {
        const graph = await this.repository.loadGraph(job.id);
        for (const row of graph.people) {
          this.throwIfCancellationRequested(job.id);
          if (["matched", "not_found"].includes(row.processing_status) && Array.isArray(row.raw_payload?.crm_matches)) continue;
          const person = asPerson(row);
          if (!person.taxCode) throw new WorkerError("Codice fiscale mancante", "data_incomplete", { personId: row.id });
          const result = await crm.findPerson({ taxCode: person.taxCode, phones: [], fullName: person.fullName, birthDate: person.birthDate });
          if (result.matches.length > 1) {
            const selected = selectRandomCrmCandidate(result.matches);
            await this.repository.updatePersonProcessing(row.id, {
              crm_record_id: selected?.id ?? null,
              processing_status: selected ? "matched" : "not_found",
              raw_payload: {
                ...(row.raw_payload ?? {}),
                crm_matches: selected ? [selected] : [],
                crm_duplicate_candidates: result.matches,
                force_new_person: false,
                person_search: {
                  searchedAt: new Date().toISOString(),
                  candidateCount: result.matches.length,
                  verifiedCount: result.matches.length,
                  exactTaxCodeRequired: true,
                  selectionPolicy: "random-exact-tax-code-candidate",
                  selectedPersonId: selected?.id ?? null,
                },
              },
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
        const graphIndex = indexJobGraph(graph);
        for (const row of graph.properties) {
          this.throwIfCancellationRequested(job.id);
          if (["matched", "not_found"].includes(row.processing_status) && Object.prototype.hasOwnProperty.call(row.raw_payload ?? {}, "checked_from_people")) continue;
          const owners = (graphIndex.ownershipsByPropertyId.get(row.id) ?? [])
            .map((ownership) => graphIndex.peopleById.get(ownership.person_id))
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
        const graphIndex = indexJobGraph(graph);
        let processed = 0;
        for (const row of graph.properties) {
          this.throwIfCancellationRequested(job.id);
          if (["synced", "dry_run"].includes(row.processing_status) && row.crm_record_id) {
            processed += 1;
            continue;
          }
          const property = asProperty(row);
          const owner = graphIndex.ownershipsByPropertyId.get(row.id)?.[0];
          const person = owner ? graphIndex.peopleById.get(owner.person_id) : undefined;
          if (job.mode === "assisted" && person) {
            const decision = await this.prompts.confirmSave(`${personSummary(asPerson(person), property)}\nOperazione prevista: ${row.crm_record_id ? "riutilizzo in sola lettura dell'immobile esistente" : "creazione immobile"}`);
            if (decision === "skip") { await this.repository.updatePropertyProcessing(row.id, { processing_status: "skipped" }); continue; }
            if (decision === "review") throw new WorkerError("Immobile segnato da verificare", "needs_review", { propertyId: row.id });
            if (decision === "manual") { await this.prompts.waitForManualEdit(); await this.repository.updatePropertyProcessing(row.id, { processing_status: "manual" }); processed += 1; continue; }
          }
          if (row.crm_record_id) {
            const verified = await crm.verifyProperty(row.crm_record_id, property);
            if (!verified.match) {
              throw new WorkerError(
                "L'immobile esistente non supera la verifica completa. Non verra' modificato.",
                "needs_review",
                { propertyId: row.id, crmPropertyId: row.crm_record_id, action: "legacy-existing-property-identity-mismatch" },
                true,
              );
            }
            row.raw_payload = {
              ...(row.raw_payload ?? {}),
              existing_property_reused: { crmPropertyId: row.crm_record_id, mode: "read_only", verifiedAt: new Date().toISOString() },
            };
            await this.repository.updatePropertyProcessing(row.id, { raw_payload: row.raw_payload });
          } else {
            await this.logPropertyChanges(job.id, row, property);
            await this.repository.updatePropertyProcessing(row.id, { crm_record_id: await crm.createProperty(property) });
          }
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
            const activityDefinition = propertyActivityDefinition(
              task.owners,
              directContactOrdinalForTask(tasks, task.property.id),
              this.propertyActivityMode(),
            );
            /* Modalità «nessuna attività»: il diario del gestionale non si
             * tocca. Il checkpoint si scrive lo stesso, altrimenti la ripresa
             * di una run interrotta tornerebbe a proporre questi immobili. */
            if (!activityDefinition) {
              await persist(task, activityCheckpoint({
                state: "skipped", dryRun: this.config.WORKER_DRY_RUN, crmPropertyId: task.property.crm_record_id!,
                crmActivityId: null, correlatedProperty: null, attempts: 0, error: null,
                description: NO_ACTIVITY_DESCRIPTION, status: PROPERTY_ACTIVITY_STATUS, contactMode: PROPERTY_ACTIVITY_CONTACT_MODE,
              }));
              metrics.skipped += 1;
              continue;
            }
            const previous = task.property.raw_payload?.worker_activity as Partial<PropertyActivityCheckpoint> | undefined;
            const attempts = Number(previous?.attempts ?? 0) + 1;
            if (job.mode === "assisted" && !prompted.has(task.property.id)) {
              prompted.add(task.property.id);
              const decision = await this.prompts.confirmSave(propertyActivitySummary(property, task.owners.map((owner) => owner.full_name), activityDefinition));
              if (decision === "skip") {
                await persist(task, activityCheckpoint({
                  state: "skipped", dryRun: this.config.WORKER_DRY_RUN, crmPropertyId: task.property.crm_record_id!,
                  crmActivityId: null, correlatedProperty: null, attempts, error: null,
                  description: activityDefinition.description, status: activityDefinition.status, contactMode: activityDefinition.contactMode,
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
                  description: activityDefinition.description, status: activityDefinition.status, contactMode: activityDefinition.contactMode,
                }));
                metrics.existing += 1;
                continue;
              }
            }

            await persist(task, activityCheckpoint({
              state: "preparing", dryRun: this.config.WORKER_DRY_RUN, crmPropertyId: task.property.crm_record_id!,
              crmActivityId: null, correlatedProperty: null, attempts, error: null,
              description: activityDefinition.description, status: activityDefinition.status, contactMode: activityDefinition.contactMode,
            }));
            try {
              const result = await crm.createPropertyActivity({
                propertyId: task.property.crm_record_id!,
                propertyAddress: task.property.address,
                fallbackPersonId: task.fallbackPersonId,
                fallbackPersonLabel: task.owners[0]?.full_name,
                description: activityDefinition.description,
                contactMode: activityDefinition.contactMode,
                status: activityDefinition.status,
                interruptionRequested: () => this.interruptionFor(job.id, task.property.id),
              });
              await persist(task, activityCheckpoint({
                state: result.outcome, dryRun: this.config.WORKER_DRY_RUN, crmPropertyId: task.property.crm_record_id!,
                crmActivityId: result.crmActivityId, correlatedProperty: result.correlatedProperty,
                attempts: attempts + result.attempts - 1, error: null,
                description: activityDefinition.description, status: activityDefinition.status, contactMode: activityDefinition.contactMode,
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
                description: activityDefinition.description, status: activityDefinition.status, contactMode: activityDefinition.contactMode,
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
            await crm.syncPersonContacts(row.crm_record_id, asPerson(refreshed));
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
        const activePropertyIds = new Set(graph.properties.filter((property) => !isAcquisitionExcluded(property)).map((property) => property.id));
        const activeOwnerships = graph.ownerships.filter((ownership) => activePropertyIds.has(ownership.property_id));
        const activePersonIds = new Set(activeOwnerships.map((ownership) => ownership.person_id));
        const pending = [
          ...graph.properties.filter((property) => activePropertyIds.has(property.id) && !["synced", "dry_run"].includes(property.processing_status)),
          ...graph.people.filter((person) => activePersonIds.has(person.id) && !["synced", "dry_run"].includes(person.processing_status)),
          ...activeOwnerships.filter((ownership) => !["linked", "dry_run"].includes(ownership.processing_status)),
        ];
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

  private async markAcquisitionPropertyExcluded(
    property: PropertyRow,
    status: "acquisition_skipped" | "acquisition_failed",
    reason: string,
    details: Record<string, unknown> = {},
  ) {
    const graph = await this.repository.loadGraph(property.job_id);
    const graphIndex = indexJobGraph(graph);
    const excludedAt = new Date().toISOString();
    property.raw_payload = {
      ...(property.raw_payload ?? {}),
      acquisition: {
        status,
        reason,
        details,
        excludedAt,
        sourceRow: property.raw_payload?.sourceOrder ?? property.raw_payload?.rowIndex ?? null,
      },
    };
    await this.repository.updatePropertyProcessing(property.id, {
      processing_status: status,
      raw_payload: property.raw_payload,
    });
    const relatedOwnerships = graphIndex.ownershipsByPropertyId.get(property.id) ?? [];
    for (const ownership of relatedOwnerships) {
      await this.repository.updateOwnership(ownership.id, { processing_status: status });
      const hasAnotherActiveProperty = (graphIndex.ownershipsByPersonId.get(ownership.person_id) ?? []).some((candidate) => {
        if (candidate.property_id === property.id) return false;
        const otherProperty = graphIndex.propertiesById.get(candidate.property_id);
        return Boolean(otherProperty && !isAcquisitionExcluded(otherProperty));
      });
      if (!hasAnotherActiveProperty) {
        await this.repository.updatePersonProcessing(ownership.person_id, { processing_status: status });
      }
    }
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
    const maximumAttempts = maximumAttemptsOverride ?? AUTOMATIC_OPERATION_ATTEMPTS;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      this.throwIfCancellationRequested(job.id);
      this.throwIfPropertySkipRequested(job.id, property.id);
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const workerError = asWorkerError(error);
        const action = String(workerError.details.action ?? "");
        const retryWouldBeUnsafe = ["paused", "needs_review", "data_incomplete", "session_expired"].includes(workerError.status)
          || /save-uncertain|creation-submitted|save-submitted/i.test(action);
        if (
          retryWouldBeUnsafe
          || isRejectedTaxCodeError(workerError)
          || workerError.details.skipProperty === true
          || attempt === maximumAttempts
        ) {
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
      property_flow: { version: 4, stage, dryRun: this.config.WORKER_DRY_RUN, updatedAt: new Date().toISOString() },
    };
    await this.repository.updatePropertyProcessing(property.id, {
      raw_payload: property.raw_payload,
      ...(stage === "completed" || stage === "skipped" ? { processing_status: stage } : {}),
    });
  }

  private async markImportPropertySkipped(
    property: PropertyRow,
    reason: string,
    details: Record<string, unknown> = { source: "manual", attempts: 0 },
  ) {
    const graph = await this.repository.loadGraph(property.job_id);
    const graphIndex = indexJobGraph(graph);
    const skippedAt = new Date().toISOString();
    const relatedOwnerships = graphIndex.ownershipsByPropertyId.get(property.id) ?? [];
    const relatedPersonIds = [...new Set(relatedOwnerships.map((ownership) => ownership.person_id))];
    property.raw_payload = {
      ...(property.raw_payload ?? {}),
      property_flow: { version: 4, stage: "skipped", dryRun: this.config.WORKER_DRY_RUN, updatedAt: skippedAt },
      skip_details: { ...details, reason, personIds: relatedPersonIds, skippedAt },
    };
    await this.repository.updatePropertyProcessing(property.id, {
      processing_status: "skipped",
      raw_payload: property.raw_payload,
    });
    for (const ownership of relatedOwnerships) {
      await this.repository.updateOwnership(ownership.id, { processing_status: "skipped" });
    }
    for (const personId of relatedPersonIds) {
      const hasAnotherActiveProperty = (graphIndex.ownershipsByPersonId.get(personId) ?? []).some((ownership) => {
        if (ownership.property_id === property.id) return false;
        const otherProperty = graphIndex.propertiesById.get(ownership.property_id);
        return Boolean(otherProperty && !["skipped", "acquisition_skipped", "acquisition_failed"].includes(otherProperty.processing_status));
      });
      if (!hasAnotherActiveProperty) await this.repository.updatePersonProcessing(personId, { processing_status: "skipped" });
    }
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
      ["completed", "skipped", "acquisition_skipped", "acquisition_failed"].includes(property.processing_status)
      || ["completed", "skipped"].includes(String((property.raw_payload?.property_flow as { stage?: string } | undefined)?.stage ?? "")),
    ).length;
    const plan = buildPropertyWorkPlan(graph);
    const activePersonIds = new Set(plan.flatMap((item) => item.owners.map((owner) => owner.person.id)));
    propertyLoop: for (const [propertyIndex, item] of plan.entries()) {
      this.throwIfCancellationRequested(job.id);
      const propertyStartedAt = Date.now();
      const { property, owners } = item;
      let primary = item.primary;
      let coowners = item.coowners;
      let activeOwners = owners;
      // The operator can change this preference during a run. Freeze it only
      // for the property currently in flight, then read it again for the next.
      const propertyActivityMode = this.propertyActivityMode();
      const stageOrder = [
        "ready",
        "owner_contacts_ready",
        "owners_ready",
        "contacts_synced",
        "property_ready",
        "owners_linked",
        "activity_ready",
        "completed",
      ];
      propertyRecovery: for (
        let reanalysisAttempt = 0;
        reanalysisAttempt <= AUTOMATIC_PROPERTY_REANALYSES;
        reanalysisAttempt += 1
      ) {
        this.throwIfCancellationRequested(job.id);
        const savedPropertyFlow = property.raw_payload?.property_flow as { stage?: string; version?: number } | undefined;
        let propertyStage = String(savedPropertyFlow?.stage ?? "ready");
        if (Number(savedPropertyFlow?.version ?? 0) < 3 && !["completed", "skipped"].includes(propertyStage)) {
        const singleOwnerStageMap: Record<string, string> = {
          primary_contacts_ready: "owner_contacts_ready",
          primary_ready: "owners_ready",
          contacts_synced: "contacts_synced",
          property_ready: "property_ready",
          activity_ready: "activity_ready",
        };
          propertyStage = coowners.length ? "ready" : singleOwnerStageMap[propertyStage] ?? "ready";
        }
        // V3 created the activity before linking co-owners. Replaying from the
        // property checkpoint is safe because activity creation has its own
        // idempotency checkpoint, and guarantees no co-owner is skipped.
        if (Number(savedPropertyFlow?.version ?? 0) === 3 && propertyStage === "activity_ready") {
          propertyStage = "property_ready";
        }
        const stageReached = (target: string) => stageOrder.indexOf(propertyStage) >= stageOrder.indexOf(target);
        const advanceStage = async (stage: string) => {
          await this.markPropertyStage(property, stage);
          propertyStage = stage;
        };
        if (["completed", "skipped"].includes(property.processing_status) || stageReached("completed")) continue propertyLoop;
        try {
        const previouslyRejectedOwners = owners.filter((owner) => hasRejectedTaxCodeCheckpoint(owner.person));
        if (previouslyRejectedOwners.length) {
          activeOwners = owners.filter((owner) => !previouslyRejectedOwners.includes(owner));
          if (activeOwners.length) {
            primary = activeOwners[0]!;
            coowners = activeOwners.slice(1);
          } else {
            throw new WorkerError(
              "Nessun socio utilizzabile: il codice fiscale dell'unico proprietario e stato rifiutato dal gestionale.",
              "data_incomplete",
              { skipProperty: true, action: "property-no-valid-owners", propertyId: property.id },
            );
          }
        }
        if (!stageReached("owner_contacts_ready")) {
          this.throwIfPropertySkipRequested(job.id, property.id);
          this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "contacts", `Leggo da Excel i recapiti di tutti i ${owners.length} proprietari, senza ancora toccare il gestionale`);
          for (const owner of owners) {
            await this.withAutomaticRecovery(job, property, propertyIndex + 1, graph.properties.length, `Recapiti Excel di ${owner.person.full_name}`, () =>
              this.ensureContacts(job, owner.person, crm, contacts, false));
          }
          await advanceStage("owner_contacts_ready");
        }

        if (!stageReached("owners_ready")) {
          this.throwIfPropertySkipRequested(job.id, property.id);
          const ignoredOwners: typeof owners = [];
          for (const [ownerIndex, owner] of owners.entries()) {
            this.throwIfPropertySkipRequested(job.id, property.id);
            if (hasRejectedTaxCodeCheckpoint(owner.person)) {
              ignoredOwners.push(owner);
              continue;
            }
            this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "owners", `Verifico il proprietario ${ownerIndex + 1} di ${owners.length}: ${owner.person.full_name}`);
            try {
              await this.withAutomaticRecovery(job, property, propertyIndex + 1, graph.properties.length, `Scheda nominativo ${owner.person.full_name}`, () =>
                this.ensurePerson(job, owner.person, crm));
            } catch (error) {
              if (!isRejectedTaxCodeError(error)) throw error;
              const rejectedAt = new Date().toISOString();
              owner.person.raw_payload = {
                ...(owner.person.raw_payload ?? {}),
                tax_code_rejection: {
                  action: "person-tax-code-invalid",
                  rejectedAt,
                  source: "crm-validation",
                },
              };
              await this.repository.updatePersonProcessing(owner.person.id, {
                processing_status: "invalid_tax_code",
                raw_payload: owner.person.raw_payload,
              });
              await this.repository.updateOwnership(owner.ownership.id, {
                processing_status: "ignored_tax_code",
              });
              ignoredOwners.push(owner);
              await this.repository.logChange(
                job.id,
                "person",
                owner.person.tax_code ?? owner.person.id,
                "tax_code_rejected_by_crm",
                null,
                "Nominativo escluso dal solo immobile: codice fiscale SISTER rifiutato dal gestionale",
                "WORKER",
              );
              this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "owner_ignored", `Ignoro ${owner.person.full_name}: il gestionale rifiuta il suo codice fiscale; continuo con gli altri soci`);
              continue;
            }
            if (!owner.person.crm_record_id) {
              throw new WorkerError(
                "Tutti i proprietari devono avere una scheda verificata prima di creare l'immobile.",
                "needs_review",
                { personId: owner.person.id, propertyId: property.id, action: "property-owner-missing-person" },
                true,
              );
            }
          }
          activeOwners = owners.filter(
            (owner) => !ignoredOwners.includes(owner) && Boolean(owner.person.crm_record_id),
          );
          if (!activeOwners.length) {
            throw new WorkerError(
              "Nessun socio utilizzabile: il codice fiscale dell'unico proprietario e stato rifiutato dal gestionale.",
              "data_incomplete",
              { skipProperty: true, action: "property-no-valid-owners", propertyId: property.id },
            );
          }
          primary = activeOwners[0]!;
          coowners = activeOwners.slice(1);
          if (ignoredOwners.length) {
            property.raw_payload = {
              ...(property.raw_payload ?? {}),
              ignored_tax_code_owners: ignoredOwners.map((owner) => ({
                personId: owner.person.id,
                fullName: owner.person.full_name,
                sharePercentage: owner.ownership.share_percentage,
              })),
              effective_primary_owner_id: primary.person.id,
            };
            await this.repository.updatePropertyProcessing(property.id, {
              raw_payload: property.raw_payload,
            });
          }
          await advanceStage("owners_ready");
        }

        if (!stageReached("contacts_synced")) {
          this.throwIfPropertySkipRequested(job.id, property.id);
          this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "contacts_sync", "Confronto i recapiti di tutti i proprietari e aggiungo solo quelli assenti");
          for (const owner of activeOwners) {
            await this.withAutomaticRecovery(job, property, propertyIndex + 1, graph.properties.length, `Assegnazione recapiti di ${owner.person.full_name}`, () =>
              this.ensureContacts(job, owner.person, crm, contacts, true));
          }
          await advanceStage("contacts_synced");
        }

        if (!stageReached("property_ready")) {
          this.throwIfPropertySkipRequested(job.id, property.id);
          this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "property", "Abbino gli indirizzi sotto tutti i proprietari e verifico i dati catastali");
          await this.withAutomaticRecovery(job, property, propertyIndex + 1, graph.properties.length, "Passaggio nominativo-immobile", () =>
            this.ensureProperty(job, property, primary.person, crm, activeOwners.map((owner) => owner.person)));
          await advanceStage("property_ready");
        }

        this.throwIfPropertySkipRequested(job.id, property.id);

        if (!stageReached("owners_linked")) {
          this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "ownership", `Verifico tutti i proprietari già collegati e associo solo quelli mancanti`);
          if (!property.crm_record_id || !primary.person.crm_record_id) {
            throw new WorkerError("Immobile o proprietario principale non disponibili per collegare i comproprietari", "data_incomplete", { propertyId: property.id });
          }
          const notes: string[] = [];
          const propertySearchCheckpoint = isRecord(property.raw_payload?.property_search)
            ? property.raw_payload.property_search
            : {};
          const verifiedLinkedOwnerCrmIds = Array.isArray(propertySearchCheckpoint.verifiedLinkedOwnerCrmIds)
            ? propertySearchCheckpoint.verifiedLinkedOwnerCrmIds.filter((value): value is string => typeof value === "string" && Boolean(value))
            : [];
          const linkedOwnerIds = new Set([
            ...(await crm.findLinkedOwnerIds(property.crm_record_id)),
            ...verifiedLinkedOwnerCrmIds,
            primary.person.crm_record_id,
          ]);
          const existingLinksBeforeSync = [...linkedOwnerIds];
          const allOwners = [primary, ...coowners];
          primary.ownership.crm_link_id ||= `primary-link-${primary.person.crm_record_id}`;
          primary.ownership.processing_status = "verified_existing";
          await this.repository.updateOwnership(primary.ownership.id, {
            crm_link_id: primary.ownership.crm_link_id,
            processing_status: primary.ownership.processing_status,
          });
          const ownersToLink = coowners.filter((owner) =>
            owner.person.id !== primary.person.id
            && owner.person.crm_record_id !== primary.person.crm_record_id);
          for (const owner of ownersToLink) {
            this.throwIfPropertySkipRequested(job.id, property.id);
            if (!owner.person.crm_record_id || owner.ownership.share_percentage == null) {
              throw new WorkerError(
                "Scheda o quota del comproprietario non disponibile",
                "data_incomplete",
                { propertyId: property.id, personId: owner.person.id, ownershipId: owner.ownership.id },
              );
            }
            if (linkedOwnerIds.has(owner.person.crm_record_id)) {
              owner.ownership.crm_link_id = `existing-link-${owner.person.crm_record_id}`;
              owner.ownership.processing_status = "verified_existing";
              await this.repository.updateOwnership(owner.ownership.id, {
                crm_link_id: owner.ownership.crm_link_id,
                processing_status: "verified_existing",
              });
              continue;
            }
            if (owner.ownership.processing_status === "submitted_unverified") {
              const refreshedIds = new Set(await crm.findLinkedOwnerIds(property.crm_record_id, true));
              if (refreshedIds.has(owner.person.crm_record_id)) {
                linkedOwnerIds.add(owner.person.crm_record_id);
                owner.ownership.crm_link_id = `existing-link-${owner.person.crm_record_id}`;
                owner.ownership.processing_status = "verified_existing";
                await this.repository.updateOwnership(owner.ownership.id, {
                  crm_link_id: owner.ownership.crm_link_id,
                  processing_status: "verified_existing",
                });
              } else {
                notes.push(`Collegamento di ${owner.person.full_name} già salvato e ancora in propagazione nel pannello; nessun secondo inserimento eseguito.`);
              }
              continue;
            }
            const name = splitPersonName(owner.person.full_name, owner.person.tax_code);
            const searchLabel = [name.firstName, name.lastName].filter(Boolean).join(" ") || owner.person.full_name;
            const link = await this.withAutomaticRecovery(job, property, propertyIndex + 1, graph.properties.length, `Collegamento comproprietario ${owner.person.full_name}`, () =>
              crm.linkOwner(property.crm_record_id!, {
                personId: owner.person.crm_record_id!,
                searchLabel,
                phones: [...owner.person.mobiles, ...owner.person.landlines],
                interruptionRequested: () => this.interruptionFor(job.id, property.id),
              }, owner.ownership.share_percentage!));
            owner.ownership.crm_link_id = link.linkId;
            if (link.selection !== "saved_unverified") linkedOwnerIds.add(owner.person.crm_record_id);
            owner.ownership.processing_status = link.selection === "saved_unverified"
              ? "submitted_unverified"
              : link.selection === "existing" ? "verified_existing" : "linked";
            await this.repository.updateOwnership(owner.ownership.id, {
              crm_link_id: link.linkId,
              processing_status: owner.ownership.processing_status,
            });
            if (link.note) {
              notes.push(link.note);
              await this.repository.logChange(job.id, "property", property.cadastral_key, "correlated_owner_selection_note", null, link.note, "WORKER");
            }
          }
          if (!this.config.WORKER_DRY_RUN && ownersToLink.length) {
            // linkOwner has already checked the panel and performed its one
            // allowed refresh after Salva. Read the current card once: more
            // reloads only amplify Lightning's eventual-consistency delay.
            const verifiedOwnerIds = new Set(await crm.findLinkedOwnerIds(property.crm_record_id));
            for (const owner of ownersToLink) {
              const visible = Boolean(owner.person.crm_record_id && verifiedOwnerIds.has(owner.person.crm_record_id));
              owner.ownership.crm_link_id ||= visible
                ? `existing-link-${owner.person.crm_record_id}`
                : `saved-owner-link-${owner.person.crm_record_id}`;
              owner.ownership.processing_status = visible ? "verified_existing" : "submitted_unverified";
              await this.repository.updateOwnership(owner.ownership.id, {
                crm_link_id: owner.ownership.crm_link_id,
                processing_status: owner.ownership.processing_status,
              });
            }
          }
          const submittedOwners = ownersToLink.filter((owner) => owner.ownership.processing_status === "submitted_unverified").length;
          property.raw_payload = {
            ...(property.raw_payload ?? {}),
            correlated_owners: {
              state: "linked",
              count: allOwners.length,
              linked: allOwners.length,
              submittedPendingVisibility: submittedOwners,
              primaryPersonId: primary.person.id,
              primarySharePercentage: primary.ownership.share_percentage,
              existingLinksBeforeSync,
              notes,
              updatedAt: new Date().toISOString(),
            },
          };
          await this.repository.updatePropertyProcessing(property.id, { raw_payload: property.raw_payload });
          await advanceStage("owners_linked");
        }
        if (!stageReached("activity_ready")) {
          this.throwIfPropertySkipRequested(job.id, property.id);
          this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "activity", "Apro l’attività dall’immobile verificato, compilo la descrizione e salvo");
          await this.withAutomaticRecovery(job, property, propertyIndex + 1, graph.properties.length, "Attività immobile", () =>
            this.ensurePropertyActivity(
              job,
              property,
              primary.person,
              activeOwners.map((owner) => owner.person),
              crm,
              directContactOrdinalForTask(buildPropertyActivityTasks(graph), property.id),
              propertyActivityMode,
            ));
          await advanceStage("activity_ready");
        }
        await advanceStage("completed");
        completed += 1;
        await this.repository.updateJob(job.id, { processed_properties: completed });
        const propertyDurationMs = Date.now() - propertyStartedAt;
        logger.info(
          {
            jobId: job.id,
            propertyId: property.id,
            index: propertyIndex + 1,
            total: graph.properties.length,
            owners: activeOwners.length,
            durationMs: propertyDurationMs,
          },
          "Immobile completato",
        );
        this.emitPropertyProgress(
          job,
          property,
          propertyIndex + 1,
          graph.properties.length,
          "completed",
          `Immobile ${propertyIndex + 1} di ${graph.properties.length} completato in ${Math.round(propertyDurationMs / 1000)} s`,
        );
        if (this.isStopAfterNextImportRequested(job.id)) {
          throw new WorkerError(
            "Run fermata dopo il prossimo import: il resto della lavorazione resta salvato e riprendibile.",
            "paused",
            { pauseRequested: true, stopAfterNextImport: true, propertyId: property.id, propertyIndex: propertyIndex + 1 },
          );
        }
        break propertyRecovery;
      } catch (error) {
        const workerError = asWorkerError(error);
        if (workerError.details.skipProperty === true || this.isPropertySkipRequested(job.id, property.id)) {
          await crm.resetToCrmHome();
          const noValidOwners = workerError.details.action === "property-no-valid-owners";
          await this.markImportPropertySkipped(
            property,
            noValidOwners
              ? "Saltato: nessun socio associabile dopo il rifiuto del codice fiscale da parte del gestionale"
              : "Saltato manualmente dall'utente",
            noValidOwners
              ? { source: "tax_code_rejected_no_alternative_owner", attempts: 0 }
              : undefined,
          );
          completed += 1;
          await this.repository.updateJob(job.id, { processed_properties: completed });
          this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "skipped", noValidOwners ? "Immobile annotato: nessun socio valido dopo il rifiuto del codice fiscale; continuo con il successivo" : "Immobile saltato; continuo con il successivo");
          continue propertyLoop;
        }
        if (workerError.status === "paused") throw workerError;
        // Deterministic identity/relationship conflicts need human review.
        // Retrying or quarantining the whole property would hide a missing
        // co-owner and incorrectly let the import look complete.
        if (workerError.status === "needs_review") throw workerError;
        const automaticRetry = isRecord(property.raw_payload?.automatic_retry)
          ? property.raw_payload.automatic_retry
          : {};
        const normalPropertyAttempts = workerError.details.automaticRecoveryExhausted === true
          ? AUTOMATIC_OPERATION_ATTEMPTS
          : Number(automaticRetry.normalPropertyAttempts ?? 0) + 1;
        if (normalPropertyAttempts < AUTOMATIC_OPERATION_ATTEMPTS) {
          property.raw_payload = {
            ...(property.raw_payload ?? {}),
            automatic_retry: {
              ...automaticRetry,
              normalPropertyAttempts,
              reanalysisAttempts: reanalysisAttempt,
              lastError: workerError.message,
              updatedAt: new Date().toISOString(),
            },
          };
          await this.repository.updatePropertyProcessing(property.id, {
            raw_payload: property.raw_payload,
          });
          this.emitPropertyProgress(
            job,
            property,
            propertyIndex + 1,
            graph.properties.length,
            "recovery",
            `Recupero automatico immobile ${normalPropertyAttempts + 1} di ${AUTOMATIC_OPERATION_ATTEMPTS}`,
          );
          await new Promise((resolve) => setTimeout(resolve, 900 * normalPropertyAttempts));
          reanalysisAttempt -= 1;
          continue propertyRecovery;
        }
        if (reanalysisAttempt < AUTOMATIC_PROPERTY_REANALYSES) {
          await this.reanalyzePropertyAutomatically(
            job,
            property,
            propertyIndex + 1,
            graph.properties.length,
            reanalysisAttempt + 1,
            workerError,
            crm,
          );
          continue propertyRecovery;
        }
        const automaticSkipReason = `Saltato dopo ${AUTOMATIC_OPERATION_ATTEMPTS} tentativi e ${AUTOMATIC_PROPERTY_REANALYSES} rianalisi automatiche: ${workerError.message}`;
        await crm.resetToCrmHome().catch(() => undefined);
        await this.markImportPropertySkipped(property, automaticSkipReason, {
          source: "automatic_reanalysis_exhausted",
          normalAttempts: Number(workerError.details.automaticAttempts ?? AUTOMATIC_OPERATION_ATTEMPTS),
          reanalysisAttempts: AUTOMATIC_PROPERTY_REANALYSES,
          lastError: workerError.message,
        });
        completed += 1;
        await this.repository.updateJob(job.id, { processed_properties: completed });
        this.emitPropertyProgress(job, property, propertyIndex + 1, graph.properties.length, "skipped", "Immobile non completabile dopo i recuperi automatici; continuo con il successivo");
        continue propertyLoop;
      }
      }
    }
    await this.repository.updateJob(job.id, { processed_properties: completed, processed_people: activePersonIds.size });
    return {
      processedProperties: completed,
      totalProperties: graph.properties.length,
      processedPeople: activePersonIds.size,
      linkedCorrelatedPeople: Math.max(0, activePersonIds.size - new Set(plan.map((item) => item.primary.person.id)).size),
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
    if (
      existingCheckpoint?.complete === true
      && Number(existingCheckpoint.version ?? 0) >= 4
      && existingCheckpoint.dryRun === this.config.WORKER_DRY_RUN
      && row.crm_record_id
    ) {
      if (this.config.WORKER_DRY_RUN && row.crm_record_id.startsWith("dry-person-")) return;
      const verifiedCheckpoint = await crm.openExistingPerson(searchInput, row.crm_record_id);
      if (verifiedCheckpoint) {
        row.crm_record_id = verifiedCheckpoint.id;
        row.raw_payload = {
          ...(row.raw_payload ?? {}),
          person_flow: {
            ...existingCheckpoint,
            version: 4,
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
      row.crm_record_id = verifiedAfterMerge.id;
      row.processing_status = this.config.WORKER_DRY_RUN ? "dry_run" : "synced";
      row.raw_payload = { ...(row.raw_payload ?? {}), person_flow: { version: 4, complete: true, identityVerified: true, dryRun: this.config.WORKER_DRY_RUN, crmPersonId: row.crm_record_id, updatedAt: new Date().toISOString() } };
      await this.repository.updatePersonProcessing(row.id, { crm_record_id: row.crm_record_id, processing_status: row.processing_status, raw_payload: row.raw_payload });
      return;
    }
    const result = await crm.findPerson(searchInput);
    const phoneAssignments = result.matches.filter((match) => isRecord(match.data) && match.data.source === "crm-phone-search");
    const candidates = result.matches.filter((match) => !phoneAssignments.includes(match));
    const verifiedCandidates: Array<(typeof candidates)[number]> = [];
    for (const candidate of candidates) {
      const verified = await crm.openExistingPerson(searchInput, candidate.id);
      if (!verified) continue;
      verifiedCandidates.push({ ...candidate, id: verified.id, data: { ...candidate.data, ...verified.data } });
    }
    let selectedMatch: (typeof candidates)[number] | null = verifiedCandidates[0] ?? null;
    if (verifiedCandidates.length > 1) {
      selectedMatch = selectRandomCrmCandidate(verifiedCandidates);
    }
    const multipleVerifiedCandidates = verifiedCandidates.length > 1;
    row.raw_payload = {
      ...(row.raw_payload ?? {}),
      crm_matches: selectedMatch ? [selectedMatch] : [],
      ...(multipleVerifiedCandidates ? { crm_duplicate_candidates: verifiedCandidates } : {}),
      force_new_person: false,
      contact_assignments_detected: phoneAssignments,
      person_search: {
        searchedAt: new Date().toISOString(),
        candidateCount: candidates.length,
        verifiedCount: verifiedCandidates.length,
        exactTaxCodeRequired: true,
        selectionPolicy: multipleVerifiedCandidates ? "random-exact-tax-code-candidate" : "single-verified-tax-code-result",
        selectedPersonId: selectedMatch?.id ?? null,
        ignoredLaterCandidates: Math.max(0, candidates.length - verifiedCandidates.length),
      },
    };
    if (selectedMatch) {
      row.crm_record_id = selectedMatch.id;
      // Exact tax-code identity is authoritative. Refresh every non-contact
      // field from SISTER; phones and emails are merged additively later.
      await this.logPersonChanges(job.id, row, person);
      await crm.updatePerson(row.crm_record_id, person);
      row.processing_status = this.config.WORKER_DRY_RUN ? "dry_run" : "reused";
      row.raw_payload = {
        ...(row.raw_payload ?? {}),
        person_flow: {
          version: 4,
          complete: true,
          existing: true,
          identityVerified: true,
          selectionPolicy: multipleVerifiedCandidates ? "random-exact-tax-code-candidate" : "single-verified-tax-code-result",
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
      row.crm_record_id = verifiedCreated.id;
    }
    row.processing_status = this.config.WORKER_DRY_RUN ? "dry_run" : "synced";
    row.raw_payload = { ...(row.raw_payload ?? {}), person_flow: { version: 4, complete: true, existing: false, identityVerified: true, dryRun: this.config.WORKER_DRY_RUN, crmPersonId: row.crm_record_id, updatedAt: new Date().toISOString() } };
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

  private async ensureProperty(
    job: JobRow,
    row: PropertyRow,
    primary: PersonRow,
    crm: PlaywrightCrmAdapter,
    owners: PersonRow[] = [primary],
  ) {
    if (!primary.crm_record_id) throw new WorkerError("La scheda del proprietario principale non è disponibile", "data_incomplete", { personId: primary.id, propertyId: row.id });
    const property = asProperty(row);
    property.rawPayload = {
      ...property.rawPayload,
      searchContext: {
        municipality: job.municipality,
        street: job.street,
        civicNumber: (property.rawPayload.long_run === true || Boolean(property.rawPayload.long_run && typeof property.rawPayload.long_run === "object"))
          ? extractFirstCivicNumber(property.address) ?? job.civic_number
          : job.civic_number,
      },
    };
    let propertyMatchedGlobally = false;
    let propertyCreatedInThisRun = false;
    let propertyMatchedByAddress = false;
    const checkedOwners = [...new Map([primary, ...owners]
      .filter((person): person is PersonRow & { crm_record_id: string } => Boolean(person.crm_record_id))
      .map((person) => [person.crm_record_id, person])).values()];
    const submittedId = row.crm_record_id;
    const directResult: PropertyMatchResult | null = submittedId
      ? await crm.verifyProperty(submittedId, property)
      : null;
    if (submittedId && !directResult?.match) {
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
    }
    const linkedOwnerMatches: Array<{ person: PersonRow; match: NonNullable<PropertyMatchResult["match"]> }> = [];
    if (!directResult?.match) {
      for (const person of checkedOwners) {
        const result = await crm.findPropertyForPerson(person.crm_record_id!, property);
        if (result.match) linkedOwnerMatches.push({ person, match: result.match });
      }
    }
    const distinctLinkedMatches = [...new Map(linkedOwnerMatches.map((entry) => [entry.match.id, entry])).values()];
    if (distinctLinkedMatches.length > 1) {
      throw new WorkerError(
        "L'immobile risulta associato a più schede diverse tra i proprietari. Il worker non sceglie quale aggiornare.",
        "needs_review",
        { action: "property-owner-matches-ambiguous", propertyId: row.id, matches: distinctLinkedMatches },
        true,
      );
    }
    const linkedResult: PropertyMatchResult = { match: distinctLinkedMatches[0]?.match ?? null };
    // A property can legitimately be visible only under another co-owner.
    // Never create a record until the immutable cadastral triple has also
    // been searched in the whole CRM.
    const globalResult = directResult?.match || linkedResult.match ? null : await crm.findPropertyByCadastralIdentity(property);
    const existingResult = directResult?.match ? directResult : linkedResult.match ? linkedResult : globalResult;
    if (existingResult?.match) {
      const matchData = isRecord(existingResult.match.data) ? existingResult.match.data : {};
      propertyMatchedByAddress = matchData.matchedBy === "address" && matchData.needsUpdate === true;
      const foundBySubmittedId = Boolean(directResult?.match);
      const verifiedLinkedProperty = foundBySubmittedId || propertyMatchedByAddress
        ? existingResult
        : await crm.verifyProperty(existingResult.match.id, property);
      if (!verifiedLinkedProperty.match || verifiedLinkedProperty.match.id !== existingResult.match.id) {
        throw new WorkerError(
          "L’immobile trovato non supera la verifica catastale finale. Il worker non lo aggiornerà.",
          "needs_review",
          {
            action: "property-linked-identity-mismatch",
            propertyId: row.id,
            crmPropertyId: existingResult.match.id,
            crmPersonId: primary.crm_record_id,
            cadastralKey: row.cadastral_key,
          },
          true,
        );
      }
      const foundThroughOwner = Boolean(linkedResult.match);
      if (foundBySubmittedId) {
        const creationCheckpoint = row.raw_payload?.property_creation;
        propertyCreatedInThisRun = isRecord(creationCheckpoint)
          && creationCheckpoint.crmPropertyId === existingResult.match.id;
      }
      const previousPropertySearch = isRecord(row.raw_payload?.property_search)
        ? row.raw_payload.property_search
        : {};
      const previouslyVerifiedLinkedOwnerCrmIds = Array.isArray(previousPropertySearch.verifiedLinkedOwnerCrmIds)
        ? previousPropertySearch.verifiedLinkedOwnerCrmIds
          .filter((value): value is string => typeof value === "string" && Boolean(value))
        : [];
      const verifiedLinkedOwnerCrmIds = [...new Set([
        ...previouslyVerifiedLinkedOwnerCrmIds,
        ...linkedOwnerMatches
          .filter(({ match }) => match.id === existingResult.match!.id)
          .map(({ person }) => person.crm_record_id!)
          .filter(Boolean),
      ])];
      propertyMatchedGlobally = !foundThroughOwner && !foundBySubmittedId;
      row.crm_record_id = existingResult.match.id;
      row.raw_payload = {
        ...(row.raw_payload ?? {}),
        crm_match: verifiedLinkedProperty.match,
        checked_from_people: checkedOwners.map((person) => person.id),
        property_search: {
          strategy: foundBySubmittedId
            ? "submitted-record-id"
            : foundThroughOwner
              ? propertyMatchedByAddress ? "owner-address" : "owner-cadastral"
              : "global-cadastral",
          linkedToVerifiedPerson: foundThroughOwner,
          verifiedLinkedOwnerCrmIds,
          searchedAt: new Date().toISOString(),
          personCrmId: linkedOwnerMatches[0]?.person.crm_record_id ?? primary.crm_record_id,
        },
      };
      await this.repository.updatePropertyProcessing(row.id, {
        crm_record_id: row.crm_record_id,
        processing_status: "matched",
        raw_payload: row.raw_payload,
      });
    } else {
      row.raw_payload = {
        ...(row.raw_payload ?? {}),
        crm_match: null,
        checked_from_people: checkedOwners.map((person) => person.id),
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
      const decision = await this.prompts.confirmSave(`${personSummary(asPerson(primary), property)}\nOperazione prevista: ${row.crm_record_id ? "aggiornamento dell'immobile esistente" : "creazione di un nuovo immobile"}`);
      if (decision === "skip") { await this.repository.updatePropertyProcessing(row.id, { processing_status: "skipped" }); return; }
      if (decision === "review") throw new WorkerError("Immobile segnato da verificare", "needs_review", { propertyId: row.id });
      if (decision === "manual") { await this.prompts.waitForManualEdit(); await this.repository.updatePropertyProcessing(row.id, { processing_status: "manual" }); return; }
    }
    if (row.crm_record_id) {
      await this.logPropertyChanges(job.id, row, property);
      await crm.updateProperty(row.crm_record_id, property);
      row.raw_payload = {
        ...(row.raw_payload ?? {}),
        existing_property_reused: {
          crmPropertyId: row.crm_record_id,
          mode: propertyMatchedByAddress ? "address_match_cadastral_updated" : "sister_data_updated",
          verifiedAt: new Date().toISOString(),
        },
      };
      await this.repository.updatePropertyProcessing(row.id, { raw_payload: row.raw_payload });
    } else {
      await this.logPropertyChanges(job.id, row, property);
      row.crm_record_id = await crm.createProperty(property);
      propertyCreatedInThisRun = true;
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
        "La scheda immobile finale non coincide con terna catastale, indirizzo o Comune SISTER. Il worker non aggiungerà l'attività.",
        "needs_review",
        { propertyId: row.id, crmPropertyId: row.crm_record_id, action: "property-final-identity" },
        true,
      );
    }
    // The property is now verified by immutable cadastral data, whether it
    // was found under the selected person, globally under another owner, or
    // created in this run. Do not reopen the person’s whole list: CRM can
    // expose relationships late and that detour was the source of unrelated
    // property hops. From here on, stay on this exact record ID.
    row.processing_status = this.config.WORKER_DRY_RUN ? "dry_run" : "synced";
    row.raw_payload = {
      ...(row.raw_payload ?? {}),
      property_sync: {
        complete: true,
        identityVerified: true,
        linkedToVerifiedPerson: !propertyMatchedGlobally,
        existingPropertyFoundGlobally: propertyMatchedGlobally,
        writeMode: propertyCreatedInThisRun
          ? "created"
          : propertyMatchedByAddress ? "existing_address_match_updated" : "existing_updated",
        dryRun: this.config.WORKER_DRY_RUN,
        crmPropertyId: row.crm_record_id,
        primaryPersonId: primary.id,
        updatedAt: new Date().toISOString(),
      },
    };
    await this.repository.updatePropertyProcessing(row.id, { crm_record_id: row.crm_record_id, processing_status: row.processing_status, raw_payload: row.raw_payload });
  }

  private async ensurePropertyActivity(
    job: JobRow,
    property: PropertyRow,
    primary: PersonRow,
    owners: PersonRow[],
    crm: PlaywrightCrmAdapter,
    directContactOrdinal: number,
    mode: PropertyActivityMode = this.propertyActivityMode(),
  ) {
    if (!property.crm_record_id) throw new WorkerError("La scheda dell'immobile non è disponibile per creare l'attività", "data_incomplete", { propertyId: property.id });
    const existing = readPropertyActivityCheckpoint(property.raw_payload, this.config.WORKER_DRY_RUN, property.crm_record_id);
    if (existing) return;
    const definition = propertyActivityDefinition(owners, directContactOrdinal, mode);
    /* «Nessuna attività» non è un errore: si esce senza scrivere nel diario. */
    if (!definition) return;
    if (job.mode === "assisted") {
      const decision = await this.prompts.confirmSave(propertyActivitySummary(asProperty(property), owners.map((owner) => owner.full_name), definition));
      if (decision === "skip") return;
      if (decision === "review") throw new WorkerError("Attività dell'immobile segnata da verificare", "needs_review", { propertyId: property.id });
      if (decision === "manual") { await this.prompts.waitForManualEdit(); return; }
    }
    const result = await crm.createPropertyActivity({
      propertyId: property.crm_record_id,
      propertyAddress: property.address,
      fallbackPersonId: primary.crm_record_id ?? undefined,
      fallbackPersonLabel: primary.full_name,
      description: definition.description,
      contactMode: definition.contactMode,
      status: definition.status,
      interruptionRequested: () => this.interruptionFor(job.id, property.id),
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
        description: definition.description,
        status: definition.status,
        contactMode: definition.contactMode,
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
      && existingFlow.version === 3
      && existingFlow.dryRun === this.config.WORKER_DRY_RUN
      && existingFlow.crmPersonId === row.crm_record_id
    ) return;
    let phoneSearchSkippedAfterCreation = false;
    let phonesCheckedInGlobalSearch: string[] = [];
    let duplicatePhoneAssignments: Array<{ phone: string; personId: string; label: string }> = [];
    if (match.matchedRows && row.crm_record_id) {
      const desiredPhones = [...match.mobiles, ...match.landlines];
      const personFlow = isRecord(row.raw_payload?.person_flow) ? row.raw_payload.person_flow : {};
      const createdInThisImport = personFlow.existing === false && personFlow.crmPersonId === row.crm_record_id;
      const phonesRequiringSearch = createdInThisImport
        ? []
        : await crm.findMissingPersonPhones(row.crm_record_id, desiredPhones);
      phoneSearchSkippedAfterCreation = createdInThisImport;
      phonesCheckedInGlobalSearch = phonesRequiringSearch;
      const assignments = phonesRequiringSearch.length
        ? await crm.findPhoneAssignments(phonesRequiringSearch)
        : [];
      const foreignAssignments = assignments.filter((assignment) => assignment.personId !== row.crm_record_id);
      duplicatePhoneAssignments = foreignAssignments;
      if (job.mode === "assisted") {
        const decision = await this.prompts.confirmSave([
          personSummary(asPerson(row)),
          "Modifiche previste:",
          "- aggiunta dei recapiti Excel mancanti",
          foreignAssignments.length
            ? `- ${foreignAssignments.length} recapiti sono già presenti su altre schede: li mantengo anche qui come da Excel`
            : "- nessun recapito già presente su altre schede",
        ].join("\n"));
        if (decision === "review") throw new WorkerError("Recapiti segnati da verificare", "needs_review", { personId: row.id });
        if (decision === "manual") await this.prompts.waitForManualEdit();
        else if (decision !== "skip") await crm.syncPersonContacts(row.crm_record_id, asPerson(row));
      } else await crm.syncPersonContacts(row.crm_record_id, asPerson(row));
      for (const duplicate of foreignAssignments) {
        await this.repository.logChange(
          job.id,
          "person",
          row.tax_code ?? row.id,
          "phone_assignment_duplicate_retained",
          `Nominativo CRM ${duplicate.personId}`,
          "Recapito mantenuto anche sul nominativo Excel",
          "EXCEL",
        );
      }
    }
    row.raw_payload = {
      ...(row.raw_payload ?? {}),
      contacts_flow: {
        version: 3,
        complete: true,
        dryRun: this.config.WORKER_DRY_RUN,
        crmPersonId: row.crm_record_id,
        matchedRows: match.matchedRows,
        phoneSearchSkippedAfterCreation,
        phonesCheckedInGlobalSearch,
        duplicatePhoneAssignments,
        phoneAssignmentPolicy: "excel-authoritative-retain-duplicates",
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

  private async reanalyzePropertyAutomatically(
    job: JobRow,
    property: PropertyRow,
    index: number,
    total: number,
    reanalysisAttempt: number,
    failure: WorkerError,
    crm: PlaywrightCrmAdapter,
  ) {
    const reanalyzedAt = new Date().toISOString();
    property.raw_payload = {
      ...(property.raw_payload ?? {}),
      property_flow: {
        version: 3,
        stage: "ready",
        dryRun: this.config.WORKER_DRY_RUN,
        reanalyzedAt,
        reanalysisSource: "automatic",
        reanalysisAttempt,
      },
      automatic_retry: {
        normalAttempts: Number(failure.details.automaticAttempts ?? AUTOMATIC_OPERATION_ATTEMPTS),
        normalPropertyAttempts: 0,
        reanalysisAttempts: reanalysisAttempt,
        lastError: failure.message,
        updatedAt: reanalyzedAt,
      },
    };
    await this.repository.updatePropertyProcessing(property.id, {
      processing_status: "normalized",
      raw_payload: property.raw_payload,
    });
    this.emitPropertyProgress(
      job,
      property,
      index,
      total,
      "reanalyzing",
      `Rianalisi automatica ${reanalysisAttempt} di ${AUTOMATIC_PROPERTY_REANALYSES}: verifico cosa esiste e completo solo cio che manca`,
    );
    await crm.resetToCrmHome().catch((error) => {
      logger.warn(
        { jobId: job.id, propertyId: property.id, reanalysisAttempt, error: error instanceof Error ? error.message : String(error) },
        "Reset CRM non riuscito prima della rianalisi automatica",
      );
    });
  }

  private interruptionFor(jobId: string, propertyId: string): "pause" | "skip" | null {
    if (this.isCancellationRequested(jobId) || this.isPauseRequested(jobId)) return "pause";
    if (this.isPropertySkipRequested(jobId, propertyId)) return "skip";
    return null;
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
