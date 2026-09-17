import { describe, expect, it } from "vitest";
import { SupabaseImportV2Store } from "../src/import-v2/store.js";
import type { ImportV2Checkpoint } from "../src/import-v2/model.js";
import { buildPlan } from "../src/import-v2/identity.js";

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

  it("migra un checkpoint esistente con il comune duplicato nell'indirizzo", async () => {
    const cleanPlan = buildPlan({
      sourcePropertyId: "property-1", jobId: "job-1", municipality: "BITONTO",
      fullAddress: "Via Tenente Domenico Speranza, 15",
      cadastral: { urbanSection: "BA", sheet: "1", parcel: "2", parcelDenomination: null, subaltern: "3", income: 100 },
      category: "A/3", propertyClass: "2", consistency: "4 vani",
      activity: { enabled: false, description: null, contactMode: "Contatto diretto", status: "Da eseguire" },
      owners: [{
        sourcePersonId: "person-1", taxCode: "RSSMRA70A01A893X", fullName: "ROSSI MARIO",
        birthDate: "1970-01-01", birthPlace: "BITONTO", birthProvince: "BA",
        rightType: "Proprieta'", sharePercentage: 100, contacts: { phones: [], emails: [] },
      }],
    });
    const legacyPlan = {
      ...cleanPlan,
      fingerprint: "legacy-address-fingerprint",
      source: { ...cleanPlan.source, fullAddress: "BITONTO(BA) Via Tenente Domenico Speranza, 15" },
    };
    let migration: Record<string, unknown> | null = null;
    const row = {
      id: "item-1", job_id: "job-1", property_id: "property-1",
      plan_fingerprint: legacyPlan.fingerprint, stage: "queued", status: "queued",
      plan: legacyPlan, checkpoint: {}, attempts: 0, next_attempt_at: null,
      last_error: null, updated_at: "2026-09-18T00:00:00.000Z",
    };
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: row, error: null }),
    };
    const client = {
      from() {
        return {
          ...query,
          update(payload: Record<string, unknown>) {
            migration = payload;
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    };

    const loaded = await new SupabaseImportV2Store(client as never).loadOrCreate(cleanPlan);

    expect(loaded.plan?.source.fullAddress).toBe("Via Tenente Domenico Speranza, 15");
    expect((migration!.plan as typeof cleanPlan).source.fullAddress).toBe("Via Tenente Domenico Speranza, 15");
    expect(migration!.plan_fingerprint).toBe(cleanPlan.fingerprint);
  });
});
