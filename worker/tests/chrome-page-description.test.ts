import { describe, expect, it, vi } from "vitest";

import { pageTitleWithin } from "../src/services/chrome.js";

describe("lettura schede Chrome", () => {
  it("non blocca la connessione se una scheda non restituisce il titolo", async () => {
    vi.useFakeTimers();
    try {
      const result = pageTitleWithin({ title: () => new Promise<string>(() => undefined) }, 3_000);
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(result).resolves.toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("conserva il titolo quando la scheda risponde", async () => {
    await expect(pageTitleWithin({ title: async () => "Ricerca persona fisica" }, 3_000))
      .resolves.toBe("Ricerca persona fisica");
  });
});
