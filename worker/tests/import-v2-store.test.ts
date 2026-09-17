import { describe, expect, it } from "vitest";
import { SupabaseImportV2Store } from "../src/import-v2/store.js";
import type { ImportV2Checkpoint } from "../src/import-v2/model.js";

describe("checkpoint Import V2", () => {
  it("conserva la prova verificata dell'attivita Cloud", async () => {
    let saved: Record<string, unknown> | null = null;
    const client = {
      from(table: string) {
        expect(table).toBe("property_worker_import_v2_items");
        return {
          update(payload: Record<string, unknown>) {
            saved = payload;
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    };
    const checkpoint: ImportV2Checkpoint = {
      itemId: "item-1",
      jobId: "job-1",
      propertyId: "property-1",
      stage: "completed",
      plan: null,
      people: [],
      syncedPeople: [],
      ownershipVerifiedPersonIds: [],
      propertyResolution: null,
      crmPropertyId: "crm-property-1",
      activityEvidence: {
        activityId: "activity-1",
        outcome: "created",
        descriptionVerified: true,
        statusVerified: true,
        expectedStatus: "Eseguito",
      },
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      updatedAt: "2026-09-17T19:00:00.000Z",
    };

    await new SupabaseImportV2Store(client as never).save(checkpoint);

    expect(saved).not.toBeNull();
    expect((saved!.checkpoint as Record<string, unknown>).activityEvidence).toEqual(checkpoint.activityEvidence);
  });
});
