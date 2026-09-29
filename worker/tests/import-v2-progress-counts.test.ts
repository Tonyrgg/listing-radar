import { describe, expect, it } from "vitest";
import { WorkerRepository } from "../src/services/repository.js";

describe("conteggio Import V2 salvato", () => {
  it("lascia aperti i casi tecnici e conta separatamente gli esclusi per conflitto", async () => {
    const rows = {
      property_worker_import_v2_items: [
        { property_id: "retry", last_error: { kind: "transient_portal" } },
        { property_id: "review", last_error: { kind: "ambiguous_identity" } },
      ],
      property_worker_properties: [
        { id: "retry", job_id: "job-1", processing_status: "quarantined" },
        { id: "review", job_id: "job-1", processing_status: "quarantined" },
        { id: "done", job_id: "job-1", processing_status: "synced" },
      ],
    };
    const repository = new WorkerRepository("https://example.supabase.co", "service-role-key-long-enough-for-tests");
    Object.defineProperty(repository, "client", { value: {
      from(table: keyof typeof rows) {
        const query = {
          select: () => query,
          in: () => query,
          eq: () => query,
          order: () => query,
          range: async () => ({ data: rows[table], error: null }),
        };
        return query;
      },
    } });

    expect((await repository.listSavedJobImportCounts(["job-1"])).get("job-1"))
      .toEqual({ total: 3, handled: 2, completed: 1, skipped: 1 });
  });
});
