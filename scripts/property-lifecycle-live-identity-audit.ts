import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { inspectImage } from "../src/lib/image/inspection";
import {
  scoreIdentityCandidate,
  type IdentityObservation,
} from "../src/lib/property-lifecycle/identity/scoring";

interface LiveRecord {
  type: "LIVE_RECORD";
  key: string;
  externalId: string;
  reference: string | null;
  url: string;
  title: string;
  description: string | null;
  price: number | null;
  surfaceSqm: number | null;
  rooms: number | null;
  floor: string | null;
  propertyType: string | null;
  location: {
    rawText: string | null;
    locality: string | null;
    streetName: string | null;
    streetNumber: string | null;
    latitude: number | null;
    longitude: number | null;
    precision: string;
  };
  marketStart: { upperBound: string };
  assetUrls: string[];
}

const ARTIFACTS: Record<string, string> = {
  iconacasa: "listing-radar-live-fixed-iconacasa.jsonl",
  vistocasa: "listing-radar-live-fixed-vistocasa.jsonl",
  studisanti: "listing-radar-live-full-studisanti.jsonl",
  admaiora: "listing-radar-live-full-admaiora.jsonl",
  studiocasa: "listing-radar-live-final-studiocasa.jsonl",
  futura: "listing-radar-live-full-futura.jsonl",
  garofalo: "listing-radar-live-full-garofalo.jsonl",
  trio: "listing-radar-live-full-trio.jsonl",
  puntocasa: "listing-radar-puntocasa-live-fixed.jsonl",
  momento: "listing-radar-live-full-momento.jsonl",
};

function records(): LiveRecord[] {
  return Object.entries(ARTIFACTS).flatMap(([key, filename]) =>
    (() => {
      const bytes = readFileSync(join(tmpdir(), filename));
      return bytes[0] === 0xff && bytes[1] === 0xfe
        ? bytes.subarray(2).toString("utf16le")
        : bytes.toString("utf8").replace(/^\uFEFF/, "");
    })()
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const value = JSON.parse(line) as LiveRecord;
          return value.type === "LIVE_RECORD" ? [{ ...value, key }] : [];
        } catch {
          return [];
        }
      }),
  );
}

function address(record: LiveRecord): string | null {
  return record.location.streetName
    ? [record.location.streetName, record.location.streetNumber].filter(Boolean).join(" ")
    : record.location.rawText;
}

function assetUrls(record: LiveRecord): { image: string | null; floorplan: string | null } {
  const floorplan = record.assetUrls.find((url) => /planimetr|piantina|floor.?plan|pianta[-_.]/i.test(url)) ?? null;
  const image = record.assetUrls.find(
    (url) => url !== floorplan && !/vendut|sold/i.test(new URL(url).pathname),
  ) ?? null;
  return { image, floorplan };
}

async function fingerprint(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "ListingRadarLifecycle/2.0 (+identity audit)" },
    });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 15 * 1024 * 1024) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 15 * 1024 * 1024) return null;
    return `DHASH64:${(await inspectImage(bytes)).perceptualHash}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(values[index]!);
    }
  }));
  return results;
}

function normalizedTokens(value: string | null): Set<string> {
  return new Set((value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter((token) => token.length > 2));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return Number((intersection / new Set([...left, ...right]).size).toFixed(4));
}

function relativeSimilarity(left: number | null, right: number | null, tolerance: number): number | null {
  if (left == null || right == null) return null;
  return Number(Math.max(0, 1 - Math.abs(left - right) / Math.max(left, right, 1) / tolerance).toFixed(4));
}

function exactSimilarity(left: string | null, right: string | null): number | null {
  if (!left || !right) return null;
  return left.localeCompare(right, "it", { sensitivity: "base" }) === 0 ? 1 : 0;
}

function temporalSimilarity(left: string, right: string): number {
  const days = Math.abs(new Date(left).getTime() - new Date(right).getTime()) / 86_400_000;
  return Number(Math.max(0, 1 - days / 730).toFixed(4));
}

function dHashSimilarity(left: string, right: string): number {
  const leftValue = left.split(":", 2)[1];
  const rightValue = right.split(":", 2)[1];
  if (!leftValue || !rightValue || leftValue.length !== rightValue.length) return 0;
  let differences = 0;
  for (let index = 0; index < leftValue.length; index += 1) {
    if (leftValue[index] !== rightValue[index]) differences += 1;
  }
  return Number((1 - differences / leftValue.length).toFixed(4));
}

function maximumSimilarity(left: string[], right: string[]): number | null {
  if (!left.length || !right.length) return null;
  return Math.max(...left.flatMap((leftHash) => right.map((rightHash) => dHashSimilarity(leftHash, rightHash))));
}

async function main(): Promise<void> {
  const liveRecords = records();
  const urls = [...new Set(liveRecords.flatMap((record) => {
    const assets = assetUrls(record);
    return [assets.image, assets.floorplan].filter((value): value is string => Boolean(value));
  }))];
  const hashes = new Map<string, string | null>();
  const downloaded = await mapConcurrent(urls, 6, async (url) => ({ url, hash: await fingerprint(url) }));
  downloaded.forEach(({ url, hash }) => hashes.set(url, hash));

  const observations = new Map<LiveRecord, IdentityObservation>();
  for (const record of liveRecords) {
    const assets = assetUrls(record);
    const imageHash = assets.image ? hashes.get(assets.image) : null;
    const floorplanHash = assets.floorplan ? hashes.get(assets.floorplan) : null;
    observations.set(record, {
      agencyReference: record.reference,
      address: address(record),
      locality: record.location.locality,
      propertyType: record.propertyType,
      surfaceSqm: record.surfaceSqm,
      rooms: record.rooms,
      imageFingerprints: imageHash ? [imageHash] : [],
      floorplanFingerprints: floorplanHash ? [floorplanHash] : [],
    });
  }

  const pairs: Array<Record<string, unknown> & { finalScore: number; imageScore: number | null }> = [];
  for (let leftIndex = 0; leftIndex < liveRecords.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < liveRecords.length; rightIndex += 1) {
      const left = liveRecords[leftIndex]!;
      const right = liveRecords[rightIndex]!;
      if (left.key === right.key) continue;
      const leftObservation = observations.get(left)!;
      const rightObservation = observations.get(right)!;
      const scored = scoreIdentityCandidate(leftObservation, {
        ...rightObservation,
        propertyId: `${right.key}:${right.externalId}`,
        knownAgencyReferences: [],
      });
      if (scored.score < 0.55) continue;
      pairs.push({
        propertyCandidate: `${left.key}:${left.externalId} <> ${right.key}:${right.externalId}`,
        agencyA: left.key,
        externalIdA: left.externalId,
        urlA: left.url,
        agencyB: right.key,
        externalIdB: right.externalId,
        urlB: right.url,
        localityA: left.location.locality,
        localityB: right.location.locality,
        addressA: address(left),
        addressB: address(right),
        surfaceA: left.surfaceSqm,
        surfaceB: right.surfaceSqm,
        roomsA: left.rooms,
        roomsB: right.rooms,
        floorA: left.floor,
        floorB: right.floor,
        priceA: left.price,
        priceB: right.price,
        locationScore: scored.features.locality.available ? scored.features.locality.value : null,
        addressScore: scored.features.address.available ? scored.features.address.value : null,
        sqmScore: scored.features.surface.available ? scored.features.surface.value : null,
        roomsScore: scored.features.rooms.available ? scored.features.rooms.value : null,
        floorScore: exactSimilarity(left.floor, right.floor),
        priceCompatibility: relativeSimilarity(left.price, right.price, 0.25),
        imageScore: scored.features.image.available ? scored.features.image.value : null,
        floorplanScore: scored.features.floorplan.available ? scored.features.floorplan.value : null,
        textScore: jaccard(
          normalizedTokens(`${left.title} ${left.description ?? ""}`),
          normalizedTokens(`${right.title} ${right.description ?? ""}`),
        ),
        temporalScore: temporalSimilarity(left.marketStart.upperBound, right.marketStart.upperBound),
        finalScore: scored.score,
        contradictions: scored.contradictions,
      });
    }
  }
  pairs.sort((left, right) => right.finalScore - left.finalScore || (right.imageScore ?? -1) - (left.imageScore ?? -1));
  const top = pairs.slice(0, 20);
  const recordByKey = new Map(liveRecords.map((record) => [`${record.key}:${record.externalId}`, record]));
  const deepTop = top.slice(0, 10);
  const deepUrls = [...new Set(deepTop.flatMap((pair) => {
    const left = recordByKey.get(`${pair.agencyA}:${pair.externalIdA}`);
    const right = recordByKey.get(`${pair.agencyB}:${pair.externalIdB}`);
    return [...(left?.assetUrls ?? []), ...(right?.assetUrls ?? [])]
      .filter((url) => !/vendut|sold/i.test(new URL(url).pathname));
  }))];
  const missingDeepUrls = deepUrls.filter((url) => !hashes.has(url));
  const deepDownloaded = await mapConcurrent(
    missingDeepUrls,
    6,
    async (url) => ({ url, hash: await fingerprint(url) }),
  );
  deepDownloaded.forEach(({ url, hash }) => hashes.set(url, hash));
  for (const pair of deepTop) {
    const left = recordByKey.get(`${pair.agencyA}:${pair.externalIdA}`)!;
    const right = recordByKey.get(`${pair.agencyB}:${pair.externalIdB}`)!;
    const splitHashes = (record: LiveRecord, floorplan: boolean) => record.assetUrls
      .filter((url) => {
        const isFloorplan = /planimetr|piantina|floor.?plan|pianta[-_.]/i.test(url);
        return isFloorplan === floorplan && !/vendut|sold/i.test(new URL(url).pathname);
      })
      .map((url) => hashes.get(url))
      .filter((hash): hash is string => Boolean(hash));
    pair.deepImageScore = maximumSimilarity(splitHashes(left, false), splitHashes(right, false));
    pair.deepFloorplanScore = maximumSimilarity(splitHashes(left, true), splitHashes(right, true));
    pair.deepAssetsCompared = {
      leftImages: splitHashes(left, false).length,
      rightImages: splitHashes(right, false).length,
      leftFloorplans: splitHashes(left, true).length,
      rightFloorplans: splitHashes(right, true).length,
    };
  }
  const highScoringNonMatches = pairs
    .filter((pair) => pair.finalScore >= 0.75 && (pair.imageScore == null || pair.imageScore < 0.7))
    .slice(0, 10);
  const strongMediaPairs = pairs
    .filter((pair) => (pair.imageScore ?? 0) >= 0.8 || Number(pair.floorplanScore ?? 0) >= 0.8)
    .sort((left, right) =>
      Math.max(right.imageScore ?? 0, Number(right.floorplanScore ?? 0)) -
      Math.max(left.imageScore ?? 0, Number(left.floorplanScore ?? 0)),
    );

  console.info(JSON.stringify({
    generatedAt: new Date().toISOString(),
    liveRecordCount: liveRecords.length,
    assetUrlsAttempted: urls.length,
    assetFingerprintsProduced: [...hashes.values()].filter(Boolean).length,
    deepAssetUrlsAttempted: deepUrls.length,
    crossAgencyPairsAbove055: pairs.length,
    top,
    highScoringNonMatches,
    strongMediaPairCount: strongMediaPairs.length,
    strongMediaPairs: strongMediaPairs.slice(0, 30),
  }));
}

void main();
