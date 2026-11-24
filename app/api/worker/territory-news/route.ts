import { timingSafeEqual } from "node:crypto";
import { unstable_cache } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { readWorkerNewsCandidates } from "@/lib/property-lifecycle/buildings/news-read-model";
import { readWorkerMarketPins, zonesForPoint } from "@/lib/property-lifecycle/read-models/worker-map-pins";
import { inSavedArea } from "@/lib/property-lifecycle/read-models/area-filter";
import { streetRepresentativePoint, type StreetLineGeometry } from "@/lib/street-registry/metrics";
import { clipStreetToAreas, type StreetArea } from "../../../../worker/src/territory/zone-streets";
import type { GeoJsonGeometry } from "@/lib/map/types";
import { openTabSignature } from "../../../../worker/src/agency-browser/open-tab-contract";

export const runtime = "nodejs";
export const maxDuration = 45;

async function readDocumentPins(db: ReturnType<typeof getSupabaseServiceClient>, areas: StreetArea[]) {
    const news = await readWorkerNewsCandidates(db, Date.now());
    const selected = news.filter(item => item.utility !== "ARCHIVE_ONLY" && item.anchor.street).slice(0, 300);
    const ids = (values: (string | null)[]) => [...new Set(values.filter((id): id is string => Boolean(id)))];
    const buildingIds = ids(selected.map(item => item.anchor.building_id));
    const streetIds = ids(selected.map(item => item.anchor.street_id));
    const [buildings, streets, references] = await Promise.all([
      buildingIds.length ? db.from("buildings").select("id,location:locations!inner(latitude,longitude)").in("id", buildingIds) : { data: [], error: null },
      streetIds.length ? db.from("street_registry_streets").select("id,geometry").in("id", streetIds) : { data: [], error: null },
      selected.length ? db.from("public_record_territorial_resolutions").select("record_id,references_json").in("record_id", ids(selected.map(item => item.anchor.record_id))) : { data: [], error: null },
    ]);
    if (buildings.error || streets.error || references.error) throw new Error("Geometrie delle notizie non disponibili");
    const byBuilding = new Map(buildings.data.map(row => [row.id, Array.isArray(row.location) ? row.location[0] : row.location]));
    const byStreet = new Map(streets.data.map(row => [row.id, row.geometry]));
    const byRecord = new Map(references.data.map(row => [row.record_id, row.references_json]));
    return selected.flatMap(item => {
      const anchor = item.anchor;
      const point = anchor.building_id ? byBuilding.get(anchor.building_id) : null;
      const inTony = (location: { latitude?: number | null; longitude?: number | null }) =>
        areas.some(area => inSavedArea(location, area.geometry as GeoJsonGeometry));
      const hasPoint = point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude);
      if (hasPoint && !inTony(point)) return [];
      const geometry = anchor.street_id && byStreet.get(anchor.street_id);
      const position = hasPoint ? point : geometry
        ? streetRepresentativePoint(clipStreetToAreas(geometry, areas) as StreetLineGeometry | null)
        : null;
      if (!position || position.latitude == null || position.longitude == null || !inTony(position)) return [];
      const refs = byRecord.get(anchor.record_id);
      const rawCivics = Array.isArray(refs) && refs.length === 1 && Array.isArray(refs[0]?.civics) ? refs[0].civics : [];
      const civics = anchor.civic ? [anchor.civic] : rawCivics.filter((value: unknown): value is string => typeof value === "string");
      return [{
        title: item.title, street: anchor.street!,
        civics: [...new Set(civics)].slice(0, 12), precision: hasPoint ? "building" : "street",
        latitude: position.latitude, longitude: position.longitude,
        layers: ["notizie"], zoneIds: zonesForPoint(position, areas),
      }];
    });
}

const readCachedDocumentPins = unstable_cache(
  (areas: StreetArea[]) => readDocumentPins(getSupabaseServiceClient(), areas),
  ["worker-document-pins-v1", process.env.NEXT_PUBLIC_SUPABASE_URL ?? "unconfigured"],
  { revalidate: 900 },
);

export async function GET(request: Request) {
  const mapMode = new URL(request.url).searchParams.get("map") === "1";
  const scope = mapMode ? "/api/worker/territory-news?map=1" : "/api/worker/territory-news";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const time = request.headers.get("x-worker-time") ?? "";
  const signature = request.headers.get("x-worker-signature") ?? "";
  if (!key || !/^\d{13}$/.test(time) || Math.abs(Date.now() - Number(time)) > 120_000 ||
    !/^[0-9a-f]{64}$/.test(signature) ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(openTabSignature(key, time, scope)))) {
    return Response.json({ error: "Accesso non autorizzato" }, { status: 401 });
  }
  try {
    const db = getSupabaseServiceClient();
    const zones = await (mapMode
      ? db.from("map_areas").select("id,name,geometry").order("id")
      : db.from("map_areas").select("id,name,geometry,agent:agents!inner(name)").ilike("agent.name", "Tony").order("id"));
    if (zones.error) throw zones.error;
    const areas = zones.data.flatMap(({ geometry, id, name }) => geometry
      ? [{ geometry, id, name, agentName: null, color: "" } as StreetArea] : []);
    if (!areas.length) return Response.json({ pins: [] });
    const [documents, market] = await Promise.allSettled([
      readCachedDocumentPins(areas),
      mapMode ? readWorkerMarketPins(db, areas) : Promise.resolve([]),
    ]);
    if (documents.status === "rejected") console.warn("Worker: lettura pin documentali non riuscita", documents.reason?.code ?? documents.reason?.message);
    if (market.status === "rejected") console.warn("Worker: lettura pin immobili non riuscita", market.reason?.code ?? market.reason?.message);
    if (documents.status === "rejected" && (!mapMode || market.status === "rejected")) throw new Error("Nessun livello disponibile");
    const unavailable = [
      ...(documents.status === "rejected" ? ["notizie"] : []),
      ...(market.status === "rejected" ? ["mercato", "opportunita", "privati"] : []),
    ];
    return Response.json({
      pins: [...(documents.status === "fulfilled" ? documents.value : []), ...(market.status === "fulfilled" ? market.value : [])],
      unavailable,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.warn("Worker: lettura mappa non riuscita", error instanceof Error ? error.message : undefined);
    return Response.json({ error: "Pin delle zone temporaneamente non disponibili" }, { status: 503 });
  }
}
