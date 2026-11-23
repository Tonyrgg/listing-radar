import { createHmac } from "node:crypto";
import { agencyHost, browserSources, detailLink, localAgencyUrl } from "./sources.js";

export const OPEN_TAB_LIMIT = 200;
export const OPEN_TAB_MAX_BYTES = 650_000;
export const OPEN_TAB_BATCH_BYTES = 1_800_000;

export type OpenTabCapture = { url: string; capturedAt: string; html?: string; fields?: Record<string, unknown> };
export type OpenTabOutcome = { url: string; state: "new" | "updated" | "unchanged" | "review" | "skipped" | "error"; message?: string };

export function openTabSource(raw: string) {
  for (const source of [...browserSources.filter(item => item.portal), ...browserSources.filter(item => !item.portal)]) {
    const parsed = localAgencyUrl(raw, source.catalog, source);
    if (!parsed || agencyHost(parsed) !== agencyHost(new URL(source.catalog))) continue;
    if(source.detailQuery){
      const identity=[...parsed.searchParams].find(([key])=>key.toLowerCase()===source.detailQuery)?.[1];
      parsed.search="";
      if(identity)parsed.searchParams.set(source.detailQuery,identity);
    }
    const url = detailLink(parsed, source);
    if (url) return { source, url };
  }
  return null;
}

export function openTabSignature(key: string, timestamp: string, body: string) {
  const purposeKey = createHmac("sha256", key).update("listing-radar:worker:open-tabs:v1").digest();
  return createHmac("sha256", purposeKey).update(timestamp).update("\n").update(body).digest("hex");
}
