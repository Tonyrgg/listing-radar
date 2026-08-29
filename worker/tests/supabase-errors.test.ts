import { describe, expect, it } from "vitest";

import { describeSupabaseOperationalError, isSupabaseProjectRestricted } from "../src/services/supabase-errors.js";

describe("errori di limitazione Supabase", () => {
  it.each([
    [{ status: 402, message: "Payment Required" }],
    [{ code: "402", details: "Organization is over its quota" }],
    [new Error("Fair Use restriction: egress quota exceeded")],
  ])("riconosce una risposta di restrizione senza dipendere dalla forma dell'errore", (error) => {
    expect(isSupabaseProjectRestricted(error)).toBe(true);
    expect(describeSupabaseOperationalError(error)).toContain("persistenza cloud sono sospese");
    expect(describeSupabaseOperationalError(error)).toContain("GitHub");
  });

  it("non trasforma gli errori applicativi normali", () => {
    const error = new Error("relation property_worker_jobs does not exist");
    expect(isSupabaseProjectRestricted(error)).toBe(false);
    expect(describeSupabaseOperationalError(error)).toBe(error.message);
  });

  it("gestisce cause circolari senza ricorsione infinita", () => {
    const error = { message: "errore di rete" } as Record<string, unknown>;
    error.details = error;
    expect(isSupabaseProjectRestricted(error)).toBe(false);
  });
});
