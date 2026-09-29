import { describe, expect, it, vi } from "vitest";
import { cloudErrorMessage, cloudRequest, isTransientCloudError } from "../src/import-v2/cloud-retry.js";

const gatewayFailure = { message: "<!DOCTYPE html><title>supabase.co | 525: SSL handshake failed</title>", code: "525" };

describe("Import V2 Cloud retry", () => {
  it("riconosce il 525 senza mostrare l'intera pagina HTML", async () => {
    expect(isTransientCloudError(gatewayFailure)).toBe(true);
    expect(cloudErrorMessage(gatewayFailure)).toBe("Supabase temporaneamente non raggiungibile (HTTP 525). Il checkpoint resta disponibile per la ripresa.");
    const operation = vi.fn()
      .mockResolvedValueOnce({ error: gatewayFailure })
      .mockResolvedValueOnce({ error: null });
    const wait = vi.fn().mockResolvedValue(undefined);
    expect(await cloudRequest(operation, { wait })).toEqual({ error: null });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("non ripete errori di quota o di permesso", async () => {
    const operation = vi.fn().mockResolvedValue({ error: { message: "payment required", code: "402" } });
    expect(await cloudRequest(operation, { wait: async () => undefined })).toMatchObject({ error: { code: "402" } });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(isTransientCloudError({ message: "permission denied", code: "42501" })).toBe(false);
  });

  it("riassume anche un'eccezione HTML dopo l'ultimo tentativo", async () => {
    const operation = vi.fn().mockRejectedValue(new Error(gatewayFailure.message));
    await expect(cloudRequest(operation, { attempts: 2, wait: async () => undefined }))
      .rejects.toThrow("Supabase temporaneamente non raggiungibile (HTTP 525)");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
