import { z } from "zod";
import { openTabSignature } from "../agency-browser/open-tab-contract.js";
import { normalizeSisterStreet } from "../core/street-scan.js";
import { addressIdentity } from "../import-v2/identity.js";
import { effectiveSource, type TerritoryState } from "./model.js";

const endpoint = "/api/worker/territory-news?map=1";
const pin = z.object({
  title: z.string(), street: z.string(), civics: z.array(z.string()).max(12), precision: z.enum(["building","street","published","address","area"]),
  layers: z.array(z.enum(["mercato","opportunita","privati","notizie"])).optional(),
  zoneIds: z.array(z.string()).optional(),
  propertyId: z.uuid().optional(), price: z.number().nullable().optional(), source: z.string().nullable().optional(),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
});
type NewsPin = z.infer<typeof pin>;

export function newsCivic(raw: string): string | null {
  return addressIdentity(`VIA ${raw}`)?.civic ?? null;
}

export function matchNewsPins(pins: NewsPin[], state: Readonly<TerritoryState>) {
  const streets = new Map<string, Set<string>>();
  for (const street of state.streets) {
    if (street.linkedOfficialId || street.outsideUrbanArea || street.needsReview || street.catalogKind === "network") continue;
    for (const name of [street.name, street.sisterName, state.memories[street.id]?.sisterSearch?.resultName]) {
      if (!name) continue;
      const key = normalizeSisterStreet(name);
      let matches = streets.get(key);
      if (!matches) streets.set(key, matches = new Set());
      matches.add(street.id);
    }
  }
  const canonical = new Map(state.streets.map(street => [street.id, street.linkedOfficialId ?? street.id]));
  const quarantined = new Set(Object.values(state.quarantine ?? {}).filter(issue => !issue.resolvedAt).map(issue => issue.unitKey));
  const units = new Map<string, number>();
  for (const unit of Object.values(state.units)) {
    if (quarantined.has(unit.key)) continue;
    const civic = addressIdentity(effectiveSource(unit).fullAddress)?.civic;
    if (!civic || civic === "NC") continue;
    for (const id of new Set(unit.streetIds.map(value => canonical.get(value) ?? value))) {
      const key = `${id}|${civic}`;
      units.set(key, (units.get(key) ?? 0) + 1);
    }
  }
  return pins.map(news => {
    const candidates = streets.get(normalizeSisterStreet(news.street));
    const streetId = candidates?.size === 1 ? [...candidates][0]! : null;
    const matches = news.civics.map(value => {
      const civic = newsCivic(value);
      return { civic: value, count: streetId && civic ? units.get(`${streetId}|${civic}`) ?? 0 : 0 };
    });
    return { ...news, streetId, matches };
  });
}

export async function fetchWorkerNews(key: string) {
  const time = Date.now().toString();
  const response = await fetch(`https://listing-radar-mu.vercel.app${endpoint}`, {
    redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { "X-Worker-Time": time, "X-Worker-Signature": openTabSignature(key, time, endpoint) },
  });
  if (!response.ok) throw new Error("Pin delle zone non disponibili.");
  return z.object({ pins: z.array(pin).max(10000) }).parse(await response.json()).pins;
}
