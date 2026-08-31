import type { Page } from "playwright";

import { logger, sanitizeSensitiveText } from "../logger.js";

const EXPIRED_PATTERN = /sessione\s+(?:e\s+)?scaduta|errorfiltrosessionescaduta|iampe\.agenziaentrate\.gov\.it\/sam\/ui\/login|name=["']?(?:username|password)/i;
const AUTHENTICATED_PATTERN = /\/Visure\/SceltaLink\.do|Riepilogo\s+Visure|Area\s+riservata\s+SISTER/i;

export type SisterKeepAliveResult = {
  ok: boolean;
  sessionExpired: boolean;
  status: number | null;
  checkedAt: string;
  message: string;
};

export function resolveSisterKeepAliveUrl(pageUrl: string, configuredUrl?: string): string {
  if (configuredUrl) return configuredUrl;
  return new URL("/Visure/", pageUrl).toString();
}

export function nextKeepAliveDelay(minSeconds: number, maxSeconds: number, random = Math.random): number {
  const min = Math.min(minSeconds, maxSeconds);
  const max = Math.max(minSeconds, maxSeconds);
  return Math.round((min + (max - min) * random()) * 1_000);
}

export async function pingSisterSession(page: Page, configuredUrl?: string): Promise<SisterKeepAliveResult> {
  const checkedAt = new Date().toISOString();
  const url = resolveSisterKeepAliveUrl(page.url(), configuredUrl);
  let response;

  try {
    response = await page.context().request.get(url, {
      failOnStatusCode: false,
      maxRedirects: 0,
      timeout: 15_000,
    });
    const location = response.headers().location ?? "";
    const body = response.status() === 200 ? await response.text() : "";
    const cookieNames = new Set((await page.context().cookies(url)).map((cookie) => cookie.name));
    const authenticatedResponse = Boolean(configuredUrl)
      || (AUTHENTICATED_PATTERN.test(body) && cookieNames.has("JSESSIONID"));
    const sessionExpired = EXPIRED_PATTERN.test(`${location}\n${body}`)
      || (response.status() === 200 && !authenticatedResponse);
    const ok = response.status() >= 200 && response.status() < 400 && !sessionExpired;
    const result = {
      ok,
      sessionExpired,
      status: response.status(),
      checkedAt,
      message: sessionExpired
        ? "La sessione SISTER risulta scaduta: accedi di nuovo manualmente"
        : ok
          ? "Sessione SISTER mantenuta attiva"
          : `SISTER ha risposto con HTTP ${response.status()}`,
    };
    logger[ok ? "debug" : "warn"]({ status: result.status, sessionExpired }, result.message);
    return result;
  } catch (error) {
    const message = sanitizeSensitiveText(error instanceof Error ? error.message : String(error));
    logger.warn({ err: { name: "SisterKeepAliveError", message } }, "Keep-alive SISTER non riuscito");
    return { ok: false, sessionExpired: false, status: null, checkedAt, message: `Keep-alive SISTER non riuscito: ${message}` };
  } finally {
    await response?.dispose().catch(() => undefined);
  }
}

export class SisterKeepAliveScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private running = false;

  constructor(
    private readonly page: Page,
    private readonly options: {
      enabled: boolean;
      minSeconds: number;
      maxSeconds: number;
      url?: string;
      onResult?: (result: SisterKeepAliveResult) => void | Promise<void>;
    },
  ) {}

  start() {
    if (!this.options.enabled || !this.stopped) return;
    this.stopped = false;
    this.schedule();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    if (this.stopped) return;
    const delay = nextKeepAliveDelay(this.options.minSeconds, this.options.maxSeconds);
    this.timer = setTimeout(() => void this.run(), delay);
    this.timer.unref?.();
  }

  private async run() {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      const result = await pingSisterSession(this.page, this.options.url);
      await this.options.onResult?.(result);
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}
