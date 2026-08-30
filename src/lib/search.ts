import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { listRequests, listZones } from "@/lib/matching/repository";
import { vistaRicerca } from "@/lib/property-lifecycle/read-models/server";
import type { LifecyclePropertySummary } from "@/lib/property-lifecycle/read-models/types";
import type { InternalZone, PortfolioProperty, PropertyRequest } from "@/lib/matching/types";

/**
 * Una ricerca sola.
 *
 * Prima, per trovare «via Piepoli», bisognava sapere prima se era una casa del
 * mercato, una casa nostra, la richiesta di un cliente o una zona: ognuna
 * abitava in una sezione diversa, con la sua casella di ricerca. Sapere dove
 * cercare una cosa è un lavoro che il programma può fare da solo.
 *
 * I filtri stanno sul database, non in memoria: cercare non deve caricare
 * cinquecentosettantacinque case per scartarne cinquecentosettanta.
 */

export type RisultatiRicerca = {
  termine: string;
  case: LifecyclePropertySummary[];
  nostre: PortfolioProperty[];
  richieste: Array<
    PropertyRequest & { clients?: { id?: string; full_name?: string | null } | null }
  >;
  zone: InternalZone[];
  quante: number;
};

const VUOTO: Omit<RisultatiRicerca, "termine"> = {
  case: [],
  nostre: [],
  richieste: [],
  zone: [],
  quante: 0,
};

async function nostreCase(modello: string, limite: number): Promise<PortfolioProperty[]> {
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from("portfolio_properties")
      .select("*, zone:internal_zones(id,name)")
      .or(`address.ilike.${modello},title.ilike.${modello},municipality.ilike.${modello}`)
      .limit(limite);

    if (error) return [];

    return (data ?? []) as PortfolioProperty[];
  } catch {
    return [];
  }
}

export async function cercaOvunque(termine: string, limite = 8): Promise<RisultatiRicerca> {
  const parola = termine.trim();

  if (parola.length < 2) {
    return { termine: parola, ...VUOTO };
  }

  const modello = `%${parola}%`;
  const minuscolo = parola.toLocaleLowerCase("it");

  const [mercato, nostre, richieste, zone] = await Promise.all([
    vistaRicerca(parola, limite),
    nostreCase(modello, limite),
    listRequests(),
    listZones(),
  ]);

  /* Richieste e zone stanno in poche centinaia di righe: filtrarle qui costa
   * meno di una query in più, e permette di cercare anche nel nome del cliente. */
  const richiesteTrovate = richieste
    .filter((richiesta) => {
      const testo = [
        richiesta.clients?.full_name,
        richiesta.title,
        richiesta.municipality,
        ...(richiesta.property_types ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("it");

      return testo.includes(minuscolo);
    })
    .slice(0, limite);

  const zoneTrovate = zone
    .filter((zona) => {
      const testo = [zona.name, ...(zona.aliases ?? []), ...(zona.associated_streets ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("it");

      return testo.includes(minuscolo);
    })
    .slice(0, limite);

  const caseTrovate = mercato.data ?? [];

  return {
    termine: parola,
    case: caseTrovate,
    nostre,
    richieste: richiesteTrovate,
    zone: zoneTrovate,
    quante: caseTrovate.length + nostre.length + richiesteTrovate.length + zoneTrovate.length,
  };
}
