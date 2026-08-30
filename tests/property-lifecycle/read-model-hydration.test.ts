import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PropertyLifecycleReadRepository } from "@/lib/property-lifecycle/read-models/repository";

/**
 * L'archivio si legge in un viaggio solo.
 *
 * Prima ogni elenco ricostruiva le schede con quattro ondate di query in fila e
 * scaricava tutta la storia dei prezzi per leggerne l'ultima riga. Queste prove
 * fissano il comportamento nuovo: una sola chiamata a
 * `lifecycle_property_hydration` per elenco, e la stessa regola di prima su
 * quale prezzo è «quello di adesso».
 */

type Riga = Record<string, unknown>;

function interrogazione(righe: Riga[]) {
  const builder: Record<string, unknown> = {};
  for (const metodo of ["select", "neq", "eq", "in", "not", "order", "limit", "range"]) {
    builder[metodo] = () => builder;
  }
  builder.then = (risolvi: (valore: { data: Riga[]; error: null }) => unknown) =>
    Promise.resolve(risolvi({ data: righe, error: null }));
  return builder;
}

function proprieta(id: string, attributi: Riga = {}): Riga {
  return {
    id,
    building_id: null,
    primary_location_id: null,
    property_type: "Appartamento",
    identity_status: "PROVISIONAL",
    sale_status: "UNKNOWN",
    property_state: "ACTIVE_AGENCY",
    true_market_start_lower_bound: null,
    true_market_start_upper_bound: null,
    true_market_start_method: null,
    true_market_start_confidence: null,
    relaunch_count: 0,
    first_seen_at: "2026-08-01T00:00:00.000Z",
    last_seen_at: "2026-08-27T00:00:00.000Z",
    representative_image_paths: [],
    canonical_attributes: {
      address: "Via Mazzini 10",
      locality: "Bitonto",
      surfaceSqm: 80,
      rooms: 3,
      ...attributi,
    },
  };
}

function archivio(righe: Riga[], idratazione: Riga[]) {
  const chiamate: Array<{ nome: string; argomenti: unknown }> = [];
  const db = {
    from: (tabella: string) => interrogazione(tabella === "properties" ? righe : []),
    rpc: (nome: string, argomenti: unknown) => {
      chiamate.push({ nome, argomenti });
      return Promise.resolve({ data: idratazione, error: null });
    },
  } as unknown as SupabaseClient;

  return { repository: new PropertyLifecycleReadRepository(db), chiamate };
}

describe("idratazione dell'archivio", () => {
  it("chiede l'intero elenco al database una volta sola", async () => {
    const { repository, chiamate } = archivio(
      [proprieta("a"), proprieta("b"), proprieta("c")],
      [],
    );

    await repository.archive();

    expect(chiamate).toHaveLength(1);
    expect(chiamate[0].nome).toBe("lifecycle_property_hydration");
    expect(chiamate[0].argomenti).toEqual({ p_ids: ["a", "b", "c"] });
  });

  it("mostra il prezzo dell'ultima lettura, di chiunque sia", async () => {
    const { repository } = archivio(
      [proprieta("a")],
      [
        {
          property_id: "a",
          agency_refs: [],
          latest_snapshot: {
            title: "Annuncio dell'agenzia",
            price_amount: 150000,
            surface_sqm: 90,
            rooms: 3,
            observed_at: "2026-08-20T00:00:00.000Z",
          },
          latest_private: {
            title: "Annuncio del privato",
            price_amount: 140000,
            surface_sqm: 85,
            rooms: 3,
            last_seen_at: "2026-08-25T00:00:00.000Z",
          },
          active_private_count: 1,
        },
      ],
    );

    const [casa] = await repository.archive();

    expect(casa.title).toBe("Annuncio del privato");
    expect(casa.currentPrice).toBe(140000);
    expect(casa.surfaceSqm).toBe(85);
    expect(casa.activePrivateCount).toBe(1);
  });

  it("a parità di giorno tiene la lettura dell'agenzia", async () => {
    const { repository } = archivio(
      [proprieta("a")],
      [
        {
          property_id: "a",
          agency_refs: [],
          latest_snapshot: {
            title: "Annuncio dell'agenzia",
            price_amount: 150000,
            surface_sqm: 90,
            rooms: 3,
            observed_at: "2026-08-25T00:00:00.000Z",
          },
          latest_private: {
            title: "Annuncio del privato",
            price_amount: 140000,
            surface_sqm: 85,
            rooms: 3,
            last_seen_at: "2026-08-25T00:00:00.000Z",
          },
          active_private_count: 0,
        },
      ],
    );

    const [casa] = await repository.archive();

    expect(casa.title).toBe("Annuncio dell'agenzia");
    expect(casa.currentPrice).toBe(150000);
  });

  it("senza nessuna lettura ricade sui dati della casa", async () => {
    const { repository } = archivio([proprieta("a")], [
      {
        property_id: "a",
        agency_refs: [],
        latest_snapshot: null,
        latest_private: null,
        active_private_count: 0,
      },
    ]);

    const [casa] = await repository.archive();

    expect(casa.title).toBe("Appartamento · Via Mazzini 10");
    expect(casa.currentPrice).toBeNull();
    expect(casa.surfaceSqm).toBe(80);
    expect(casa.rooms).toBe(3);
  });

  it("porta le agenzie che tengono la casa", async () => {
    const { repository } = archivio(
      [proprieta("a")],
      [
        {
          property_id: "a",
          agency_refs: [
            {
              id: "ag-1",
              slug: "studio-casa",
              name: "Studio Casa",
              listingId: "al-1",
              state: "ACTIVE",
              reference: "RIF-9",
              firstSeenAt: "2026-08-01T00:00:00.000Z",
              lastSeenAt: "2026-08-27T00:00:00.000Z",
            },
          ],
          latest_snapshot: null,
          latest_private: null,
          active_private_count: 0,
        },
      ],
    );

    const [casa] = await repository.archive();

    expect(casa.agencies).toHaveLength(1);
    expect(casa.agencies[0].name).toBe("Studio Casa");
    expect(casa.agencies[0].reference).toBe("RIF-9");
  });

  it("una casa senza riga di idratazione resta leggibile", async () => {
    const { repository } = archivio([proprieta("a")], []);

    const [casa] = await repository.archive();

    expect(casa.agencies).toEqual([]);
    expect(casa.activePrivateCount).toBe(0);
    expect(casa.title).toBe("Appartamento · Via Mazzini 10");
  });
});

describe("riepilogo delle fonti", () => {
  it("legge conteggi, salute e ultima corsa da una riga per agenzia", async () => {
    const chiamate: string[] = [];
    const db = {
      from: () => interrogazione([]),
      rpc: (nome: string) => {
        chiamate.push(nome);
        return Promise.resolve({
          data: [
            {
              id: "ag-1",
              slug: "studio-casa",
              name: "Studio Casa",
              website_url: "https://studiocasa.example",
              enabled: true,
              active_count: 41,
              exited_count: 7,
              sold_count: 3,
              latest_health: { state: "HEALTHY", checked_at: "2026-08-29T06:15:00.000Z" },
              latest_run: {
                status: "COMPLETED",
                started_at: "2026-08-29T06:00:00.000Z",
                finished_at: "2026-08-29T06:14:00.000Z",
                discovered_count: 52,
                in_scope_count: 41,
                excluded_count: 11,
                error_count: 0,
              },
            },
          ],
          error: null,
        });
      },
    } as unknown as SupabaseClient;

    const [agenzia] = await new PropertyLifecycleReadRepository(db).agencies();

    expect(chiamate).toEqual(["lifecycle_agency_overview"]);
    expect(agenzia.activeCount).toBe(41);
    expect(agenzia.exitedCount).toBe(7);
    expect(agenzia.soldCount).toBe(3);
    expect(agenzia.latestHealth).toBe("HEALTHY");
    expect(agenzia.latestSyncAt).toBe("2026-08-29T06:14:00.000Z");
    expect(agenzia.latestSyncCounts?.inScope).toBe(41);
  });

  it("un'agenzia mai letta non inventa numeri", async () => {
    const db = {
      from: () => interrogazione([]),
      rpc: () =>
        Promise.resolve({
          data: [
            {
              id: "ag-2",
              slug: "futura",
              name: "Futura",
              website_url: "https://futura.example",
              enabled: true,
              active_count: 0,
              exited_count: 0,
              sold_count: 0,
              latest_health: null,
              latest_run: null,
            },
          ],
          error: null,
        }),
    } as unknown as SupabaseClient;

    const [agenzia] = await new PropertyLifecycleReadRepository(db).agencies();

    expect(agenzia.latestHealth).toBeNull();
    expect(agenzia.latestSyncStatus).toBeNull();
    expect(agenzia.latestSyncAt).toBeNull();
    expect(agenzia.latestSyncCounts).toBeNull();
  });
});
