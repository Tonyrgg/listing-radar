import type { Page } from "playwright";

export type CrmMandateArchiveItem = {
  externalId: string;
  title: string;
  url: string;
  listFields: Record<string, string>;
};

export type CrmMandateFieldEntry = {
  label: string;
  value: string | boolean | null;
  links: Array<{ text: string; url: string; externalId: string | null }>;
};

export type CrmMandateDetail = {
  mandateExternalId: string;
  propertyExternalId: string;
  title: string;
  sourceUrl: string;
  url: string;
  status: string | null;
  headerFields: Record<string, string | boolean | null>;
  fields: Record<string, string | boolean | null>;
  fieldEntries: CrmMandateFieldEntry[];
  listFields: Record<string, string>;
  relatedSections: Array<{ heading: string; text: string }>;
  evolutionText: string | null;
  images: Array<{ src: string; alt: string | null; context: string | null }>;
  attachments: Array<{ text: string; url: string }>;
  attachmentsText: string | null;
  capturedAt: string;
};

const mandateLinkSelector = 'table tbody a[href*="/incarico/"]';

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function mandateId(url: string) {
  return url.match(/\/incarico\/([^/?#]+)/i)?.[1] ?? "";
}

function propertyId(url: string) {
  return url.match(/\/immobile\/([^/?#]+)/i)?.[1] ?? "";
}

async function archiveSignature(page: Page) {
  return (await page.locator(mandateLinkSelector).evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""))).join("\n");
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
  throw new Error("La pagina successiva dell'archivio incarichi non ha terminato il caricamento");
}

export async function collectCrmMandateArchive(
  page: Page,
  options: { onPage?: (pageNumber: number, discovered: number) => void; isCancelled?: () => boolean } = {},
): Promise<CrmMandateArchiveItem[]> {
  await page.locator(mandateLinkSelector).first().waitFor({ state: "visible", timeout: 30_000 });
  const first = page.locator('button:has(svg[data-key="jump_to_left"])').filter({ visible: true }).first();
  if (await first.count() && await first.isEnabled()) {
    const signature = await archiveSignature(page);
    await first.click();
    await waitForArchivePageToSettle(page, signature);
  }

  const results = new Map<string, CrmMandateArchiveItem>();
  let pageNumber = 0;
  for (;;) {
    if (options.isCancelled?.()) break;
    pageNumber += 1;
    const table = page.locator("table").filter({ has: page.locator('a[href*="/incarico/"]') }).first();
    const headers = await table.locator("thead th").allInnerTexts().then((values) => values.map(clean));
    const rows = table.locator("tbody tr");
    for (let index = 0; index < await rows.count(); index += 1) {
      const row = rows.nth(index);
      const link = row.locator('a[href*="/incarico/"]').first();
      if (!(await link.count())) continue;
      const url = new URL((await link.getAttribute("href")) ?? "", page.url()).toString();
      const externalId = mandateId(url);
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

async function selectTab(page: Page, name: RegExp) {
  const tab = page.getByRole("tab", { name }).first();
  if (!(await tab.count())) return null;
  if ((await tab.getAttribute("aria-selected")) !== "true") {
    await tab.click();
    await page.waitForTimeout(250);
  }
  const panelId = await tab.getAttribute("aria-controls");
  return panelId ? page.locator(`[id="${panelId.replace(/"/g, '\\"')}"]`) : page.getByRole("tabpanel").filter({ visible: true }).first();
}

function fieldValue(paths: string[], text: string): string | boolean | null {
  if (paths.some((path) => /^M10\.041\s+17/i.test(path))) return true;
  if (paths.some((path) => /^M5\s+2/i.test(path))) return false;
  return clean(text) || null;
}

export async function extractCrmMandateDetail(page: Page, archiveItem: CrmMandateArchiveItem): Promise<CrmMandateDetail> {
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 30_000 });
  const url = page.url();
  const propertyExternalId = propertyId(url);
  if (!archiveItem.externalId) throw new Error(`Identificativo incarico non riconosciuto nell'indirizzo ${archiveItem.url}`);
  if (!propertyExternalId) throw new Error(`Identificativo immobile non riconosciuto nell'indirizzo ${url}`);

  await selectTab(page, /^Informazioni$/i);
  const headerFields: Record<string, string | boolean | null> = {};
  const rawHeaderFields = await page.locator("li.slds-page-header__detail-block").evaluateAll((blocks) => blocks.map((block) => ({
    label: (block.querySelector(".slds-text-title") as HTMLElement | null)?.innerText ?? "",
    text: (block as HTMLElement).innerText,
    paths: Array.from(block.querySelectorAll("svg path")).map((path) => path.getAttribute("d") ?? ""),
  })));
  for (const raw of rawHeaderFields) {
    const label = clean(raw.label);
    if (label) headerFields[label] = fieldValue(raw.paths, clean(raw.text).replace(label, ""));
  }

  const rawFields = await page.locator(".flex:has(> div > label)").evaluateAll((elements) => elements.map((element) => {
    const value = element.querySelector(".slds-form-element__static") as HTMLElement | null;
    return {
      label: (element.querySelector("label") as HTMLElement | null)?.innerText ?? "",
      text: value?.innerText ?? "",
      paths: Array.from(value?.querySelectorAll("svg path") ?? []).map((path) => path.getAttribute("d") ?? ""),
      links: Array.from(value?.querySelectorAll("a") ?? []).map((link) => ({ text: (link as HTMLElement).innerText, href: link.getAttribute("href") ?? "" })),
    };
  }));
  const fields: Record<string, string | boolean | null> = {};
  const fieldEntries: CrmMandateFieldEntry[] = [];
  for (const raw of rawFields) {
    const label = clean(raw.label);
    if (!label) continue;
    const value = fieldValue(raw.paths, raw.text);
    const links = raw.links.filter((link) => link.href).map((link) => {
      const linkUrl = new URL(link.href, url).toString();
      return { text: clean(link.text), url: linkUrl, externalId: linkUrl.match(/\/(?:account|incarico|immobile)\/([^/?#]+)/i)?.[1] ?? null };
    });
    fieldEntries.push({ label, value, links });
    if (!(label in fields)) fields[label] = value;
  }

  const statusItems = await page.locator('[role="listbox"] li').evaluateAll((items) => items.map((item) => ({
    css: item.getAttribute("class") ?? "", text: (item as HTMLElement).innerText,
  })));
  const status = clean(statusItems.find((item) => /slds-is-current|slds-is-active/.test(item.css))?.text)
    || (typeof fields["Stato Incarico"] === "string" ? clean(String(fields["Stato Incarico"])) : null);
  const rawSections = await page.locator("article").filter({ visible: true }).evaluateAll((elements) => elements.map((article) => ({
    heading: (article.querySelector("h1,h2,h3,h4,[role=heading]") as HTMLElement | null)?.innerText ?? "",
    text: (article as HTMLElement).innerText,
  })));
  const relatedSections = rawSections.map((section, index) => ({ heading: clean(section.heading) || `Sezione ${index + 1}`, text: clean(section.text) })).filter((section) => section.text);

  const evolutionPanel = await selectTab(page, /Evoluzione Immobile/i);
  const evolutionText = evolutionPanel ? clean(await evolutionPanel.innerText().catch(() => "")) || null : null;
  const imagesPanel = await selectTab(page, /^Immagini$/i);
  const images = imagesPanel ? await imagesPanel.locator("img").evaluateAll((elements) => elements.map((element) => {
    const image = element as HTMLImageElement;
    return { src: image.currentSrc || image.src || "", alt: image.alt || null, context: (image.closest("tr,li,figure,article,div") as HTMLElement | null)?.innerText?.replace(/\s+/g, " ").trim() || null };
  })).then((items) => items.filter((item) => item.src)) : [];
  const attachmentsPanel = await selectTab(page, /^Allegati$/i);
  const attachmentsText = attachmentsPanel ? clean(await attachmentsPanel.innerText().catch(() => "")) || null : null;
  const attachments = attachmentsPanel ? await attachmentsPanel.locator("a[href]").evaluateAll((links) => links.map((link) => ({
    text: (link as HTMLElement).innerText.replace(/\s+/g, " ").trim(), href: link.getAttribute("href") ?? "",
  }))).then((links) => links.filter((link) => link.href).map((link) => ({ text: link.text, url: new URL(link.href, url).toString() }))) : [];
  await selectTab(page, /^Informazioni$/i);

  return {
    mandateExternalId: archiveItem.externalId, propertyExternalId,
    title: clean(await page.locator("h1").first().innerText()), sourceUrl: archiveItem.url, url, status,
    headerFields, fields, fieldEntries, listFields: archiveItem.listFields, relatedSections,
    evolutionText, images, attachments, attachmentsText, capturedAt: new Date().toISOString(),
  };
}

function parseNumber(value: string | boolean | null | undefined) {
  let raw = typeof value === "string" ? value.replace(/[^\d,.-]/g, "") : "";
  if (raw.includes(".") && raw.includes(",")) raw = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  else if (/^[+-]?\d{1,3}([.,]\d{3})+$/.test(raw)) raw = raw.replace(/[.,]/g, "");
  else raw = raw.replace(",", ".");
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: string | boolean | null | undefined) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}` : null;
}

export function normalizeCrmMandate(detail: CrmMandateDetail) {
  const value = (...labels: string[]) => {
    for (const label of labels) {
      const field = detail.fields[label] ?? detail.listFields[label];
      if (typeof field === "string" && clean(field)) return clean(field);
    }
    return null;
  };
  const motivation = value("Motivazione")?.toLocaleLowerCase("it") ?? detail.title.toLocaleLowerCase("it");
  const contractType = /affitto|locazione/.test(motivation) ? "rent" : "sale";
  const mainType = (value("Tipologia Immobile") ?? "").toLocaleLowerCase("it");
  const subtype = (value("Sottotipologia Immobile", "Sottotipologia") ?? "").toLocaleLowerCase("it");
  const type = `${mainType} ${subtype}`;
  const propertyType = /appart/.test(mainType) ? (/attico/.test(type) ? "penthouse" : /piano terra/.test(type) ? "ground_floor" : "apartment")
    : /garage|box|posto auto/.test(type) ? "garage" : /commercial|negozio|\blocale\b|\blocali\b/.test(type) ? "commercial_space"
      : /ufficio|studio/.test(type) ? "office" : /deposito|magazzino/.test(type) ? "warehouse" : /terreno/.test(type) ? "land"
        : /villa/.test(type) ? "villa" : /indipendent/.test(type) ? "independent_house" : /palazz|stabile/.test(type) ? "entire_building" : "apartment";
  const occupancy = value("Occupato da")?.toLocaleLowerCase("it") ?? "";
  const rawStatus = `${detail.status ?? ""} ${value("Stato Incarico") ?? ""}`.toLocaleLowerCase("it");
  const mandateStatus = /vendut/.test(rawStatus) ? "sold" : /locat|affittat/.test(rawStatus) ? "rented" : /sospes/.test(rawStatus) ? "suspended"
    : /scadut/.test(rawStatus) ? "expired" : /chius|archiv/.test(rawStatus) ? "archived" : "active";
  const conditionRaw = `${value("Stato Interno") ?? ""} ${value("Stato Esterno") ?? ""}`.toLocaleLowerCase("it");
  const condition = /ristrutturat|ottim/.test(conditionRaw) ? "renovated" : /da ristrutturare|ristrutturaz/.test(conditionRaw) ? "to_renovate"
    : /buon|abitabil/.test(conditionRaw) ? "good" : null;
  const internal = value("Interno", "Immobile: Interno");
  const address = [value("Indirizzo", "Immobile: Indirizzo"), value("Civico", "Immobile: Civico"), value("Lettera", "Immobile: Lettera"), internal ? `int. ${internal}` : null].filter(Boolean).join(" ") || null;
  const price = parseNumber(value("Prezzo Incarico"));
  return {
    external_crm_id: detail.propertyExternalId, external_mandate_id: detail.mandateExternalId,
    title: detail.title, contract_type: contractType, property_type: propertyType,
    municipality: value("Comune", "Immobile: Comune") ?? "Bitonto", address,
    crm_zone_name: value("Zona", "Immobile: Zona"),
    price: contractType === "sale" ? price : null, monthly_rent: contractType === "rent" ? price : null,
    internal_sqm: parseNumber(value("Metri Quadri Calpestabili")), commercial_sqm: parseNumber(value("Metri Quadri Commerciali", "Immobile: Metri Quadri Commerciali")),
    rooms: parseNumber(value("Numero Locali", "Immobile: Numero Locali")), floor: parseNumber(value("Numero Piano", "Immobile: Numero Piano")),
    condition, availability_status: /liber/.test(occupancy) ? "available_now" : occupancy ? "occupied" : null,
    available_from: parseDate(value("Data Scadenza Affitto")), description: value("Descrizione"), notes: value("Note Interne"),
    source: "crm_archive", last_imported_at: detail.capturedAt, mandate_status: mandateStatus,
    image_urls: detail.images.map((image) => image.src), raw_payload: detail,
  };
}
