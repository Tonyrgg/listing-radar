import type { SupabaseClient } from "@supabase/supabase-js";

import { ImportV2Engine, type ImportV2EngineOptions } from "./engine.js";
import type { ImportV2BatchResult, ImportV2Progress } from "./queue.js";
import { runImportV2Batch } from "./queue.js";
import {
  importV2Sources,
  loadImportV2AcquisitionEvidence,
  type AcquiredGraph,
  type ActivitySource,
} from "./source.js";
import { SupabaseImportV2Store } from "./store.js";
import type { TecnocloudV2Port } from "./ports.js";
import type { JobRow, PersonRow, PropertyRow } from "../services/repository.js";

export type ImportV2RepositoryBridge = {
  client: SupabaseClient;
  loadGraph(jobId: string): Promise<AcquiredGraph>;
};

/** Entry point used by desktop/CLI after acquisition is complete. */
export class ImportV2Coordinator {
  constructor(
    private readonly repository: ImportV2RepositoryBridge,
    private readonly crm: TecnocloudV2Port,
    private readonly engineOptions: Partial<ImportV2EngineOptions> = {},
  ) {}

  async runJob(
    job: Pick<JobRow, "id">,
    activityFor: (property: PropertyRow, owners: PersonRow[]) => ActivitySource,
    onProgress?: (progress: ImportV2Progress) => void,
  ): Promise<ImportV2BatchResult> {
    const [graph, evidence] = await Promise.all([
      this.repository.loadGraph(job.id),
      loadImportV2AcquisitionEvidence(this.repository.client, job.id),
    ]);
    const sources = importV2Sources(job, graph, activityFor, evidence);
    const engine = new ImportV2Engine(this.crm, new SupabaseImportV2Store(this.repository.client), this.engineOptions);
    return runImportV2Batch(engine, sources, onProgress);
  }
}
