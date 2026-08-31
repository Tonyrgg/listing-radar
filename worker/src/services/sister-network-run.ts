import type { PlaywrightCrmAdapter } from "../adapters/crm/index.js";
import { PlaywrightSisterAdapter } from "../adapters/sister/index.js";
import { buildCadastralKey, normalizeTaxCode } from "../core/normalize.js";
import {
  decideNetworkProperty,
  normalizeNetworkSettings,
  type NetworkExplorationSettings,
} from "../core/network-exploration.js";
import type { CadastralOwner, CadastralProperty } from "../types.js";
import { WorkerRepository } from "./repository.js";
import { runWithRetryTelemetry, type RetryTelemetry } from "../core/retry-telemetry.js";
import { WorkerError } from "../core/errors.js";

export type NetworkQueueNode = { taxCode: string; depth: number; discoveredFrom: string | null };
export type NetworkSkipReason = "no_sister_properties" | "non_strategic_category" | "share_below_minimum" | "already_in_crm" | "without_owners" | "duplicate_in_run" | "sister_error" | "crm_error" | "save_error" | "floor_out_of_range" | "owner_age_out_of_range" | "owner_count_out_of_range" | "civic_out_of_range";
export type NetworkCompletionReason = "target_reached" | "exhausted" | "limit_reached";

export type SisterNetworkRunCheckpoint = {
  version: 1;
  jobId: string;
  status: "running" | "paused" | "completed" | "failed";
  settings: NetworkExplorationSettings;
  startedAt: string;
  updatedAt: string;
  pending: NetworkQueueNode[];
  visitedTaxCodes: string[];
  examinedPropertyKeys: string[];
  acceptedPropertyKeys: string[];
  acceptedProperties: number;
  existingProperties: number;
  skipped: Record<NetworkSkipReason, number>;
  completionReason: NetworkCompletionReason | null;
  lastError: string | null;
};

export type SisterNetworkRunProgress = {
  phase: "seeding" | "searching_person" | "reading_owners" | "checking_crm" | "saving_queue";
  peopleVisited: number;
  peopleLimit: number;
  acceptedProperties: number;
  targetProperties: number;
  depth: number | null;
};

type Options = {
  settings: Partial<NetworkExplorationSettings>;
  seeds: string[];
  resume?: SisterNetworkRunCheckpoint;
  isCancelled?: () => boolean;
  onCheckpoint?: (checkpoint: SisterNetworkRunCheckpoint) => void | Promise<void>;
  onProgress?: (progress: SisterNetworkRunProgress) => void | Promise<void>;
  onRetryTelemetry?: (telemetry: RetryTelemetry) => void | Promise<void>;
  /**
   * Altri punti di partenza, quando la coda si svuota senza aver raggiunto
   * l'obiettivo.
   *
   * Riceve i codici fiscali gia' visti o gia' in coda, cosi' non li
   * ripropone. Restituendo una lista vuota dice che non ce ne sono altri, e
   * l'esplorazione si chiude.
   */
  refillSeeds?: (escludi: string[]) => Promise<string[]>;
};

const skipReasons: NetworkSkipReason[] = [
  "no_sister_properties", "non_strategic_category", "share_below_minimum", "already_in_crm", "without_owners", "duplicate_in_run", "sister_error", "crm_error", "save_error",
  "floor_out_of_range", "owner_age_out_of_range", "owner_count_out_of_range", "civic_out_of_range",
];

function makeEmptySkips(): Record<NetworkSkipReason, number> {
  return Object.fromEntries(skipReasons.map((reason) => [reason, 0])) as Record<NetworkSkipReason, number>;
}

function createCheckpoint(jobId: string, settings: NetworkExplorationSettings, seeds: string[]): SisterNetworkRunCheckpoint {
  const uniqueSeeds = [...new Set(seeds.map(normalizeTaxCode).filter((taxCode) => /^[A-Z0-9]{16}$/.test(taxCode)))];
  const now = new Date().toISOString();
  return {
    version: 1, jobId, status: "running", settings, startedAt: now, updatedAt: now,
    pending: uniqueSeeds.map((taxCode) => ({ taxCode, depth: 0, discoveredFrom: null })),
    visitedTaxCodes: [], examinedPropertyKeys: [], acceptedPropertyKeys: [], acceptedProperties: 0, existingProperties: 0,
    skipped: makeEmptySkips(), completionReason: null, lastError: null,
  };
}

/** Errori che un secondo clic non puo' correggere non vanno ripetuti. */
function isTransientPortalFailure(error: unknown) {
  if (!(error instanceof WorkerError)) return true;
  return !["session_expired", "needs_review", "data_incomplete", "paused"].includes(error.status);
}

function isSessionStoppingFailure(error: unknown) {
  return error instanceof WorkerError && ["session_expired", "paused"].includes(error.status);
}

/**
 * Traverses ownership links as a bounded graph. It saves only the properties
 * that survive the SISTER and CRM barriers; the regular runner can later
 * import that frozen job without re-running the exploration.
 */
export class SisterNetworkRun {
  constructor(
    private readonly sister: PlaywrightSisterAdapter,
    private readonly crm: PlaywrightCrmAdapter,
    private readonly repository: WorkerRepository,
  ) {}

  async run(jobId: string, options: Options): Promise<SisterNetworkRunCheckpoint> {
    const settings = normalizeNetworkSettings(options.resume?.settings ?? options.settings);
    const initial = options.resume ?? createCheckpoint(jobId, settings, options.seeds);
    /* I checkpoint della 0.28 non avevano l'elenco degli immobili esaminati:
     * gli accettati sono comunque gia' stati esaminati e costituiscono una
     * base compatibile e sicura. */
    let checkpoint: SisterNetworkRunCheckpoint = {
      ...initial,
      examinedPropertyKeys: [...new Set(initial.examinedPropertyKeys ?? initial.acceptedPropertyKeys ?? [])],
      completionReason: initial.completionReason ?? null,
    };
    if (checkpoint.jobId !== jobId) throw new Error("Il checkpoint rete appartiene a un'altra lavorazione.");
    if (!checkpoint.pending.length && !checkpoint.acceptedProperties) throw new Error("Non esistono codici fiscali CRM verificati da cui avviare l'esplorazione.");
    checkpoint = {
      ...checkpoint,
      status: "running",
      settings,
      skipped: { ...makeEmptySkips(), ...checkpoint.skipped },
      completionReason: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
    await this.publish(checkpoint, options);

    /* Finita la prima manche senza aver raggiunto l'obiettivo si torna al
     * gestionale a pescare altri nominativi, invece di chiudere. Ogni giro
     * esclude chi e' gia' stato visto: quando non c'e' piu' nessuno da
     * proporre, la lista torna vuota e si chiude davvero. */
    for (;;) {
    while (checkpoint.pending.length && checkpoint.acceptedProperties < settings.targetProperties && checkpoint.visitedTaxCodes.length < settings.maxPeople) {
      if (options.isCancelled?.()) {
        checkpoint = { ...checkpoint, status: "paused", updatedAt: new Date().toISOString() };
        await this.publish(checkpoint, options);
        return checkpoint;
      }
      const node = checkpoint.pending[0]!;
      checkpoint = { ...checkpoint, pending: checkpoint.pending.slice(1), visitedTaxCodes: [...checkpoint.visitedTaxCodes, node.taxCode] };
      await options.onProgress?.({ phase: "searching_person", peopleVisited: checkpoint.visitedTaxCodes.length, peopleLimit: settings.maxPeople, acceptedProperties: checkpoint.acceptedProperties, targetProperties: settings.targetProperties, depth: node.depth });

      let properties: CadastralProperty[];
      try {
        properties = await runWithRetryTelemetry(
          () => this.sister.searchPhysicalPersonByTaxCode(node.taxCode),
          {
            operation: "Ricerca persona fisica SISTER", maximumAttempts: 3, delayMs: 3_000,
            shouldRetry: isTransientPortalFailure,
            onTelemetry: options.onRetryTelemetry,
          },
        );
      } catch (error) {
        if (isSessionStoppingFailure(error)) throw error;
        checkpoint.skipped.sister_error += 1;
        checkpoint.lastError = error instanceof Error ? error.message : String(error);
        checkpoint.updatedAt = new Date().toISOString();
        await this.publish(checkpoint, options);
        continue;
      }
      if (!properties.length) {
        checkpoint.skipped.no_sister_properties += 1;
        checkpoint.updatedAt = new Date().toISOString();
        await this.publish(checkpoint, options);
        continue;
      }

      for (const property of properties) {
        if (checkpoint.acceptedProperties >= settings.targetProperties || options.isCancelled?.()) break;
        const propertyKey = buildCadastralKey(property);
        if (checkpoint.examinedPropertyKeys.includes(propertyKey)) {
          checkpoint.skipped.duplicate_in_run += 1;
          continue;
        }
        await options.onProgress?.({ phase: "reading_owners", peopleVisited: checkpoint.visitedTaxCodes.length, peopleLimit: settings.maxPeople, acceptedProperties: checkpoint.acceptedProperties, targetProperties: settings.targetProperties, depth: node.depth });
        let owners: CadastralOwner[];
        try {
          owners = await runWithRetryTelemetry(
            () => this.sister.extractOwners(property),
            {
              operation: "Lettura comproprietari SISTER", maximumAttempts: 3, delayMs: 3_000,
              shouldRetry: isTransientPortalFailure,
              onTelemetry: options.onRetryTelemetry,
            },
          );
        } catch (error) {
          if (isSessionStoppingFailure(error)) throw error;
          checkpoint.skipped.sister_error += 1;
          checkpoint.lastError = error instanceof Error ? error.message : String(error);
          continue;
        }
        checkpoint.examinedPropertyKeys.push(propertyKey);
        /* La rete si attraversa tutta; i filtri dicono solo cosa portare a
         * casa.
         *
         * I comproprietari finivano in coda soltanto dopo che l'immobile
         * aveva superato ogni barriera. Con un requisito stretto — «piu' di
         * ottantacinque anni», per dire — quasi nessun immobile passava,
         * quindi non entrava in coda nessuno, e l'esplorazione moriva dopo i
         * punti di partenza dicendo che nessun immobile aveva superato le
         * barriere. Chi possiede insieme a qualcuno e' un ramo della rete a
         * prescindere da quanti anni ha: si visita comunque, e sara' poi il
         * filtro a decidere se i suoi immobili si acquisiscono. */
        if (node.depth < settings.maxDepth) {
          const giaNoti = new Set([...checkpoint.visitedTaxCodes, ...checkpoint.pending.map((entry) => entry.taxCode)]);
          for (const owner of owners) {
            const taxCode = normalizeTaxCode(owner.taxCode);
            if (/^[A-Z0-9]{16}$/.test(taxCode) && !giaNoti.has(taxCode)) {
              checkpoint.pending.push({ taxCode, depth: node.depth + 1, discoveredFrom: propertyKey });
              giaNoti.add(taxCode);
            }
          }
        }

        const preDecision = decideNetworkProperty(property, owners, settings, false);
        if (!preDecision.eligible && preDecision.reason !== "already_in_crm") {
          checkpoint.skipped[preDecision.reason] += 1;
          continue;
        }
        await options.onProgress?.({ phase: "checking_crm", peopleVisited: checkpoint.visitedTaxCodes.length, peopleLimit: settings.maxPeople, acceptedProperties: checkpoint.acceptedProperties, targetProperties: settings.targetProperties, depth: node.depth });
        let existing: Awaited<ReturnType<PlaywrightCrmAdapter["findPropertyByCadastralIdentity"]>>;
        try {
          existing = await runWithRetryTelemetry(
            () => this.crm.findPropertyByCadastralIdentity(property),
            { operation: "Controllo immobile nel CRM", maximumAttempts: 3, delayMs: 3_000, shouldRetry: isTransientPortalFailure, onTelemetry: options.onRetryTelemetry },
          );
        } catch (error) {
          if (isSessionStoppingFailure(error)) throw error;
          checkpoint.skipped.crm_error += 1;
          checkpoint.lastError = error instanceof Error ? error.message : String(error);
          checkpoint.updatedAt = new Date().toISOString();
          await this.publish(checkpoint, options);
          continue;
        }
        const decision = decideNetworkProperty(property, owners, settings, Boolean(existing.match));
        if (!decision.eligible) {
          checkpoint.skipped[decision.reason] += 1;
          continue;
        }
        await options.onProgress?.({ phase: "saving_queue", peopleVisited: checkpoint.visitedTaxCodes.length, peopleLimit: settings.maxPeople, acceptedProperties: checkpoint.acceptedProperties, targetProperties: settings.targetProperties, depth: node.depth });
        let saved: Awaited<ReturnType<WorkerRepository["insertProperties"]>>[number] | undefined;
        try {
          [saved] = await this.repository.insertProperties(jobId, [{
            ...property,
            rawPayload: {
              ...property.rawPayload,
              network_exploration: { sourceTaxCode: node.taxCode, depth: node.depth, decision: decision.kind, crmPropertyId: existing.match?.id ?? null },
            },
          }]);
          if (!saved) throw new Error("Immobile esplorato non salvato nella coda.");
          for (const owner of owners) await this.repository.insertOwner(jobId, saved.id, owner);
        } catch (error) {
          /* Un immobile senza tutti i comproprietari non e' importabile. Se il
           * salvataggio si interrompe a meta', si elimina solo quella riga e
           * gli eventuali nominativi rimasti orfani; gli immobili gia'
           * completati restano intatti. */
          if (saved) await this.repository.removePropertyFromJob(jobId, saved.id);
          checkpoint.skipped.save_error += 1;
          checkpoint.lastError = error instanceof Error ? error.message : String(error);
          checkpoint.updatedAt = new Date().toISOString();
          await this.publish(checkpoint, options);
          continue;
        }
        checkpoint.acceptedPropertyKeys.push(propertyKey);
        checkpoint.acceptedProperties += 1;
        if (decision.kind === "existing_update") checkpoint.existingProperties += 1;
        checkpoint.updatedAt = new Date().toISOString();
        await this.publish(checkpoint, options);
      }
      checkpoint.updatedAt = new Date().toISOString();
      await this.publish(checkpoint, options);
    }

    if (options.isCancelled?.()) {
      checkpoint = { ...checkpoint, status: "paused", updatedAt: new Date().toISOString() };
      await this.publish(checkpoint, options);
      return checkpoint;
    }

    if (checkpoint.pending.length
      || checkpoint.acceptedProperties >= settings.targetProperties
      || checkpoint.visitedTaxCodes.length >= settings.maxPeople
      || options.isCancelled?.()
      || !options.refillSeeds) break;

    const gia = [...checkpoint.visitedTaxCodes, ...checkpoint.pending.map((entry) => entry.taxCode)];
    const altri = (await options.refillSeeds(gia))
      .map(normalizeTaxCode)
      .filter((taxCode) => /^[A-Z0-9]{16}$/.test(taxCode) && !gia.includes(taxCode));
    if (options.isCancelled?.()) {
      checkpoint = { ...checkpoint, status: "paused", updatedAt: new Date().toISOString() };
      await this.publish(checkpoint, options);
      return checkpoint;
    }
    if (!altri.length) break;
    checkpoint.pending.push(...altri.map((taxCode) => ({ taxCode, depth: 0, discoveredFrom: null })));
    checkpoint.updatedAt = new Date().toISOString();
    await this.publish(checkpoint, options);
    }

    /* L'ultimo errore non si azzera: se qualcuno non e' stato letto, quel
     * messaggio e' l'unica traccia del perche' la run non ha trovato niente,
     * e cancellarlo lasciava un esito muto. */
    const completionReason: NetworkCompletionReason = checkpoint.acceptedProperties >= settings.targetProperties
      ? "target_reached"
      : checkpoint.visitedTaxCodes.length >= settings.maxPeople
        ? "limit_reached"
        : "exhausted";
    checkpoint = { ...checkpoint, status: "completed", completionReason, updatedAt: new Date().toISOString() };
    await this.publish(checkpoint, options);
    return checkpoint;
  }

  private async publish(checkpoint: SisterNetworkRunCheckpoint, options: Options) {
    await options.onCheckpoint?.(structuredClone(checkpoint));
  }
}
