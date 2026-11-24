import {privateGalleryImages} from "@/lib/property-lifecycle/read-models/private-images";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPropertyThumbnailPath, VISUALS_BUCKET } from "@/lib/property-thumbnail-path";
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
const DURATA_SECONDI = 60 * 30;

export async function readPropertyThumbnails(ids: string[]): Promise<Record<string,string>> {
  if (!ids.length) return {};
  const db = getSupabaseServiceClient();
  const {data,error} = await db.from("properties").select("id,representative_image_paths").in("id",ids);
  if (error) return {};
  const urls = new Map<string, string>();
  const legacy: Array<Pick<LifecyclePropertySummary, "id" | "representativeImagePaths">> = [];
  for (const property of data ?? []) {
    const paths: string[] = property.representative_image_paths ?? [];
    const path = paths[0];
    if (path && isPropertyThumbnailPath(path)) urls.set(property.id, `/api/property-thumbnail?${new URLSearchParams({ path })}`);
    else if (path) legacy.push({ id: property.id, representativeImagePaths: paths });
  }
  for (const [id, url] of await signPropertyPhotos(legacy)) urls.set(id, url);
  const missing=ids.filter(id=>!urls.has(id));
  if(missing.length){
    const publications=await db.from("private_publications").select("property_id,metadata").in("property_id",missing).eq("state","ACTIVE").order("last_seen_at",{ascending:false});
    if(!publications.error)for(const row of publications.data??[]){
      const image=privateGalleryImages(row.metadata?.imageUrls)[0];
      if(image&&!urls.has(row.property_id))urls.set(row.property_id,image);
    }
  }
  return Object.fromEntries(urls);
}

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
      .from(VISUALS_BUCKET)
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
