import { describe, expect, it, vi } from "vitest";
import { runStreetRegistrySequence } from "../src/services/street-registry-sequence.js";
import type { StreetRegistryOutcome } from "../src/services/street-registry.js";

describe("Rete proprietari: sequenza reale delle lavorazioni", () => {
  it("non prende la seconda via finché l'import CRM della prima non è finito", async () => {
    let finishImport!: () => void;
    const importFinished = new Promise<void>(resolve => { finishImport = resolve; });
    let enteredImport!: () => void;
    const importStarted = new Promise<void>(resolve => { enteredImport = resolve; });
    const next = vi.fn().mockResolvedValueOnce("Via Prima").mockResolvedValueOnce("Via Seconda").mockResolvedValue(null);
    const finished: string[] = [];
    const run = runStreetRegistrySequence<string>({
      isCancelled: () => false, next, onClaim: async () => {},
      waitForStreet: async () => { enteredImport(); await importFinished; },
      outcome: () => "completed", onFinished: async claim => { finished.push(claim); },
    });
    await importStarted;
    expect(next).toHaveBeenCalledTimes(1);
    expect(finished).toEqual([]);
    finishImport();
    expect(await run).toBe("exhausted");
    expect(finished).toEqual(["Via Prima", "Via Seconda"]);
  });

  it.each<StreetRegistryOutcome | null>(["to_recheck", "failed", null])("si ferma se la via termina con %s", async outcome => {
    const next = vi.fn().mockResolvedValue("Via Guidone");
    const finished = vi.fn();
    expect(await runStreetRegistrySequence({
      isCancelled: () => false, next, onClaim: async () => {}, waitForStreet: async () => {},
      outcome: () => outcome, onFinished: finished,
    })).toBe("attention");
    expect(next).toHaveBeenCalledTimes(1);
    expect(finished).toHaveBeenCalledWith("Via Guidone", outcome ?? "to_recheck");
  });

  it("la pausa chiude la via corrente e impedisce un'altra presa in carico", async () => {
    let paused = false;
    const next = vi.fn().mockResolvedValue("Via Guidone");
    const finished = vi.fn();
    expect(await runStreetRegistrySequence({
      isCancelled: () => paused, next, onClaim: async () => {},
      waitForStreet: async () => { paused = true; }, outcome: () => "completed", onFinished: finished,
    })).toBe("cancelled");
    expect(finished).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });

  it("non dichiara completata una via se l'attesa dell'import fallisce", async () => {
    const next = vi.fn().mockResolvedValue("Via Guidone");
    const finished = vi.fn();
    await expect(runStreetRegistrySequence({
      isCancelled: () => false, next, onClaim: async () => {},
      waitForStreet: async () => { throw new Error("CRM non disponibile"); }, outcome: () => "completed", onFinished: finished,
    })).rejects.toThrow("CRM non disponibile");
    expect(finished).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
