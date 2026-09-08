import { chromium, type Page, type Request } from "playwright";

const endpoint = process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222";
const durationMs = Math.max(1_000, Number(process.argv[2] ?? 900_000));
const startedAt = Date.now();
const counts = new Map<string, number>();

function route(raw: string): string {
  try {
    const value = new URL(raw);
    const pathname = decodeURIComponent(value.pathname)
      .replace(/\b[A-Z0-9]{15}(?:[A-Z0-9]{3})?\b/gi, "[ID]")
      .replace(/\b[A-Z0-9]{16}\b/gi, "[CF]");
    return `${value.host}${pathname}`;
  } catch {
    return raw ? "[URL non leggibile]" : "[URL vuoto]";
  }
}

function emit(kind: string, details: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({
    atMs: Date.now() - startedAt,
    kind,
    ...details,
  })}\n`);
}

function portal(raw: string) {
  if (/sister\d*\.agenziaentrate\.gov\.it/i.test(raw)) return "SISTER";
  if (/tecnocasa-group\.my\.site\.com/i.test(raw)) return "CRM";
  return "ALTRO";
}

function recordDocument(request: Request) {
  if (request.resourceType() !== "document" || request.frame().parentFrame()) return;
  const page = request.frame().page();
  const key = `${portal(request.url())}|${request.method()}|${route(request.url())}`;
  const count = (counts.get(key) ?? 0) + 1;
  counts.set(key, count);
  emit("document", { portal: portal(request.url()), method: request.method(), route: route(request.url()), count, title: page.url() ? undefined : "frame-non-allineato" });
}

function observe(page: Page) {
  emit("page", { portal: portal(page.url()), route: route(page.url()) });
  page.on("request", recordDocument);
  page.on("framenavigated", (frame) => {
    if (!frame.parentFrame()) emit("navigated", { portal: portal(frame.url()), route: route(frame.url()) });
  });
  page.on("close", () => emit("page-closed", { portal: portal(page.url()), route: route(page.url()) }));
}

const browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
for (const context of browser.contexts()) {
  for (const page of context.pages()) observe(page);
  context.on("page", observe);
}

const heartbeat = setInterval(() => {
  emit("heartbeat", { counts: Object.fromEntries(counts) });
}, 30_000);

await new Promise((resolve) => setTimeout(resolve, durationMs));
clearInterval(heartbeat);
emit("summary", { counts: Object.fromEntries(counts) });
await browser.close().catch(() => undefined);
