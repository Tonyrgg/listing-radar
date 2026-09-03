import type { Page } from "playwright";

import { TecnocloudNetworkRecorder, type NetworkContractObservation } from "./network-recorder.js";

const CRM_ROOT = "/CRMImmobiliareLightning/s";
const SAFE_UI_LABELS = [
  "Annulla",
  "Catasto Denom Particella",
  "Catasto Foglio",
  "Catasto Particella",
  "Catasto Rendita",
  "Catasto Sezione Urbana",
  "Catasto Subalterno",
  "Cerca",
  "Cerca in questo elenco",
  "Cerca nell'elenco",
  "Codice Fiscale",
  "Cognome",
  "Comune di nascita",
  "Comproprietario",
  "Data di nascita",
  "E-mail",
  "E-mail secondaria",
  "Indirizzo Completo Immobile",
  "Interno",
  "Luogo di nascita",
  "Modifica",
  "Nome",
  "Note Catasto",
  "Note Private",
  "Nuovo",
  "Provincia di nascita",
  "Quota",
  "Salva",
  "Soggetti collegati",
  "Telefono",
  "Telefono 2",
  "Telefono 3",
  "Unisci",
  "Visualizza tutto",
] as const;

export type SanitizedRoute = {
  origin: string;
  pathname: string;
  queryKeys: string[];
};

export type TecnocloudUiSnapshot = {
  operation: string;
  route: SanitizedRoute;
  customElements: Array<{ tag: string; count: number }>;
  controls: Array<{
    tag: string;
    type: string | null;
    role: string | null;
    safeLabel: string | null;
    safeHint: string | null;
    attributes: string[];
  }>;
  links: Array<{ safeLabel: string | null; route: SanitizedRoute | null }>;
};

export type TecnocloudV2DiagnosticReport = {
  schemaVersion: 1;
  generatedAt: string;
  readOnly: true;
  privacy: {
    valuesCaptured: false;
    headersCaptured: false;
    cookiesCaptured: false;
  };
  snapshots: TecnocloudUiSnapshot[];
  network: NetworkContractObservation[];
};

function isLikelyOpaqueIdentifier(segment: string): boolean {
  return segment.length >= 12 && /^[A-Za-z0-9_-]+$/.test(segment) && /\d/.test(segment);
}

export function maskDiagnosticPathname(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => isLikelyOpaqueIdentifier(segment) ? ":id" : segment)
    .join("/");
}

export function sanitizeDiagnosticRoute(rawUrl: string, baseUrl?: string): SanitizedRoute {
  const url = new URL(rawUrl, baseUrl);
  return {
    origin: url.origin,
    pathname: maskDiagnosticPathname(url.pathname),
    queryKeys: [...new Set([...url.searchParams.keys()])].sort(),
  };
}

export function safeDiagnosticLabel(rawLabel: string | null | undefined): string | null {
  const normalized = rawLabel?.replace(/\s+/g, " ").trim().replace(/[.…]+$/g, "").trim().toLocaleLowerCase("it-IT");
  if (!normalized) return null;
  return SAFE_UI_LABELS.find((candidate) => {
    const safe = candidate.toLocaleLowerCase("it-IT");
    return normalized === safe || (candidate === "Soggetti collegati" && normalized.startsWith(`${safe} (`));
  }) ?? null;
}

export function safeDiagnosticHint(rawHint: string | null | undefined): string | null {
  const normalized = rawHint?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized || normalized.length > 120 || !/(cerca|search)/i.test(normalized)) return null;
  if (/@|\b[A-Z0-9]{16}\b|\b\d{5,}\b/i.test(normalized)) return null;
  return normalized;
}

type RawUiSnapshot = {
  customElements: Array<{ tag: string; count: number }>;
  controls: Array<{ tag: string; type: string | null; role: string | null; label: string | null; hint: string | null; attributes: string[] }>;
  links: Array<{ label: string | null; href: string | null }>;
};

async function waitForReadableDocument(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
  await page.locator("body").waitFor({ state: "attached", timeout: 10_000 });
}

async function rawUiSnapshot(page: Page): Promise<RawUiSnapshot> {
  /* Una stringa evita che il transpiler inserisca helper Node nella funzione
   * serializzata da Playwright e poi eseguita dentro Chrome. */
  return page.evaluate(`(() => {
    const safeAttributeNames = new Set([
      "aria-controls", "aria-expanded", "aria-haspopup", "aria-label", "aria-selected",
      "autocomplete", "checked", "class", "disabled", "href", "id", "name", "role", "type"
    ]);
    const roots = [document];
    const elements = [];
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      if (!root) continue;
      for (const element of Array.from(root.querySelectorAll("*"))) {
        elements.push(element);
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }
    const textFor = (element) => {
      const aria = element.getAttribute("aria-label");
      if (aria) return aria;
      const placeholder = element.getAttribute("placeholder");
      if (placeholder) return placeholder;
      if (element instanceof HTMLInputElement && element.labels && element.labels.length) {
        return Array.from(element.labels).map((label) => label.textContent || "").join(" ");
      }
      return element.textContent;
    };
    const attributeNames = (element) => Array.from(element.attributes)
      .map((attribute) => attribute.name.toLowerCase())
      .filter((name) => safeAttributeNames.has(name))
      .sort();
    const customCounts = new Map();
    for (const element of elements) {
      const tag = element.tagName.toLowerCase();
      if (tag.includes("-")) customCounts.set(tag, (customCounts.get(tag) || 0) + 1);
    }
    return {
      customElements: Array.from(customCounts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((left, right) => left.tag.localeCompare(right.tag)),
      controls: elements
        .filter((element) => element.matches("input, select, textarea, button, [role=button], [role=combobox], [role=searchbox]"))
        .slice(0, 500)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute("type"),
          role: element.getAttribute("role"),
          label: textFor(element),
          hint: element.getAttribute("placeholder"),
          attributes: attributeNames(element)
        })),
      links: elements
        .filter((element) => element instanceof HTMLAnchorElement)
        .slice(0, 500)
        .map((element) => ({ label: textFor(element), href: element.href || null }))
    };
  })()`) as Promise<RawUiSnapshot>;
}

async function captureSnapshot(page: Page, operation: string): Promise<TecnocloudUiSnapshot> {
  await waitForReadableDocument(page);
  const raw = await rawUiSnapshot(page);
  return {
    operation,
    route: sanitizeDiagnosticRoute(page.url()),
    customElements: raw.customElements,
    controls: raw.controls.map((control) => ({
      tag: control.tag,
      type: control.type,
      role: control.role,
      safeLabel: safeDiagnosticLabel(control.label),
      safeHint: safeDiagnosticHint(control.hint),
      attributes: control.attributes,
    })),
    links: raw.links.map((link) => {
      let route: SanitizedRoute | null = null;
      if (link.href) {
        const url = new URL(link.href, page.url());
        const current = new URL(page.url());
        if (["http:", "https:"].includes(url.protocol) && url.origin === current.origin) {
          route = sanitizeDiagnosticRoute(url.toString());
        }
      }
      return { safeLabel: safeDiagnosticLabel(link.label), route };
    }),
  };
}

function assertAuthenticated(page: Page): void {
  if (/(login|signin|accesso|autenticazione|logout-success|sessione[_-]?scaduta)/i.test(page.url())) {
    throw new Error("La sessione Tecnocloud non è autenticata");
  }
}

async function navigateReadOnly(page: Page, pathname: string): Promise<void> {
  const target = new URL(pathname, page.url()).toString();
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
  assertAuthenticated(page);
}

async function runSyntheticListSearch(page: Page): Promise<void> {
  const candidates = page.locator('input[type="text"][role="combobox"]').filter({ visible: true });
  await candidates.first().waitFor({ state: "visible", timeout: 15_000 });
  const count = await candidates.count();
  if (count !== 1) throw new Error(`Ricerca elenco non identificabile in modo univoco (${count} campi)`);
  const response = page.waitForResponse(
    (candidate) => ["xhr", "fetch"].includes(candidate.request().resourceType()),
    { timeout: 10_000 },
  ).catch(() => null);
  await candidates.first().fill("LRV2DIAGNOSTIC0");
  await candidates.first().press("Enter");
  await response;
}

/**
 * Inspects list pages only. It never submits a search, opens a record, clicks a
 * mutation control or reads form values/text belonging to people or properties.
 */
export async function runTecnocloudV2ReadOnlyDiagnostic(page: Page): Promise<TecnocloudV2DiagnosticReport> {
  assertAuthenticated(page);
  const originalUrl = page.url();
  const recorder = new TecnocloudNetworkRecorder(page);
  const snapshots: TecnocloudUiSnapshot[] = [];
  const network: NetworkContractObservation[] = [];
  recorder.attach();

  try {
    recorder.start("current_page_structure");
    snapshots.push(await captureSnapshot(page, "current_page_structure"));
    network.push(...recorder.stop());

    recorder.start("people_list_navigation");
    await navigateReadOnly(page, `${CRM_ROOT}/account/Account`);
    snapshots.push(await captureSnapshot(page, "people_list_navigation"));
    network.push(...recorder.stop());

    recorder.start("people_exact_cf_search_contract");
    await runSyntheticListSearch(page);
    snapshots.push(await captureSnapshot(page, "people_exact_cf_search_contract"));
    network.push(...recorder.stop());

    recorder.start("property_list_navigation");
    await navigateReadOnly(page, `${CRM_ROOT}/immobile/Immobile__c`);
    snapshots.push(await captureSnapshot(page, "property_list_navigation"));
    network.push(...recorder.stop());

    recorder.start("property_search_contract");
    await runSyntheticListSearch(page);
    snapshots.push(await captureSnapshot(page, "property_search_contract"));
    network.push(...recorder.stop());
  } finally {
    recorder.stop();
    recorder.detach();
    if (page.url() !== originalUrl) {
      await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    privacy: { valuesCaptured: false, headersCaptured: false, cookiesCaptured: false },
    snapshots,
    network,
  };
}
