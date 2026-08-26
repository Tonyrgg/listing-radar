"use server";

import { requireUser } from "@/lib/auth";
import {
  extractListingCoordinates,
  normalizeListingCoordinates,
} from "@/lib/listings/coordinates";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type {
  Agent,
  CreateMapActivityLogInput,
  CreateMapAreaInput,
  CreateMapPinInput,
  CreateMapStreetInput,
  GeoJsonGeometry,
  ListingMapData,
  ListingMapPin,
  MapActivityLog,
  MapArea,
  MapPin,
  MapStatus,
  MapStreet,
  PinCategory,
  PinPriority,
  PinStatus,
  UpdateMapAreaInput,
  UpdateMapPinInput,
  UpdateMapStreetInput,
} from "@/lib/map/types";

type AgentRow = {
  id: string;
  name: string;
  color: string;
  created_at: string | null;
  updated_at: string | null;
};

type MapAreaRow = {
  id: string;
  name: string;
  agent_id: string | null;
  color: string | null;
  geometry: GeoJsonGeometry;
  status: MapArea["status"];
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type MapStreetRow = {
  id: string;
  name: string;
  agent_id: string | null;
  area_id: string | null;
  geometry: GeoJsonGeometry | null;
  status: MapStatus;
  last_completed_at: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type MapPinRow = {
  id: string;
  title: string;
  category: PinCategory;
  status: PinStatus;
  priority: PinPriority;
  agent_id: string | null;
  area_id: string | null;
  street_id: string | null;
  listing_id: string | null;
  latitude: number | string;
  longitude: number | string;
  address_raw: string | null;
  notes: string | null;
  follow_up_at: string | null;
  last_contacted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type MapActivityLogRow = {
  id: string;
  agent_id: string | null;
  area_id: string | null;
  street_id: string | null;
  pin_id: string | null;
  action_type: string;
  notes: string | null;
  created_at: string | null;
};

type ListingSnapshotCoordinateRow = {
  latitude: number | string | null;
  longitude: number | string | null;
  coordinates_source: string | null;
  raw_payload: Record<string, unknown> | null;
  checked_at: string | null;
};

type ListingMapRow = {
  id: string;
  title: string;
  source: string;
  url: string;
  price: number | null;
  sqm: number | null;
  address_raw: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  coordinates_source: string | null;
  status: string | null;
  listing_snapshots?: ListingSnapshotCoordinateRow[] | null;
};

function assertNoError(error: { message: string } | null, fallback: string) {
  if (error) {
    throw new Error(`${fallback}: ${error.message}`);
  }
}

async function getMapSupabase() {
  await requireUser();
  return getSupabaseServiceClient();
}

function mapAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapArea(row: MapAreaRow): MapArea {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agent_id,
    color: row.color,
    geometry: row.geometry,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStreet(row: MapStreetRow): MapStreet {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agent_id,
    areaId: row.area_id,
    geometry: row.geometry,
    status: row.status,
    lastCompletedAt: row.last_completed_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPin(row: MapPinRow): MapPin {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    status: row.status,
    priority: row.priority,
    agentId: row.agent_id,
    areaId: row.area_id,
    streetId: row.street_id,
    listingId: row.listing_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    addressRaw: row.address_raw,
    notes: row.notes,
    followUpAt: row.follow_up_at,
    lastContactedAt: row.last_contacted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActivityLog(row: MapActivityLogRow): MapActivityLog {
  return {
    id: row.id,
    agentId: row.agent_id,
    areaId: row.area_id,
    streetId: row.street_id,
    pinId: row.pin_id,
    actionType: row.action_type,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function mapListingMapPin(row: ListingMapRow): ListingMapPin | null {
  const persistedCoordinates = normalizeListingCoordinates({
    latitude: row.latitude,
    longitude: row.longitude,
    source: row.coordinates_source ?? `${row.source}:listing`,
  });

  if (persistedCoordinates) {
    return {
      id: row.id,
      title: row.title,
      source: row.source,
      url: row.url,
      price: row.price,
      sqm: row.sqm,
      addressRaw: row.address_raw,
      latitude: persistedCoordinates.latitude,
      longitude: persistedCoordinates.longitude,
    };
  }

  const snapshots = [...(row.listing_snapshots ?? [])].sort((left, right) =>
    (right.checked_at ?? "").localeCompare(left.checked_at ?? ""),
  );

  for (const snapshot of snapshots) {
    const coordinates =
      normalizeListingCoordinates({
        latitude: snapshot.latitude,
        longitude: snapshot.longitude,
        source: snapshot.coordinates_source ?? `${row.source}:snapshot`,
      }) ??
      extractListingCoordinates({
        rawPayload: snapshot.raw_payload,
        source: `${row.source}:snapshot`,
      });
    if (!coordinates) {
      continue;
    }

    return {
      id: row.id,
      title: row.title,
      source: row.source,
      url: row.url,
      price: row.price,
      sqm: row.sqm,
      addressRaw: row.address_raw,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    };
  }

  return null;
}

function hasStreetNumberAddress(row: ListingMapRow) {
  const value = row.address_raw?.trim();
  if (!value) {
    return false;
  }

  return /\b(?:arco|corso|largo|piazza|strada|via|viale|vicolo)\b[^\d]{0,90}\d+/i.test(value);
}

function areaPayload(input: CreateMapAreaInput | UpdateMapAreaInput) {
  return {
    name: input.name,
    agent_id: input.agentId,
    color: input.color,
    geometry: input.geometry,
    status: input.status,
    notes: input.notes,
  };
}

function streetPayload(input: CreateMapStreetInput | UpdateMapStreetInput) {
  return {
    name: input.name,
    agent_id: input.agentId,
    area_id: input.areaId,
    geometry: input.geometry,
    status: input.status,
    last_completed_at: input.lastCompletedAt,
    notes: input.notes,
  };
}

function pinPayload(input: CreateMapPinInput | UpdateMapPinInput) {
  return {
    title: input.title,
    category: input.category,
    status: input.status,
    priority: input.priority,
    agent_id: input.agentId,
    area_id: input.areaId,
    street_id: input.streetId,
    listing_id: input.listingId,
    latitude: input.latitude,
    longitude: input.longitude,
    address_raw: input.addressRaw,
    notes: input.notes,
    follow_up_at: input.followUpAt,
    last_contacted_at: input.lastContactedAt,
  };
}

export async function listAgents() {
  const supabase = await getMapSupabase();
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .order("name", { ascending: true });

  assertNoError(error, "Impossibile caricare gli agenti");
  return ((data ?? []) as AgentRow[]).map(mapAgent);
}

export async function listMapAreas() {
  const supabase = await getMapSupabase();
  const { data, error } = await supabase
    .from("map_areas")
    .select("*")
    .order("created_at", { ascending: false });

  assertNoError(error, "Impossibile caricare le aree");
  return ((data ?? []) as MapAreaRow[]).map(mapArea);
}

export async function createMapArea(input: CreateMapAreaInput) {
  const supabase = await getMapSupabase();
  const { data, error } = await supabase
    .from("map_areas")
    .insert(areaPayload(input))
    .select("*")
    .single();

  assertNoError(error, "Impossibile creare l'area");
  return mapArea(data as MapAreaRow);
}

export async function updateMapArea(id: string, input: UpdateMapAreaInput) {
  const supabase = await getMapSupabase();
  const { data, error } = await supabase
    .from("map_areas")
    .update(areaPayload(input))
    .eq("id", id)
    .select("*")
    .single();

  assertNoError(error, "Impossibile aggiornare l'area");
  return mapArea(data as MapAreaRow);
}

export async function deleteMapArea(id: string) {
  const supabase = await getMapSupabase();
  const { error } = await supabase.from("map_areas").delete().eq("id", id);
  assertNoError(error, "Impossibile eliminare l'area");
}

export async function listMapStreets() {
  const supabase = await getMapSupabase();
  const { data, error } = await supabase
    .from("map_streets")
    .select("*")
    .order("created_at", { ascending: false });

  assertNoError(error, "Impossibile caricare le strade");
  return ((data ?? []) as MapStreetRow[]).map(mapStreet);
}

export async function createMapStreet(input: CreateMapStreetInput) {
  const supabase = await getMapSupabase();
  const { data, error } = await supabase
    .from("map_streets")
    .insert(streetPayload(input))
    .select("*")
    .single();

  assertNoError(error, "Impossibile creare la strada");
  return mapStreet(data as MapStreetRow);
}

export async function updateMapStreet(id: string, input: UpdateMapStreetInput) {
  const supabase = await getMapSupabase();
  const { data, error } = await supabase
    .from("map_streets")
    .update(streetPayload(input))
    .eq("id", id)
    .select("*")
    .single();

  assertNoError(error, "Impossibile aggiornare la strada");
  return mapStreet(data as MapStreetRow);
}

export async function deleteMapStreet(id: string) {
  const supabase = await getMapSupabase();
  const { error } = await supabase.from("map_streets").delete().eq("id", id);
  assertNoError(error, "Impossibile eliminare la strada");
}

export async function listMapPins() {
  const supabase = await getMapSupabase();
  const { data, error } = await supabase
    .from("map_pins")
    .select("*")
    .order("created_at", { ascending: false });

  assertNoError(error, "Impossibile caricare i pin");
  return ((data ?? []) as MapPinRow[]).map(mapPin);
}

export async function listListingMapData(): Promise<ListingMapData> {
  const supabase = await getMapSupabase();
  const rows: ListingMapRow[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("listings")
      .select(
        "id,title,source,url,price,sqm,address_raw,latitude,longitude,coordinates_source,status,listing_snapshots(latitude,longitude,coordinates_source,raw_payload,checked_at)",
      )
      .neq("status", "archived")
      .order("last_seen_at", { ascending: false })
      .range(from, from + pageSize - 1);

    assertNoError(error, "Impossibile caricare gli annunci sulla mappa");

    const pageRows = (data ?? []) as ListingMapRow[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      break;
    }
  }

  const pins = rows
    .map(mapListingMapPin)
    .filter((pin): pin is ListingMapPin => Boolean(pin));

  return {
    pins,
    totalListings: rows.length,
    streetAddressListings: rows.filter(hasStreetNumberAddress).length,
  };
}

/**
 * Le case sulla mappa, dal nuovo archivio.
 *
 * La mappa disegnava gli annunci di `listings`, la tabella in dismissione:
 * quarantasei punti su trecentottantasei righe che nessuno aggiorna più.
 * Property Lifecycle tiene le stesse case ricondotte all'immobile vero, con
 * la posizione risolta in `locations`: centoquarantadue hanno le coordinate.
 *
 * Il formato resta quello di prima, perché la mappa non deve accorgersene.
 */
export async function listPropertyMapData(): Promise<ListingMapData> {
  const supabase = await getMapSupabase();

  const [proprieta, posizioni] = await Promise.all([
    supabase
      .from("properties")
      .select("id,primary_location_id,canonical_attributes,property_state")
      .neq("identity_status", "MERGED")
      .limit(2000),
    supabase
      .from("locations")
      .select("id,latitude,longitude,raw_text,street_name,street_number,municipality")
      .not("latitude", "is", null)
      .limit(2000),
  ]);

  assertNoError(proprieta.error, "Impossibile caricare le case sulla mappa");
  assertNoError(posizioni.error, "Impossibile caricare le posizioni delle case");

  type RigaPosizione = {
    id: string;
    latitude: number | null;
    longitude: number | null;
    raw_text: string | null;
    street_name: string | null;
    street_number: string | null;
    municipality: string | null;
  };

  type RigaProprieta = {
    id: string;
    primary_location_id: string | null;
    canonical_attributes: Record<string, unknown> | null;
    property_state: string | null;
  };

  const perId = new Map(
    ((posizioni.data ?? []) as RigaPosizione[]).map((riga) => [riga.id, riga]),
  );

  const righe = (proprieta.data ?? []) as RigaProprieta[];
  const pins: ListingMapPin[] = [];
  let conIndirizzoPreciso = 0;

  for (const riga of righe) {
    const attributi = riga.canonical_attributes ?? {};
    const indirizzo = typeof attributi.address === "string" ? attributi.address : null;
    if (indirizzo) conIndirizzoPreciso += 1;

    const posizione = riga.primary_location_id ? perId.get(riga.primary_location_id) : undefined;
    if (!posizione?.latitude || !posizione.longitude) continue;

    pins.push({
      id: riga.id,
      title:
        indirizzo ??
        [posizione.street_name, posizione.street_number].filter(Boolean).join(" ") ??
        "Casa osservata",
      source: posizione.municipality ?? "Bitonto",
      url: `/casa/${riga.id}`,
      price: typeof attributi.priceAmount === "number" ? attributi.priceAmount : null,
      sqm: typeof attributi.surfaceSqm === "number" ? attributi.surfaceSqm : null,
      addressRaw: indirizzo ?? posizione.raw_text,
      latitude: posizione.latitude,
      longitude: posizione.longitude,
    });
  }

  return {
    pins,
    totalListings: righe.length,
    streetAddressListings: conIndirizzoPreciso,
  };
}

export async function createMapPin(input: CreateMapPinInput) {
  const supabase = await getMapSupabase();
  const { data, error } = await supabase
    .from("map_pins")
    .insert(pinPayload(input))
    .select("*")
    .single();

  assertNoError(error, "Impossibile creare il pin");
  return mapPin(data as MapPinRow);
}

export async function updateMapPin(id: string, input: UpdateMapPinInput) {
  const supabase = await getMapSupabase();
  const { data, error } = await supabase
    .from("map_pins")
    .update(pinPayload(input))
    .eq("id", id)
    .select("*")
    .single();

  assertNoError(error, "Impossibile aggiornare il pin");
  return mapPin(data as MapPinRow);
}

export async function deleteMapPin(id: string) {
  const supabase = await getMapSupabase();
  const { error } = await supabase.from("map_pins").delete().eq("id", id);
  assertNoError(error, "Impossibile eliminare il pin");
}

export async function createMapActivityLog(input: CreateMapActivityLogInput) {
  const supabase = await getMapSupabase();
  const { data, error } = await supabase
    .from("map_activity_logs")
    .insert({
      agent_id: input.agentId ?? null,
      area_id: input.areaId ?? null,
      street_id: input.streetId ?? null,
      pin_id: input.pinId ?? null,
      action_type: input.actionType,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();

  assertNoError(error, "Impossibile registrare l'attività");
  return mapActivityLog(data as MapActivityLogRow);
}

export async function listMapActivityLogs(limit = 20) {
  const supabase = await getMapSupabase();
  const { data, error } = await supabase
    .from("map_activity_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  assertNoError(error, "Impossibile caricare le attività");
  return ((data ?? []) as MapActivityLogRow[]).map(mapActivityLog);
}
