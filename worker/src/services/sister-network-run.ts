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

export type NetworkQueueNode = { taxCode: string; depth: number; discoveredFrom: string | null };
export type NetworkSkipReason = "no_sister_properties" | "non_strategic_category" | "share_below_minimum" | "already_in_crm" | "without_owners" | "duplicate_in_run" | "sister_error";

export type SisterNetworkRunCheckpoint = {
  version: 1;
  jobId: string;
  status: "running" | "paused" | "completed" | "failed";
  settings: NetworkExplorationSettings;
  startedAt: string;
  updatedAt: string;
  pending: NetworkQueueNode[];
  visitedTaxCodes: string[];
  acceptedPropertyKeys: string[];
  acceptedProperties: number;
  existingProperties: number;
  skipped: Record<NetworkSkipReason, number>;
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
};

const skipReasons: NetworkSkipReason[] = [
  "no_sister_properties", "non_strategic_category", "share_below_minimum", "already_in_crm", "without_owners", "duplicate_in_run", "sister_error",
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
    visitedTaxCodes: [], acceptedPropertyKeys: [], acceptedProperties: 0, existingProperties: 0,
    skipped: makeEmptySkips(), lastError: null,
  };
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
    let checkpoint = options.resume ?? createCheckpoint(jobId, settings, options.seeds);
    if (checkpoint.jobId !== jobId) throw new Error("Il checkpoint rete appartiene a un'altra lavorazione.");
    if (!checkpoint.pending.length && !checkpoint.acceptedProperties) throw new Error("Non esistono codici fiscali CRM verificati da cui avviare l'esplorazione.");
    checkpoint = { ...checkpoint, status: "running", settings, lastError: null, updatedAt: new Date().toISOString() };
    await this.publish(checkpoint, options);

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
        properties = await this.sister.searchPhysicalPersonByTaxCode(node.taxCode);
      } catch (error) {
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
        if (checkpoint.acceptedPropertyKeys.includes(propertyKey)) {
          checkpoint.skipped.duplicate_in_run += 1;
          continue;
        }
        await options.onProgress?.({ phase: "reading_owners", peopleVisited: checkpoint.visitedTaxCodes.length, peopleLimit: settings.maxPeople, acceptedProperties: checkpoint.acceptedProperties, targetProperties: settings.targetProperties, depth: node.depth });
        let owners: CadastralOwner[];
        try {
          owners = await this.sister.extractOwners(property);
        } catch (error) {
          checkpoint.skipped.sister_error += 1;
          checkpoint.lastError = error instanceof Error ? error.message : String(error);
          continue;
        }
        const preDecision = decideNetworkProperty(property, owners, settings, false);
        if (!preDecision.eligible && preDecision.reason !== "already_in_crm") {
          checkpoint.skipped[preDecision.reason] += 1;
          continue;
        }
        await options.onProgress?.({ phase: "checking_crm", peopleVisited: checkpoint.visitedTaxCodes.length, peopleLimit: settings.maxPeople, acceptedProperties: checkpoint.acceptedProperties, targetProperties: settings.targetProperties, depth: node.depth });
        const existing = await this.crm.findPropertyByCadastralIdentity(property);
        const decision = decideNetworkProperty(property, owners, settings, Boolean(existing.match));
        if (!decision.eligible) {
          checkpoint.skipped[decision.reason] += 1;
          continue;
        }
        await options.onProgress?.({ phase: "saving_queue", peopleVisited: checkpoint.visitedTaxCodes.length, peopleLimit: settings.maxPeople, acceptedProperties: checkpoint.acceptedProperties, targetProperties: settings.targetProperties, depth: node.depth });
        const [saved] = await this.repository.insertProperties(jobId, [{
          ...property,
          rawPayload: {
            ...property.rawPayload,
            network_exploration: { sourceTaxCode: node.taxCode, depth: node.depth, decision: decision.kind, crmPropertyId: existing.match?.id ?? null },
          },
        }]);
        if (!saved) throw new Error("Immobile esplorato non salvato nella coda.");
        for (const owner of owners) await this.repository.insertOwner(jobId, saved.id, owner);
        checkpoint.acceptedPropertyKeys.push(propertyKey);
        checkpoint.acceptedProperties += 1;
        if (decision.kind === "existing_update") checkpoint.existingProperties += 1;
        if (node.depth < settings.maxDepth) {
          const queued = new Set([...checkpoint.visitedTaxCodes, ...checkpoint.pending.map((entry) => entry.taxCode)]);
          for (const owner of owners) {
            const taxCode = normalizeTaxCode(owner.taxCode);
            if (/^[A-Z0-9]{16}$/.test(taxCode) && !queued.has(taxCode)) {
              checkpoint.pending.push({ taxCode, depth: node.depth + 1, discoveredFrom: propertyKey });
              queued.add(taxCode);
            }
          }
        }
        checkpoint.updatedAt = new Date().toISOString();
        await this.publish(checkpoint, options);
      }
      checkpoint.updatedAt = new Date().toISOString();
      await this.publish(checkpoint, options);
    }
    checkpoint = { ...checkpoint, status: "completed", updatedAt: new Date().toISOString(), lastError: null };
    await this.publish(checkpoint, options);
    return checkpoint;
  }

  private async publish(checkpoint: SisterNetworkRunCheckpoint, options: Options) {
    await options.onCheckpoint?.(structuredClone(checkpoint));
  }
}
