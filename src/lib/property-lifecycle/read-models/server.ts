import "server-only";

import { unstable_cache } from "next/cache";

import { PropertyLifecycleReadRepository } from "@/lib/property-lifecycle/read-models/repository";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export interface LifecycleViewResult<T> {
  available: boolean;
  data: T | null;
  message: string | null;
}

export function getPropertyLifecycleReadRepository() {
  return new PropertyLifecycleReadRepository(getSupabaseServiceClient());
}

/**
 * Le viste dell'archivio V2, lette una volta sola per tutti.
 *
 * Ogni pagina è dinamica e rifà le sue query a ogni passaggio: aprire «Oggi»,
 * tornare indietro e riaprirlo significava rileggere lo stesso archivio da
 * capo, con il database dall'altra parte della rete. Tra un movimento e
 * l'altro delle fonti non cambia niente, quindi la lettura vive un minuto in
 * cache: il secondo passaggio non paga più il viaggio.
 *
 * Non è una scorciatoia sulla verità: ogni azione che cambia qualcosa invalida
 * l'etichetta `lifecycle` e la lettura successiva riparte dal database.
 */
export const LIFECYCLE_CACHE_TAG = "lifecycle";

/** Un minuto: più corto della distanza fra due letture delle fonti. */
const DURATA_CACHE_SECONDI = 60;

function vista<A extends unknown[], T>(
  nome: string,
  lettura: (repository: PropertyLifecycleReadRepository, ...args: A) => Promise<T>,
): (...args: A) => Promise<LifecycleViewResult<T>> {
  const letturaInCache = unstable_cache(
    (...args: A) => lettura(getPropertyLifecycleReadRepository(), ...args),
    ["lifecycle", nome],
    {
      tags: [LIFECYCLE_CACHE_TAG, `${LIFECYCLE_CACHE_TAG}:${nome}`],
      revalidate: DURATA_CACHE_SECONDI,
    },
  );

  return async (...args: A) => {
    try {
      return { available: true, data: await letturaInCache(...args), message: null };
    } catch (error) {
      return {
        available: false,
        data: null,
        message:
          error instanceof Error
            ? error.message
            : "Il modello Lifecycle V2 non è disponibile.",
      };
    }
  };
}

export const vistaOggi = vista("dashboard", (repository) => repository.dashboard());
export const vistaArchivio = vista("archive", (repository) => repository.archive());
export const vistaOpportunita = vista("opportunities", (repository) =>
  repository.opportunities(),
);
export const vistaSegnaliOpportunita = vista("opportunitySignals", (repository) =>
  repository.opportunitySignals(),
);
export const vistaAgenzie = vista("agencies", (repository) => repository.agencies());
export const vistaRecensioni = vista("reviews", (repository) => repository.reviews());
export const vistaPrivati = vista("privateRadar", (repository) =>
  repository.privateRadar(),
);
export const vistaAgenzia = vista("agency", (repository, slug: string) =>
  repository.agency(slug),
);
export const vistaCasa = vista("property", (repository, id: string) =>
  repository.property(id),
);
export const vistaMovimenti = vista("marketEvents", (repository, limite: number) =>
  repository.marketEvents(limite),
);
export const vistaRicerca = vista(
  "searchProperties",
  (repository, termine: string, limite: number) =>
    repository.searchProperties(termine, limite),
);

/**
 * La lettura senza cache, per chi ha bisogno del database in questo istante.
 * Le pagine usano le viste sopra: questa resta per gli script e per i casi in
 * cui un dato appena scritto va riletto prima di rispondere.
 */
export async function loadLifecycleView<T>(
  reader: (repository: PropertyLifecycleReadRepository) => Promise<T>,
): Promise<LifecycleViewResult<T>> {
  try {
    return {
      available: true,
      data: await reader(getPropertyLifecycleReadRepository()),
      message: null,
    };
  } catch (error) {
    return {
      available: false,
      data: null,
      message:
        error instanceof Error
          ? error.message
          : "Il modello Lifecycle V2 non è disponibile.",
    };
  }
}
