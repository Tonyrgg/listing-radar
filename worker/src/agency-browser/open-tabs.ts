import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { portalBlock } from "./browse.js";
import { OPEN_TAB_BATCH_BYTES, OPEN_TAB_LIMIT, OPEN_TAB_MAX_BYTES, openTabIdentity, openTabSignature, openTabSource,
  type OpenTabCapture, type OpenTabOutcome } from "./open-tab-contract.js";

export type OpenTabProgress = { total: number; processed: number; results: OpenTabOutcome[]; running: boolean; message?: string };

type ChromeTarget = { type?: string; url?: string; webSocketDebuggerUrl?: string };
type TabReading = { url: string; top: string; ready: boolean; html?: string; fields?: Record<string, unknown> };

async function listTabs(address: URL, signal: AbortSignal): Promise<ChromeTarget[]> {
  try {
    const response = await fetch(new URL("/json/list", address), {
      cache: "no-store", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
    });
    if (!response.ok) throw new Error();
    const targets: unknown = await response.json();
    if (!Array.isArray(targets)) throw new Error();
    return targets;
  } catch {
    signal.throwIfAborted();
    throw new Error("Chrome di lavoro non raggiungibile. Usa «Apri Chrome di lavoro» e verifica che gli annunci siano in quella finestra.");
  }
}

// Connect only to the selected open target. Never activate, navigate, or reload it.
async function evaluateTab(address: URL, target: ChromeTarget, expression: string, signal: AbortSignal) {
  const path = target.webSocketDebuggerUrl && URL.canParse(target.webSocketDebuggerUrl)
    ? new URL(target.webSocketDebuggerUrl).pathname : "";
  if (!/^\/devtools\/page\/[a-z0-9_-]+$/i.test(path)) throw new Error("Scheda non accessibile in questa finestra.");
  const targetUrl = new URL(path, address.origin);
  targetUrl.protocol = "ws:";
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
  deadline.throwIfAborted();
  const socket = new WebSocket(targetUrl);
  const message = "Scheda sospesa, chiusa o caricata solo in parte. Aprila nel Chrome di lavoro e riprova.";
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<TabReading>((resolve, reject) => {
      const fail = () => reject(new Error(message));
      onAbort = fail;
      deadline.addEventListener("abort", fail, { once: true });
      socket.addEventListener("error", fail, { once: true });
      socket.addEventListener("close", fail, { once: true });
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
      }, { once: true });
      socket.addEventListener("message", event => {
        try {
          const reply = JSON.parse(event.data);
          if (reply.id !== 1) return;
          const reading = reply.result?.result?.value;
          if (!reading || typeof reading.url !== "string" || typeof reading.top !== "string") return fail();
          resolve(reading);
        } catch { fail(); }
      });
    });
  } finally {
    if (onAbort) deadline.removeEventListener("abort", onAbort);
    socket.close();
  }
}

async function readTab(address: URL, target: ChromeTarget, tab: NonNullable<ReturnType<typeof openTabSource>>,
  parser: string | undefined, signal: AbortSignal): Promise<OpenTabCapture> {
  const expression = `(() => {
    const heading = document.querySelector("h1")?.innerText || "";
    const visible = document.body?.innerText || "";
    const top = [document.title, heading, visible.length < 1600 ? visible : ""].join(" ");
    const state = document.readyState;
    if (state === "loading" || !heading || !visible.trim()) return { url: location.href, top, ready: false };
    ${parser ? `const capture = (() => { ${parser}; return globalThis.ListingRadarPortalParser.extract(); })();
      const names = ["canonicalUrl","title","description","price","sqm","rooms","floor","zone","addressRaw","latitude","longitude","portalDeclaredDate","metadataDatePublished","metadataDateModified","portalSortDate","sellerType","sellerName","transaction","imageUrls"];
      const fields = Object.fromEntries(names.map(name => [name, capture[name]]));
      return { url: location.href, top, ready: true, fields };` : `const doc = document.documentElement.cloneNode(true);
      doc.querySelectorAll("form,input,textarea,select,iframe,script:not([type='application/ld+json']),style").forEach(node => node.remove());
      return { url: location.href, top, ready: true, html: doc.outerHTML };`}
  })()`;
  const observed = await evaluateTab(address, target, expression, signal);
  const current = openTabSource(observed.url);
  if (!current || openTabIdentity(current) !== openTabIdentity(tab)) throw new Error("L’indirizzo della scheda è cambiato durante la lettura.");
  if (portalBlock(200, observed.top)) throw new Error("Il portale mostra un blocco o una verifica.");
  if (!observed.ready) throw new Error("Dettaglio incompleto. Verifica che la scheda sia caricata.");
  const capture = { url: tab.url, capturedAt: new Date().toISOString(), html: observed.html, fields: observed.fields };
  if (Buffer.byteLength(JSON.stringify(capture)) > OPEN_TAB_MAX_BYTES) throw new Error("Scheda troppo grande per una lettura verificabile.");
  return capture;
}

async function upload(captures: OpenTabCapture[], endpoint: string, key: string, signal: AbortSignal): Promise<OpenTabOutcome[]> {
  const body = JSON.stringify({ captures });
  const timestamp = Date.now().toString();
  const response = await fetch(endpoint, { method:"POST", redirect:"error", body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(65_000)]),
    headers: { "Content-Type":"application/json", "X-Worker-Time":timestamp, "X-Worker-Signature":openTabSignature(key,timestamp,body) } });
  if (!response.ok) throw new Error(response.status === 401 ? "Autorizzazione Listing Radar non valida per questo Worker." : `Salvataggio non confermato da Listing Radar (HTTP ${response.status}).`);
  const payload = await response.json() as {results?: OpenTabOutcome[]};
  if (!Array.isArray(payload.results) || payload.results.length !== captures.length || payload.results.some((item,index) =>
    item.url !== captures[index]?.url || !["new","updated","unchanged","review","skipped","error"].includes(item.state))) {
    throw new Error("Risposta di salvataggio incompleta. Puoi ripetere l’acquisizione.");
  }
  return payload.results;
}

export async function acquireOpenTabs(
  input: { cdpUrl: string; endpoint: string; key: () => string; parserDirectory: string; signal: AbortSignal },
  send: (progress: OpenTabProgress) => void,
) {
  const { signal } = input;
  if (!URL.canParse(input.cdpUrl)) throw new Error("Indirizzo del Chrome di lavoro non valido.");
  const address = new URL(input.cdpUrl);
  if (address.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(address.hostname)
    || !address.port || address.pathname !== "/" || address.search || address.hash || address.username || address.password) {
    throw new Error("Indirizzo del Chrome di lavoro non valido.");
  }
  const targets = (await listTabs(address, signal)).filter(target => target?.type === "page");
  const tabs = targets.flatMap(target => {
    const detail = typeof target.url === "string" ? openTabSource(target.url) : null;
    return detail ? [{ target, detail }] : [];
  });
  if (tabs.length > OPEN_TAB_LIMIT) throw new Error(`Trovate ${tabs.length} schede. L’acquisizione ne gestisce fino a ${OPEN_TAB_LIMIT} per volta.`);
  const results: OpenTabOutcome[] = [];
  const emit = (running: boolean, message?: string) => send({
    total: tabs.length, processed: results.length, results: [...results], running, message,
  });
  if (!tabs.length) {
    emit(false, targets.length
      ? `Chrome collegato. Nessun dettaglio annuncio riconosciuto tra ${targets.length} schede aperte. Apri i singoli annunci.`
      : "Chrome collegato. Nessuna scheda aperta nel Chrome di lavoro.");
    return;
  }

  emit(true, `Chrome collegato. Trovati ${tabs.length} dettagli da leggere.`);
  const parsers = new Map<string, string>();
  const seen = new Set<string>();
  let batch: OpenTabCapture[] = [];
  let batchBytes = 0;
  let failedSave = false;
  let key: string | undefined;

  async function flush() {
    if (!batch.length) return;
    emit(true, `Salvataggio di ${batch.length} schede in Listing Radar…`);
    try {
      key ??= input.key();
      results.push(...await upload(batch, input.endpoint, key, signal));
    } catch (error) {
      failedSave = true;
      const message = signal.aborted ? "Salvataggio interrotto, esito da verificare."
        : error instanceof Error ? error.message : "Salvataggio non confermato.";
      results.push(...batch.map(capture => ({ url: capture.url, state: "error" as const, message })));
    }
    batch = [];
    batchBytes = 0;
  }

  for (const [index, { target, detail }] of tabs.entries()) {
    if (signal.aborted || failedSave) break;
    const { source, url } = detail;
    emit(true, `Lettura ${index + 1}/${tabs.length} · ${source.label}…`);
    const identity = openTabIdentity(detail);
    if (seen.has(identity)) {
      results.push({ url, state: "skipped", message: "Scheda duplicata nel batch." });
      continue;
    }
    try {
      let parser = parsers.get(source.id);
      if (source.portal && !parser) {
        const files = await Promise.all(["generic", "shared", source.id, "portals"].map(
          name => readFile(join(input.parserDirectory, name + ".js"), "utf8"),
        ));
        parser = files.join(";\n");
        parsers.set(source.id, parser);
      }
      const capture = await readTab(address, target, detail, parser, signal);
      if (signal.aborted) break;
      const size = Buffer.byteLength(JSON.stringify(capture)) + 1;
      if (batch.length >= 6 || batchBytes + size > OPEN_TAB_BATCH_BYTES - 32) await flush();
      if (failedSave || signal.aborted) break;
      batch.push(capture);
      batchBytes += size;
      seen.add(identity);
    } catch (error) {
      if (signal.aborted) break;
      results.push({ url, state: "review", message: error instanceof Error ? error.message.split("\n")[0] : "Scheda illeggibile." });
    }
  }
  if (!signal.aborted && !failedSave) await flush();
  const saveError = results.find(item => item.state === "error")?.message;
  emit(false, signal.aborted ? "Acquisizione interrotta. Puoi ripeterla."
    : failedSave ? saveError ?? "Salvataggio non confermato." : "Acquisizione terminata.");
}
