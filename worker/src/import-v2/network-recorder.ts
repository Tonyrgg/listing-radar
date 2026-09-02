import type { Page, Request, Response } from "playwright";

export type NetworkContractObservation = {
  operation: string;
  method: string;
  origin: string;
  pathname: string;
  queryKeys: string[];
  requestShape: unknown;
  status: number | null;
  responseContentType: string | null;
};

function sanitizedPathname(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => segment.length >= 12 && /^[A-Za-z0-9_-]+$/.test(segment) && /\d/.test(segment) ? ":id" : segment)
    .join("/");
}

function valueShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [valueShape(value[0])] : [];
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, valueShape(nested)]));
  }
  if (value === null) return "null";
  return typeof value;
}

function requestShape(request: Request): unknown {
  const raw = request.postData();
  if (!raw) return null;
  try {
    return valueShape(JSON.parse(raw));
  } catch {
    const form = new URLSearchParams(raw);
    return [...new Set([...form.keys()])].sort();
  }
}

/** Records endpoint structure only: never cookies, headers, bodies or values. */
export class TecnocloudNetworkRecorder {
  private operation: string | null = null;
  private readonly pending = new Map<Request, NetworkContractObservation>();
  private readonly observations: NetworkContractObservation[] = [];

  constructor(private readonly page: Page) {}

  attach(): void {
    this.page.on("request", this.onRequest);
    this.page.on("response", this.onResponse);
  }

  detach(): void {
    this.page.off("request", this.onRequest);
    this.page.off("response", this.onResponse);
    this.operation = null;
    this.pending.clear();
  }

  start(operation: string): void {
    this.operation = operation;
  }

  stop(): NetworkContractObservation[] {
    this.operation = null;
    return this.observations.splice(0);
  }

  private readonly onRequest = (request: Request) => {
    if (!this.operation || !["fetch", "xhr"].includes(request.resourceType())) return;
    const url = new URL(request.url());
    this.pending.set(request, {
      operation: this.operation,
      method: request.method(),
      origin: url.origin,
      pathname: sanitizedPathname(url.pathname),
      queryKeys: [...new Set([...url.searchParams.keys()])].sort(),
      requestShape: requestShape(request),
      status: null,
      responseContentType: null,
    });
  };

  private readonly onResponse = (response: Response) => {
    const observation = this.pending.get(response.request());
    if (!observation) return;
    this.pending.delete(response.request());
    observation.status = response.status();
    observation.responseContentType = response.headers()["content-type"]?.split(";")[0] ?? null;
    this.observations.push(observation);
  };
}
