import { load, type CheerioAPI } from "cheerio";

export type HttpMethod = "GET" | "HEAD";

export interface HttpClientOptions {
  headers?: HeadersInit;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  minIntervalMs?: number;
}

export interface HttpRequestOptions extends HttpClientOptions {
  method?: HttpMethod;
}

export interface HttpResponse {
  body: string;
  headers: Headers;
  ok: boolean;
  status: number;
  url: string;
}

export class HttpRequestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HttpRequestError";
  }
}

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429]);

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shouldRetry(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status) || status >= 500;
}

export class HttpClient {
  private lastRequestAt = 0;

  constructor(private readonly defaults: HttpClientOptions = {}) {}

  async request(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    const method = options.method ?? "GET";
    const timeoutMs = options.timeoutMs ?? this.defaults.timeoutMs ?? 10_000;
    const retries = Math.max(0, options.retries ?? this.defaults.retries ?? 2);
    const retryDelayMs = options.retryDelayMs ?? this.defaults.retryDelayMs ?? 250;
    const minIntervalMs = options.minIntervalMs ?? this.defaults.minIntervalMs ?? 0;
    const headers = options.headers ?? this.defaults.headers;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const elapsed = Date.now() - this.lastRequestAt;
      if (elapsed < minIntervalMs) {
        await wait(minIntervalMs - elapsed);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      this.lastRequestAt = Date.now();

      try {
        const response = await fetch(url, { method, headers, signal: controller.signal });
        const body = method === "HEAD" ? "" : await response.text();

        if (shouldRetry(response.status) && attempt < retries) {
          await wait(retryDelayMs * (attempt + 1));
          continue;
        }

        return {
          body,
          headers: response.headers,
          ok: response.ok,
          status: response.status,
          url: response.url || url,
        };
      } catch (error) {
        if (attempt >= retries) {
          const message = error instanceof Error ? error.message : String(error);
          const timedOut = controller.signal.aborted;
          throw new HttpRequestError(
            timedOut
              ? `${method} ${url} timed out after ${timeoutMs}ms`
              : `${method} ${url} failed: ${message}`,
            { cause: error },
          );
        }

        await wait(retryDelayMs * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new HttpRequestError(`${method} ${url} failed without a response`);
  }

  get(url: string, options: Omit<HttpRequestOptions, "method"> = {}): Promise<HttpResponse> {
    return this.request(url, { ...options, method: "GET" });
  }

  head(url: string, options: Omit<HttpRequestOptions, "method"> = {}): Promise<HttpResponse> {
    return this.request(url, { ...options, method: "HEAD" });
  }
}

export function parseHtml(html: string): CheerioAPI {
  return load(html);
}

export function parseJson<T>(body: string): T {
  return JSON.parse(body) as T;
}
