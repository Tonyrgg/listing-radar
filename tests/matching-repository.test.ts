import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Registra le query costruite senza toccare Supabase: interessa quali filtri
 * vengono applicati, non cosa risponde il database.
 */
const queries: Array<{ table: string; methods: Array<[string, unknown[]]> }> = [];

function createBuilder(table: string) {
  const record: { table: string; methods: Array<[string, unknown[]]> } = { table, methods: [] };
  queries.push(record);
  const builder: unknown = new Proxy({}, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      // Rende il builder awaitable, come lo e' quello vero di Supabase.
      if (property === "then") {
        return (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
      }
      return (...args: unknown[]) => {
        record.methods.push([property, args]);
        return builder;
      };
    },
  });
  return builder;
}

vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => ({ from: (table: string) => createBuilder(table) }),
}));

const { EXCLUDED_MATCH_SCORE, getProperty, getRequest, listMatches } = await import("@/lib/matching/repository");

function matchQueries() {
  return queries.filter((query) => query.table === "request_property_matches");
}

function appliedFilter(query: { methods: Array<[string, unknown[]]> }) {
  return query.methods.find(([name]) => name === "gt");
}

describe("liste dei match", () => {
  beforeEach(() => {
    queries.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://esempio.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-di-prova";
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("tiene fuori dall'elenco generale i match esclusi", async () => {
    await listMatches({ limit: 10 });
    const query = matchQueries()[0];
    expect(query).toBeDefined();
    expect(appliedFilter(query!)).toEqual(["gt", ["score", EXCLUDED_MATCH_SCORE]]);
  });

  it("li tiene fuori anche dalla scheda della richiesta", async () => {
    await getRequest("richiesta-1");
    const query = matchQueries()[0];
    expect(query).toBeDefined();
    expect(appliedFilter(query!)).toEqual(["gt", ["score", EXCLUDED_MATCH_SCORE]]);
  });

  it("li tiene fuori anche dalla scheda dell'immobile", async () => {
    await getProperty("immobile-1");
    const query = matchQueries()[0];
    expect(query).toBeDefined();
    expect(appliedFilter(query!)).toEqual(["gt", ["score", EXCLUDED_MATCH_SCORE]]);
  });

  it("permette di richiederli esplicitamente per capire perche' un immobile non compare", async () => {
    await listMatches({ includeExcluded: true });
    const query = matchQueries()[0];
    expect(query).toBeDefined();
    expect(appliedFilter(query!)).toBeUndefined();
  });

  it("conserva gli altri filtri accanto a quello sugli esclusi", async () => {
    await listMatches({ classification: "compatible", requestIds: ["r1"], limit: 50 });
    const query = matchQueries()[0];
    const names = query!.methods.map(([name]) => name);
    expect(names).toContain("gt");
    expect(names).toContain("eq");
    expect(names).toContain("in");
    expect(query!.methods).toContainEqual(["limit", [50]]);
  });

  it("non applica filtri se Supabase non e' configurato", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(await listMatches()).toEqual([]);
    expect(matchQueries()).toHaveLength(0);
  });
});
