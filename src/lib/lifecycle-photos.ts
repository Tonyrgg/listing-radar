import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { LifecyclePropertySummary } from "@/lib/property-lifecycle/read-models/types";

/**
 * Le foto delle proprietà, firmate tutte in una volta.
 *
 * Property Lifecycle conserva i percorsi dei visual in uno spazio privato: per
 * mostrarli servono URL firmati. Il dettaglio di una proprietà li firma già da
 * sé; per una lista serve una chiamata sola, altrimenti si paga una firma per
 * riga.
 *
 * Una casa si riconosce prima dalla foto che dall'indirizzo: senza questo, ogni
 * elenco di Segnali resta una lista di stringhe.
 */
const BUCKET = "property-lifecycle-visuals";
const DURATA_SECONDI = 60 * 30;

export async function signPropertyPhotos(
  properties: Array<Pick<LifecyclePropertySummary, "id" | "representativeImagePaths">>,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();

  /* Una foto per proprietà: nelle liste la seconda non si vede mai. */
  const richieste = properties
    .map((property) => ({
      id: property.id,
      path: property.representativeImagePaths[0],
    }))
    .filter((item): item is { id: string; path: string } => Boolean(item.path));

  if (!richieste.length) {
    return urls;
  }

  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(
        richieste.map((item) => item.path),
        DURATA_SECONDI,
      );

    if (error || !data) {
      return urls;
    }

    data.forEach((firma, indice) => {
      const richiesta = richieste[indice];
      if (richiesta && firma?.signedUrl && !firma.error) {
        urls.set(richiesta.id, firma.signedUrl);
      }
    });
  } catch {
    /* Senza foto la lista resta leggibile: non è un motivo per non mostrarla. */
    return urls;
  }

  return urls;
}
