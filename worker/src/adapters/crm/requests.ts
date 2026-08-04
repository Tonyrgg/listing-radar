import type { Page } from "playwright";

export type CrmRequestArchiveItem = {
  externalId: string;
  title: string;
  url: string;
  listFields: Record<string, string>;
};

export type CrmRequestDetail = {
  externalId: string;
  title: string;
  url: string;
  status: string | null;
  headerFields: Record<string, string | boolean | null>;
  fields: Record<string, string | boolean | null>;
  clientExternalId: string | null;
  relatedSections: Array<{ heading: string; text: string }>;
  evolutionText: string | null;
  capturedAt: string;
};

const requestLinkSelector = 'table tbody a[href*="/richiestaimmobiliare/"]';

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function requestId(url: string) {
  return url.match(/\/richiestaimmobiliare\/([^/?#]+)/i)?.[1] ?? "";
}

async function archiveSignature(page: Page) {
  return (await page.locator(requestLinkSelector).evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""))).join("\n");
}

async function waitForArchivePageToSettle(page: Page, previousSignature: string) {
  const deadline = Date.now() + 20_000;
  let lastSignature = "";
  let stableChecks = 0;
  while (Date.now() < deadline) {
    const current = await archiveSignature(page).catch(() => "");
    if (current && current !== previousSignature) {
      stableChecks = current === lastSignature ? stableChecks + 1 : 0;
      if (stableChecks >= 2) return;
      lastSignature = current;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("La pagina successiva dell’archivio richieste non ha terminato il caricamento");
}

export async function collectCrmRequestArchive(
  page: Page,
  options: { onPage?: (pageNumber: number, discovered: number) => void; isCancelled?: () => boolean } = {},
): Promise<CrmRequestArchiveItem[]> {
  await page.locator(requestLinkSelector).first().waitFor({ state: "visible", timeout: 30_000 });
  const first = page.locator('button:has(svg[data-key="jump_to_left"])').filter({ visible: true }).first();
  if (await first.count() && await first.isEnabled()) {
    const signature = await archiveSignature(page);
    await first.click();
    await waitForArchivePageToSettle(page, signature);
  }

  const results = new Map<string, CrmRequestArchiveItem>();
  let pageNumber = 0;
  for (;;) {
    if (options.isCancelled?.()) break;
    pageNumber += 1;
    const table = page.locator("table").filter({ has: page.locator('a[href*="/richiestaimmobiliare/"]') }).first();
    const headers = await table.locator("thead th").allInnerTexts().then((values) => values.map(clean));
    const rows = table.locator("tbody tr");
    for (let index = 0; index < await rows.count(); index += 1) {
      const row = rows.nth(index);
      const link = row.locator('a[href*="/richiestaimmobiliare/"]').first();
      if (!(await link.count())) continue;
      const url = new URL((await link.getAttribute("href")) ?? "", page.url()).toString();
      const externalId = requestId(url);
      if (!externalId) continue;
      const cells = await row.locator("td").allInnerTexts().then((values) => values.map(clean));
      results.set(externalId, {
        externalId,
        title: clean(await link.innerText()),
        url,
        listFields: Object.fromEntries(headers.map((header, cellIndex) => [header || `Colonna ${cellIndex + 1}`, cells[cellIndex] ?? ""])),
      });
    }
    options.onPage?.(pageNumber, results.size);

    const next = page.locator('button:has(svg[data-key="right"])').filter({ visible: true }).first();
    if (!(await next.count()) || !(await next.isEnabled())) break;
    const signature = await archiveSignature(page);
    await next.click();
    await waitForArchivePageToSettle(page, signature);
  }
  return [...results.values()];
}

export async function extractCrmRequestDetail(page: Page): Promise<CrmRequestDetail> {
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 30_000 });
  const url = page.url();
  const externalId = requestId(url);
  if (!externalId) throw new Error(`Identificativo richiesta non riconosciuto nell'indirizzo ${url}`);

  const informationTab = page.getByRole("tab", { name: /^Informazioni$/i }).first();
  if (await informationTab.count() && (await informationTab.getAttribute("aria-selected")) !== "true") await informationTab.click();

  const headerFields: Record<string, string | boolean | null> = {};
  const headerBlocks = page.locator("li.slds-page-header__detail-block");
  const rawHeaderFields = await headerBlocks.evaluateAll((blocks) => blocks.map((block) => ({
    label: (block.querySelector(".slds-text-title") as HTMLElement | null)?.innerText ?? "",
    text: (block as HTMLElement).innerText,
    paths: Array.from(block.querySelectorAll("svg path")).map((path) => path.getAttribute("d") ?? ""),
  })));
  for (const raw of rawHeaderFields) {
    const label = clean(raw.label);
    if (!label) continue;
    const checked = raw.paths.some((d) => /^M10\.041\s+17/i.test(d));
    const unchecked = raw.paths.some((d) => /^M5\s+2/i.test(d));
    const value = clean(raw.text).replace(label, "").trim();
    headerFields[label] = checked ? true : unchecked ? false : value || null;
  }

  const fields: Record<string, string | boolean | null> = {};
  const rows = page.locator(".flex:has(> div > label)");
  let clientExternalId: string | null = null;
  const rawFields = await rows.evaluateAll((elements) => elements.map((element, index) => {
    const value = element.querySelector(".slds-form-element__static") as HTMLElement | null;
    return {
      index,
      label: (element.querySelector("label") as HTMLElement | null)?.innerText ?? "",
      text: value?.innerText ?? "",
      paths: Array.from(value?.querySelectorAll("svg path") ?? []).map((path) => path.getAttribute("d") ?? ""),
    };
  }));
  for (const raw of rawFields) {
    const label = clean(raw.label);
    if (!label) continue;
    const checked = raw.paths.some((d) => /^M10\.041\s+17/i.test(d));
    const unchecked = raw.paths.some((d) => /^M5\s+2/i.test(d));
    fields[label] = checked ? true : unchecked ? false : clean(raw.text) || null;
    if (label === "Cliente") {
      const row = rows.nth(raw.index);
      const href = await row.locator('a[href*="/account/"]').first().getAttribute("href").catch(() => null);
      clientExternalId = href?.match(/\/account\/([^/?#]+)/i)?.[1] ?? null;
      const lookupText = clean(await row.locator("a").first().innerText().catch(() => ""));
      if (lookupText) fields[label] = lookupText;
    }
  }

  const pathItems = page.locator('[role="listbox"] li');
  const statusItems = await pathItems.evaluateAll((items) => items.map((item) => ({ css: item.getAttribute("class") ?? "", text: (item as HTMLElement).innerText })));
  const status = clean(statusItems.find((item) => /slds-is-current|slds-is-active/.test(item.css))?.text) || null;

  const articles = page.locator("article").filter({ visible: true });
  const rawSections = await articles.evaluateAll((elements) => elements.map((article) => ({
    heading: (article.querySelector("h1,h2,h3,h4,[role=heading]") as HTMLElement | null)?.innerText ?? "",
    text: (article as HTMLElement).innerText,
  })));
  const relatedSections = rawSections.map((section, index) => ({ heading: clean(section.heading) || `Sezione ${index + 1}`, text: clean(section.text) })).filter((section) => section.text);

  let evolutionText: string | null = null;
  const evolutionTab = page.getByRole("tab", { name: /Evoluzione richiesta/i }).first();
  if (await evolutionTab.count()) {
    await evolutionTab.click();
    const panelId = await evolutionTab.getAttribute("aria-controls");
    const panel = panelId ? page.locator(`[id="${panelId.replace(/"/g, '\\"')}"]`) : page.getByRole("tabpanel").filter({ visible: true }).first();
    evolutionText = clean(await panel.innerText().catch(() => "")) || null;
    if (await informationTab.count()) await informationTab.click();
  }

  return {
    externalId,
    title: clean(await page.locator("h1").first().innerText()),
    url,
    status,
    headerFields,
    fields,
    clientExternalId,
    relatedSections,
    evolutionText,
    capturedAt: new Date().toISOString(),
  };
}

export function normalizeCrmRequest(detail: CrmRequestDetail) {
  const text = (label: string) => typeof detail.fields[label] === "string" ? detail.fields[label] as string : null;
  const bool = (label: string) => typeof detail.fields[label] === "boolean" ? detail.fields[label] as boolean : null;
  const number = (label: string) => {
    let raw = text(label)?.replace(/[^\d,.-]/g, "") ?? "";
    if (raw.includes(".") && raw.includes(",")) {
      raw = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
    } else if (/^[+-]?\d{1,3}([.,]\d{3})+$/.test(raw)) {
      raw = raw.replace(/[.,]/g, "");
    } else {
      raw = raw.replace(",", ".");
    }
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  };
  const motivation = text("Motivazione Richiesta")?.toLocaleLowerCase("it") ?? "";
  const contractType = /locazione|affitto/.test(motivation) ? "rent" : /acquisto|vendita/.test(motivation) ? "sale" : null;
  const destinationRaw = text("Destinazione Richiesta")?.toLocaleLowerCase("it") ?? "";
  const destination = destinationRaw.includes("prima casa") ? "first_home"
    : destinationRaw.includes("invest") ? "investment"
      : destinationRaw.includes("permut") ? "exchange"
        : destinationRaw ? "other" : null;
  const need = text("Dettaglio Esigenza")?.toLocaleLowerCase("it") ?? "";
  const financingMethod = need.includes("100%") && need.includes("mutuo") ? "full_mortgage"
    : need.includes("contant") && need.includes("mutuo") ? "cash_and_mortgage"
      : need.includes("contant") ? "cash"
        : need.includes("permut") ? "exchange"
          : need ? "other" : null;
  const type = text("Tipologia Immobile")?.toLocaleLowerCase("it") ?? "";
  const propertyTypes = type.includes("appart") ? ["apartment"]
    : type.includes("indipendent") ? ["independent_house"]
      : type.includes("villa") ? ["townhouse"] : [];
  const floorRaw = text("Piano Immobile")?.toLocaleLowerCase("it") ?? "";
  const requestedFloorBand = floorRaw.includes("medio") ? "medium" : floorRaw.includes("basso") ? "low"
    : floorRaw.includes("alto") ? "high" : floorRaw.includes("ultimo") ? "top" : floorRaw ? "any" : null;
  const isHot = bool("Richiesta Calda") ?? false;
  return {
    client: {
      external_crm_id: detail.clientExternalId,
      full_name: text("Nome") ?? text("Cliente"),
      phone: text("Cellulare") ?? text("Telefono fisso"),
      email: text("Email"),
      raw_payload: { request_contact_fields: Object.fromEntries(["Nome", "Email", "Cellulare", "Telefono fisso", "Indirizzo Residenza"].map((key) => [key, detail.fields[key] ?? null])) },
    },
    request: contractType ? {
      external_crm_id: detail.externalId,
      client_id: null,
      title: detail.title,
      contract_type: contractType,
      property_types: propertyTypes,
      status: /chiud|soddisfatt/.test(detail.status?.toLocaleLowerCase("it") ?? "") ? "archived" : "active",
      priority: isHot ? "high" : "normal",
      budget_max: contractType === "sale" ? number("Prezzo") : null,
      monthly_rent_max: contractType === "rent" ? number("Prezzo") : null,
      internal_sqm_ideal: number("Metri Quadri"),
      rooms_ideal: number("Numero Locali"),
      destination: destination,
      financing_method: financingMethod,
      requested_floor_band: requestedFloorBand,
      from_own_listing: detail.headerFields["Da mio annuncio"] === true,
      notes: [text("Esigenze"), text("Dettaglio Esigenza")].filter(Boolean).join(" — ") || null,
      source: "crm_archive",
      last_imported_at: detail.capturedAt,
      raw_payload: detail,
    } : null,
  };
}
