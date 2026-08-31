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

/** Chiamate RPC registrate, con la risposta che il finto database restituisce. */
const rpcCalls: string[] = [];
let rpcResponse: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => createBuilder(table),
    rpc: (name: string) => {
      rpcCalls.push(name);
      return Promise.resolve(rpcResponse);
    },
  }),
}));

const {
  EXCLUDED_MATCH_SCORE,
  getRequestCoverage,
  getProperty,
  getRequest,
  listMatches,
} = await import("@/lib/matching/repository");

function matchQueries() {
  return queries.filter((query) => query.table === "request_property_matches");
}

function appliedFilter(query: { methods: Array<[string, unknown[]]> }) {
  return query.methods.find(([name]) => name === "gt");
}

describe("liste dei match", () => {
  beforeEach(() => {
    queries.length = 0;
    rpcCalls.length = 0;
    rpcResponse = { data: [], error: null };
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

  it("chiede al database la copertura di ogni richiesta", async () => {
    rpcResponse = {
      data: [
        { request_id: "r1", best_score: 91, proposable_count: 5, relevant_count: 3 },
        // Ha abbinamenti, ma nessuno che valga una proposta: e' scoperta.
        { request_id: "r2", best_score: "18.4", proposable_count: 7, relevant_count: 0 },
      ],
      error: null,
    };
    const copertura = await getRequestCoverage();
    // La copertura va chiesta al database: ricavarla dalle righe scaricate,
    // che hanno un limite, farebbe sembrare scoperte le richieste tagliate.
    expect(rpcCalls).toEqual(["matching_request_coverage"]);
    expect(copertura?.get("r1")).toEqual({ bestScore: 91, proposableCount: 5, relevantCount: 3 });
    // Il punteggio arriva da una colonna numeric, quindi puo' essere stringa.
    expect(copertura?.get("r2")?.bestScore).toBeCloseTo(18.4);
    expect(copertura?.get("r2")?.relevantCount).toBe(0);
    expect(copertura?.get("r3")).toBeUndefined();
  });

  it("restituisce null quando il database segnala un errore sulla copertura", async () => {
    rpcResponse = { data: null, error: { message: "boom" } };
    expect(await getRequestCoverage()).toBeNull();
  });

  it("restituisce null, non una mappa vuota, quando la copertura non e' leggibile", async () => {
    // Una mappa vuota si leggerebbe come «tutte le richieste sono scoperte»:
    // la risposta sbagliata piu' credibile che questa funzione possa dare.
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(await getRequestCoverage()).toBeNull();
  });

  it("non applica filtri se Supabase non e' configurato", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(await listMatches()).toEqual([]);
    expect(matchQueries()).toHaveLength(0);
  });
});
