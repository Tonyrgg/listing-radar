import type { ImportV2Outcome, ImportV2Stage, SourceProperty } from "./model.js";
import { ImportV2Engine } from "./engine.js";

export type ImportV2BatchResult = {
  completed: ImportV2Outcome[];
  quarantined: ImportV2Outcome[];
  paused: ImportV2Outcome | null;
};

export type ImportV2Progress = {
  propertyId: string;
  index: number;
  total: number;
  stage: ImportV2Stage;
  workerIndex?: number;
  workerCount?: number;
  completed?: number;
};

type ImportV2Source = SourceProperty | (() => SourceProperty);

export type ImportV2WorkItem = {
  source: ImportV2Source;
  position: number;
  propertyId: string;
  conflictKeys: string[];
};

function materialize(source: ImportV2Source): SourceProperty {
  return typeof source === "function" ? source() : source;
}

/**
 * Distribuisce gli immobili senza mai separare quelli che condividono un
 * intestatario. Il codice fiscale e' il lock naturale: evita che due pagine
 * cerchino, creino o sovrascrivano contemporaneamente lo stesso Cliente.
 */
export function partitionImportV2Work(
  properties: ImportV2Source[],
  requestedWorkers: number,
): ImportV2WorkItem[][] {
  const workerCount = Math.max(1, Math.min(Math.trunc(requestedWorkers) || 1, properties.length || 1));
  const items = properties.map((source, position) => {
    const property = materialize(source);
    return {
      source,
      position,
      propertyId: property.sourcePropertyId,
      conflictKeys: [...new Set([
        ...property.owners.map((owner) => `PERSON:${owner.taxCode.replace(/\s+/g, "").toUpperCase()}`).filter((key) => key !== "PERSON:"),
        `PROPERTY:${[
          property.municipality,
          property.cadastral.urbanSection,
          property.cadastral.sheet,
          property.cadastral.parcel,
          property.cadastral.parcelDenomination,
          property.cadastral.subaltern,
        ].map((value) => String(value ?? "").replace(/\s+/g, "").toUpperCase()).join("|")}`,
      ])],
    };
  });
  if (workerCount === 1) return [items];

  const parent = items.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[index] !== index) {
      const next = parent[index]!;
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const unite = (left: number, right: number) => {
    const leftRoot = find(left), rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const firstByConflict = new Map<string, number>();
  for (const [index, item] of items.entries()) {
    for (const conflictKey of item.conflictKeys) {
      const first = firstByConflict.get(conflictKey);
      if (first == null) firstByConflict.set(conflictKey, index);
      else unite(first, index);
    }
  }
  const components = new Map<number, ImportV2WorkItem[]>();
  for (const [index, item] of items.entries()) {
    const root = find(index), component = components.get(root);
    if (component) component.push(item);
    else components.set(root, [item]);
  }

  const lanes = Array.from({ length: workerCount }, () => [] as ImportV2WorkItem[]);
  for (const component of [...components.values()].sort((left, right) =>
    right.length - left.length || left[0]!.position - right[0]!.position)) {
    const lane = lanes.reduce((best, candidate) => candidate.length < best.length ? candidate : best, lanes[0]!);
    lane.push(...component);
  }
  for (const lane of lanes) lane.sort((left, right) => left.position - right.position);
  return lanes.filter((lane) => lane.length > 0);
}

/** A bad property is isolated; a session/portal-wide failure pauses the batch. */
export async function runImportV2Batch(
  engine: ImportV2Engine,
  properties: ImportV2Source[],
  onProgress?: (progress: ImportV2Progress) => void,
  shouldPauseAfterItem: () => boolean = () => false,
  onOutcome?: (outcome: ImportV2Outcome) => void,
): Promise<ImportV2BatchResult> {
  const result: ImportV2BatchResult = { completed: [], quarantined: [], paused: null };
  const total = properties.length;
  const deferred: Array<{ source: SourceProperty | (() => SourceProperty); position: number }> = [];
  for (const [position, source] of properties.entries()) {
    const property = typeof source === "function" ? source() : source;
    const outcome = await engine.run(property, (stage) => onProgress?.({
      propertyId: property.sourcePropertyId, index: position + 1, total, stage,
    }));
    onOutcome?.(outcome);
    if (outcome.state === "completed") result.completed.push(outcome);
    else if (outcome.state === "quarantined" && outcome.failure?.details.lookupIndexPending === true) {
      /* Salesforce indicizza i Clienti appena creati con ritardo. Continuare
       * la coda dà tempo al Cloud senza bloccare il throughput; il checkpoint
       * conserva persona e immobile già verificati per il secondo passaggio. */
      deferred.push({ source, position });
    }
    else if (outcome.state === "quarantined") result.quarantined.push(outcome);
    else {
      result.paused = outcome;
      break;
    }
    if (shouldPauseAfterItem()) {
      result.paused = {
        ...outcome,
        state: "paused",
        failure: {
          kind: "operator_pause",
          message: "Run messa in pausa dopo l'immobile corrente; checkpoint conservato",
          retryable: false,
          global: true,
          stage: outcome.stage,
          details: { pauseRequested: true, stopAfterNextImport: true },
          occurredAt: new Date().toISOString(),
        },
      };
      break;
    }
  }
  if (!result.paused) {
    for (const item of deferred) {
      const property = typeof item.source === "function" ? item.source() : item.source;
      const outcome = await engine.run(property, (stage) => onProgress?.({
        propertyId: property.sourcePropertyId, index: item.position + 1, total, stage,
      }));
      onOutcome?.(outcome);
      if (outcome.state === "completed") result.completed.push(outcome);
      else if (outcome.state === "quarantined") result.quarantined.push(outcome);
      else { result.paused = outcome; break; }
    }
  }
  return result;
}

/** Il percorso a un solo engine resta runImportV2Batch, senza deviazioni. */
export async function runImportV2ParallelBatch(
  engines: ImportV2Engine[],
  properties: ImportV2Source[],
  onProgress?: (progress: ImportV2Progress) => void,
  shouldPauseAfterItem: () => boolean = () => false,
  onParallelPause?: () => void,
): Promise<ImportV2BatchResult> {
  if (engines.length <= 1 || properties.length <= 1) {
    return runImportV2Batch(engines[0]!, properties, onProgress, shouldPauseAfterItem);
  }
  const lanes = partitionImportV2Work(properties, engines.length);
  const total = properties.length;
  const completedPropertyIds = new Set<string>();
  const results = await Promise.all(lanes.map((lane, laneIndex) => {
    const positionByPropertyId = new Map(lane.map((item) => [item.propertyId, item.position]));
    return runImportV2Batch(
      engines[laneIndex]!,
      lane.map((item) => item.source),
      (progress) => {
        if (progress.stage === "completed") completedPropertyIds.add(progress.propertyId);
        onProgress?.({
          ...progress,
          index: (positionByPropertyId.get(progress.propertyId) ?? 0) + 1,
          total,
          workerIndex: laneIndex + 1,
          workerCount: lanes.length,
          completed: completedPropertyIds.size,
        });
      },
      shouldPauseAfterItem,
      (outcome) => {
        if (outcome.state === "paused") onParallelPause?.();
      },
    );
  }));
  const position = new Map(lanes.flatMap((lane) => lane).map((item) => [item.propertyId, item.position]));
  const ordered = (outcomes: ImportV2Outcome[]) => outcomes.sort((left, right) =>
    (position.get(left.propertyId) ?? 0) - (position.get(right.propertyId) ?? 0));
  const paused = results.map((result) => result.paused).filter((item): item is ImportV2Outcome => Boolean(item));
  return {
    completed: ordered(results.flatMap((result) => result.completed)),
    quarantined: ordered(results.flatMap((result) => result.quarantined)),
    paused: paused.find((outcome) => outcome.failure?.kind !== "operator_pause") ?? paused[0] ?? null,
  };
}
