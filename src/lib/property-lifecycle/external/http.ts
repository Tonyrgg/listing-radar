import { EXTERNAL_POLICY } from "./policy";

export class SourceAccessError extends Error {
  constructor(public readonly reason: string, public readonly status: number | null = null, public readonly retryAfterMs = 0) { super(reason); }
}

// One source client is shared for a job. No cookies, proxy rotation, browser fingerprint manipulation or hidden APIs.
export class ExternalPublicHttp {
  private nextAt = 0;
  private circuitOpen = false;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly fetcher: typeof fetch = fetch,
    private readonly sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
    private readonly now = () => Date.now()) {}

  async get(url: string, allowedHost: string): Promise<{ body: string; status: number; url: string }> {
    const preceding = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await preceding;
    try { return await this.request(url, allowedHost); }
    finally { release(); }
  }

  private async request(url: string, allowedHost: string): Promise<{ body: string; status: number; url: string }> {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.port || target.username || target.password ||
      target.hostname.replace(/^www\./, "") !== allowedHost ||
      /^\/(?:api-nuxt|rest\/realEstate|ws|pub|portale|area-riservata)(?:\/|$)/.test(target.pathname)) throw new SourceAccessError("unapproved_source_url");
    if (this.circuitOpen) throw new SourceAccessError("source_circuit_open");
    for (let attempt = 0; attempt <= EXTERNAL_POLICY.http.retries; attempt++) {
      await this.sleep(Math.max(0, this.nextAt - this.now()));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), EXTERNAL_POLICY.http.timeoutMs);
      try {
        const response = await this.fetcher(url, { signal: controller.signal, redirect: "manual",
          headers: { "user-agent": "ListingRadarMarketObserver/2.0 (public evidence)", accept: "text/html" } });
        this.nextAt = this.now() + EXTERNAL_POLICY.http.delayMs;
        if (response.status === 403 || response.status === 401) { await response.body?.cancel(); this.circuitOpen = true; throw new SourceAccessError("access_blocked", response.status); }
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel();
          const header = response.headers.get("retry-after");
          const retryAt = header && /^\d+$/.test(header) ? this.now() + Number(header) * 1000 : header ? Date.parse(header) : 0;
          const retryAfterMs=Number.isFinite(retryAt) ? Math.max(0,retryAt-this.now()) : 0;
          if (attempt === EXTERNAL_POLICY.http.retries) { this.circuitOpen = true; throw new SourceAccessError("source_unavailable", response.status,retryAfterMs); }
          // Long Retry-After belongs to the leased queue retry, not a sleeping worker.
          if (retryAfterMs > 60_000) { this.circuitOpen = true; throw new SourceAccessError("retry_after_requires_job_retry", response.status,retryAfterMs); }
          this.nextAt = Math.max(this.nextAt, Number.isFinite(retryAt) ? retryAt : 0, this.now() + EXTERNAL_POLICY.http.delayMs * 2 ** attempt);
          continue;
        }
        if (!response.ok) { await response.body?.cancel(); throw new SourceAccessError("not_a_positive_observation", response.status); }
        if (!response.headers.get("content-type")?.includes("text/html")) { await response.body?.cancel(); throw new SourceAccessError("unexpected_content_type", response.status); }
        const reader = response.body?.getReader();
        if (!reader) throw new SourceAccessError("empty_response", response.status);
        const chunks: Uint8Array[] = []; let length = 0;
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > EXTERNAL_POLICY.http.maxBodyBytes) { await reader.cancel(); throw new SourceAccessError("body_too_large", response.status); }
          chunks.push(chunk.value);
        }
        const body = Buffer.concat(chunks).toString("utf8");
        if (/cf-chl-|captcha|Attention Required|access denied/i.test(body)) { this.circuitOpen = true; throw new SourceAccessError("challenge_page", response.status); }
        return { body, status: response.status, url };
      } catch (error) {
        if (error instanceof SourceAccessError || attempt === EXTERNAL_POLICY.http.retries) throw error;
        this.nextAt = this.now() + EXTERNAL_POLICY.http.delayMs * 2 ** attempt;
      } finally { clearTimeout(timeout); }
    }
    throw new SourceAccessError("retry_exhausted");
  }
}
