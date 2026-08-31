import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { StreetRegistryService, streetRunRegistryOutcome } from "../src/services/street-registry.js";

describe("StreetRegistryService", () => {
  it("claims city work through the atomic registry RPC", async () => {
    const item = { work_item_id: "work-1", official_code: "001" };
    const rpc = vi.fn().mockResolvedValue({ data: item, error: null });
    const service = new StreetRegistryService({ rpc } as unknown as SupabaseClient);

    await expect(service.claim({ workerId: "desktop-1" })).resolves.toEqual(item);
    expect(rpc).toHaveBeenCalledWith("claim_street_registry_work", {
      p_worker_id: "desktop-1",
      p_zone_id: null,
      p_order_scope: "city",
      p_lease_seconds: 900,
    });
  });

  it("defaults to zone order when a zone is selected", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const service = new StreetRegistryService({ rpc } as unknown as SupabaseClient);

    await expect(service.claim({ workerId: "desktop-1", zoneId: "zone-12", leaseSeconds: 600 })).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith("claim_street_registry_work", expect.objectContaining({
      p_zone_id: "zone-12",
      p_order_scope: "zone",
      p_lease_seconds: 600,
    }));
  });

  it("completes work while linking the Property Worker job", async () => {
    const item = { work_item_id: "work-1", work_status: "completed" };
    const rpc = vi.fn().mockResolvedValue({ data: item, error: null });
    const service = new StreetRegistryService({ rpc } as unknown as SupabaseClient);

    await expect(service.complete({
      workItemId: "work-1",
      workerId: "desktop-1",
      outcome: "completed",
      propertyWorkerJobId: "job-1",
      result: { properties: 8 },
    })).resolves.toEqual(item);
    expect(rpc).toHaveBeenCalledWith("complete_street_registry_work", expect.objectContaining({
      p_work_item_id: "work-1",
      p_property_worker_job_id: "job-1",
      p_result: { properties: 8 },
    }));
  });
});

describe("streetRunRegistryOutcome", () => {
  it("chiude come completata solo una run finita senza errori", () => {
    expect(streetRunRegistryOutcome({ status: "completed" })).toBe("completed");
    expect(streetRunRegistryOutcome({ status: "completed", lastError: null, runError: null })).toBe("completed");
  });

  it("rimette in coda una run sospesa invece di segnarla fallita", () => {
    expect(streetRunRegistryOutcome({ status: "paused" })).toBe("to_recheck");
  });

  it("rimette in coda anche una run completata che ha lasciato un errore", () => {
    expect(streetRunRegistryOutcome({ status: "completed", lastError: "SISTER non risponde" })).toBe("to_recheck");
    expect(streetRunRegistryOutcome({ status: "completed", runError: "dati obbligatori mancanti" })).toBe("to_recheck");
  });
});
