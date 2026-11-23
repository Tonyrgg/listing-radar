import { describe, expect, it } from "vitest";
import { portalBlock } from "../src/agency-browser/browse.js";

describe("Rifiuto della scansione del portale", () => {
  const now = Date.parse("2026-11-23T09:00:00Z");

  it("riconosce i due avvisi in italiano anche con HTTP 200", () => {
    expect(portalBlock(200, "L’accesso è temporaneamente limitato")?.retryAt).toBeNull();
    expect(portalBlock(200, "Troppe richieste")?.message).toContain("Troppe richieste");
    expect(portalBlock(200, "Case in vendita a Bitonto")).toBeNull();
  });

  it("rispetta Retry-After per HTTP 429, senza programmarne il riavvio", () => {
    expect(portalBlock(429, "", "60", now)?.retryAt).toBe(now + 60_000);
    expect(portalBlock(429, "", new Date(now + 60_000).toUTCString(), now)?.retryAt).toBe(now + 60_000);
    expect(portalBlock(429, "", undefined, now)?.retryAt).toBeNull();
    expect(portalBlock(403, "", "60", now)?.retryAt).toBeNull();
  });
});
