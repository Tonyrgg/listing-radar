import { z } from "zod";
import { openTabSignature } from "../agency-browser/open-tab-contract.js";
import { normalizeSisterStreet } from "../core/street-scan.js";
import { addressIdentity } from "../import-v2/identity.js";
import { effectiveSource, type TerritoryState } from "./model.js";

const endpoint = "/api/worker/territory-news?map=1";
const layer = z.enum(["mercato","opportunita","privati","notizie"]);
const pin = z.object({
  title: z.string(), street: z.string(), civics: z.array(z.string()).max(12), precision: z.enum(["building","street","published","address","area"]),
  layers: z.array(layer).optional(),
  zoneIds: z.array(z.string()).optional(),
  floor: z.string().nullable().optional(), rooms: z.number().nullable().optional(),
  propertyId: z.uuid().optional(), price: z.number().nullable().optional(), source: z.string().nullable().optional(),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
});
export type NewsPin = z.infer<typeof pin>;

export function newsCivic(raw: string): string | null {
  const identity = addressIdentity(`VIA ${raw}`);
  return identity?.street === "VIA" && identity.civic !== "NC" ? identity.civic : null;
}

function streetKey(value: string) {
  return normalizeSisterStreet(value).replace(/^VIA /, "").replace(/\bSAN\b/g, "S");
}

function pinStreetKeys(pin: NewsPin) {
  const name = pin.street.replace(/,\s*(?:\d{5}\s+)?(?:Bitonto|Palombaio|Mariotto)(?:\s*\(BA\))?\s*$/i, "").trim();
  const address = addressIdentity(name);
  return [streetKey(name), ...(address && address.civic !== "NC" ? [streetKey(address.street)] : [])];
}

export function matchNewsPins<T extends NewsPin>(pins: T[], state: Readonly<TerritoryState>) {
  const canonical = new Map(state.streets.map(street => [street.id, street.linkedOfficialId ?? street.id]));
  const quarantined = new Set(Object.values(state.quarantine ?? {}).filter(issue => !issue.resolvedAt).map(issue => issue.unitKey));
  const units = new Map<string, number>();
  const acquiredStreets = new Set<string>();
  for (const unit of Object.values(state.units)) {
    if (quarantined.has(unit.key)) continue;
    const source = effectiveSource(unit);
    if (source.municipality.trim().toUpperCase() !== "BITONTO") continue;
    const streetIds = new Set(unit.streetIds.map(value => canonical.get(value) ?? value));
    for (const id of streetIds) acquiredStreets.add(id);
    const civic = addressIdentity(source.fullAddress)?.civic;
    if (!civic || civic === "NC") continue;
    for (const id of streetIds) {
      const key = `${id}|${civic}`;
      units.set(key, (units.get(key) ?? 0) + 1);
    }
  }
  const streets = new Map<string, Set<string>>();
  const networkIds = new Set<string>();
  for (const street of state.streets) {
    if (street.linkedOfficialId || street.outsideUrbanArea || street.needsReview) continue;
    const sisterName = state.memories[street.id]?.sisterSearch?.resultName;
    if (street.catalogKind === "network") {
      if (!acquiredStreets.has(street.id)) continue;
      networkIds.add(street.id);
    }
    for (const name of [street.name, street.sisterName, sisterName]) {
      if (!name) continue;
      const key = streetKey(name);
      if (!streets.has(key)) streets.set(key, new Set());
      streets.get(key)!.add(street.id);
    }
  }
  return pins.map(news => {
    const candidates = [...(pinStreetKeys(news).map(key => streets.get(key)).find(Boolean) ?? [])];
    const official = candidates.filter(id => !networkIds.has(id));
    const network = candidates.filter(id => networkIds.has(id));
    const ambiguous = official.length > 1 || network.length > 1;
    const streetIds = ambiguous ? [] : candidates;
    // Prefer the acquired route for the map shortcut. The lookup still checks both aliases.
    const streetId = ambiguous ? null : network[0] ?? official[0] ?? null;
    const matches = news.civics.map(value => {
      const civic = newsCivic(value);
      return { civic: value, count: streetId && civic ? units.get(`${streetId}|${civic}`) ?? 0 : 0 };
    });
    return { ...news, streetId, streetIds, ambiguous, matches };
  });
}

export async function fetchWorkerNews(key: string) {
  const time = Date.now().toString();
  const response = await fetch(`https://listing-radar-mu.vercel.app${endpoint}`, {
    redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { "X-Worker-Time": time, "X-Worker-Signature": openTabSignature(key, time, endpoint) },
  });
  if (response.status === 401) throw new Error("Questa postazione non è autorizzata a leggere i pin di Listing Radar.");
  if (!response.ok) throw new Error("Pin delle zone temporaneamente non disponibili.");
  return z.object({ pins: z.array(pin).max(10000), unavailable: z.array(layer).default([]) }).parse(await response.json());
}
