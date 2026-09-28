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
  leads: Array<{id:string;address:string;locality:string;status:string;priority:string}>;
  contacts: Array<{id:string;full_name:string;phone:string|null;role:string;client_id:string|null}>;
  buyers: Array<{id:string;full_name:string|null;phone:string|null}>;
  quante: number;
};

const VUOTO: Omit<RisultatiRicerca, "termine"> = {
  case: [],
  nostre: [],
  richieste: [],
  zone: [],
  leads: [],
  contacts: [],
  buyers: [],
  quante: 0,
};

async function nostreCase(modello: string, limite: number): Promise<PortfolioProperty[]> {
    const { data, error } = await getSupabaseServiceClient()
      .from("portfolio_properties")
      .select("*, zone:internal_zones(id,name), property_feature_values(value, feature:feature_definitions(key,label))")
      .or(`address.ilike.${modello},title.ilike.${modello},municipality.ilike.${modello}`)
      .limit(limite);

    if (error) throw new Error(`Ricerca portafoglio: ${error.message}`);

    return (data ?? []) as PortfolioProperty[];
}

export async function cercaOvunque(termine: string, limite = 8): Promise<RisultatiRicerca> {
  const parola = termine.trim();

  if (parola.length < 2) {
    return { termine: parola, ...VUOTO };
  }

  const safeTerm = parola.replace(/[^\p{L}\p{N}\s'\-]/gu,"");
  if (safeTerm.length < 2) return { termine: parola, ...VUOTO };
  const modello = `%${safeTerm}%`;
  const minuscolo = parola.toLocaleLowerCase("it");
  const db = getSupabaseServiceClient();

  const [mercato, nostre, richieste, zone, leadsResult,contactsResult,buyersResult] = await Promise.all([
    vistaRicerca(safeTerm, limite),
    nostreCase(modello, limite),
    listRequests(),
    listZones(),
    db.from("acquisition_leads").select("id,address,locality,status,priority")
      .ilike("address",modello).limit(limite),
    db.from("acquisition_contacts").select("id,full_name,phone,role,client_id")
      .or(`full_name.ilike.${modello},phone.ilike.${modello}`).limit(limite),
    db.from("clients").select("id,full_name,phone")
      .or(`full_name.ilike.${modello},phone.ilike.${modello}`).limit(limite),
  ]);
  for (const result of [leadsResult,contactsResult,buyersResult])
    if (result.error) throw new Error(`Ricerca persone/opportunità: ${result.error.message}`);

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
  const linkedClientIds = new Set((contactsResult.data ?? []).map(x=>x.client_id).filter(Boolean));
  const buyers = (buyersResult.data ?? []).filter(x=>!linkedClientIds.has(x.id));

  return {
    termine: parola,
    case: caseTrovate,
    nostre,
    richieste: richiesteTrovate,
    zone: zoneTrovate,
    leads:leadsResult.data ?? [],
    contacts:contactsResult.data ?? [],
    buyers,
    quante: caseTrovate.length + nostre.length + richiesteTrovate.length + zoneTrovate.length
      + (leadsResult.data?.length ?? 0) + (contactsResult.data?.length ?? 0)
      + buyers.length,
  };
}
