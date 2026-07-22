import type { Locator, Page } from "playwright";

import { SelectorConfigurationError, WorkerError } from "../../core/errors.js";
import { parseOwnerBlock } from "../../core/owner-parser.js";
import { logger } from "../../logger.js";
import type { CadastralOwner, CadastralProperty, SearchContext, SisterAdapter } from "../../types.js";
import { sisterSelectors, type SisterSelectors } from "./selectors.js";

async function text(scope: Page | Locator, selector: string): Promise<string> {
  if (!selector) return "";
  const locator = scope.locator(selector).first();
  if (await locator.count() === 0) return "";
  return (await locator.textContent())?.trim() ?? "";
}

function parseIncome(value: string): number | null {
  if (!value.trim()) return null;
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeCategory(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  const compact = normalized.match(/^([AC])\/?0*(\d+)$/);
  return compact ? `${compact[1]}/${compact[2]}` : normalized;
}

function parseSearchContext(value: string): Pick<SearchContext, "municipality" | "street" | "civicNumber"> {
  const normalized = value.replace(/\s+/g, " ").trim();
  const municipality = normalized.match(/Comune:\s*(.*?)\s+Codice:/i)?.[1]?.trim() ?? "";
  const street = normalized.match(/Indirizzo:\s*(.*?)\s+Numeri civici/i)?.[1]?.trim() || null;
  const civicNumber = normalized.match(/(?:dal\s+nr\.|nr\.)\s*([^\s]+)/i)?.[1]?.trim() || null;
  return { municipality, street, civicNumber };
}

function normalizeHeader(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
}

async function columnIndexes(
  table: Locator,
  expected: Record<string, string[]>,
  tableName: string,
): Promise<Record<string, number>> {
  const headers = await table.locator("tr:has(th)").first().locator("th").allTextContents();
  const normalized = headers.map(normalizeHeader);
  const indexes: Record<string, number> = {};
  const missing: string[] = [];
  for (const [key, aliases] of Object.entries(expected)) {
    const normalizedAliases = aliases.map(normalizeHeader);
    const index = normalized.findIndex((header) => normalizedAliases.some((alias) => header === alias || header.startsWith(`${alias} `)));
    if (index < 0) missing.push(key);
    else indexes[key] = index;
  }
  if (missing.length) {
    throw new WorkerError(
      `Colonne ${tableName} non riconosciute: ${missing.join(", ")}`,
      "portal_error",
      { portal: "SISTER", tableName, headers },
      true,
    );
  }
  return indexes;
}

async function cellText(row: Locator, index: number): Promise<string> {
  return (await row.locator("td").nth(index).textContent())?.trim() ?? "";
}

export class PlaywrightSisterAdapter implements SisterAdapter {
  private ignoredCategories: Array<{ category: string; rowIndex: number }> = [];
  private ignoredEmptyProperties: Array<{ rowIndex: number; sheet: string; parcel: string; subaltern: string; address: string }> = [];
  private ignoredRights: Array<{ rightType: string; rowIndex: number }> = [];

  constructor(
    private readonly page: Page,
    private readonly selectors: SisterSelectors = sisterSelectors,
  ) {}

  private require(...keys: Array<keyof SisterSelectors>) {
    const missing = keys.filter((key) => !this.selectors[key]);
    if (missing.length) throw new SelectorConfigurationError("SISTER", missing);
  }

  private async checkSession() {
    const expiredByUrl = /sessione[_-]?scaduta|login|accesso/i.test(this.page.url());
    const expiredByTitle = /sessione\s+scaduta|accesso/i.test(await this.page.title().catch(() => ""));
    const expiredByMarker = Boolean(this.selectors.sessionExpiredMarker)
      && await this.page.locator(this.selectors.sessionExpiredMarker).count() > 0;
    if (expiredByUrl || expiredByTitle || expiredByMarker) {
      throw new WorkerError("Sessione SISTER scaduta: effettua nuovamente l'accesso manuale", "session_expired", { portal: "SISTER" }, true);
    }
  }

  private async waitForMarker(selector: string, description: string) {
    try {
      await this.page.locator(selector).first().waitFor({ state: "attached", timeout: 15_000 });
    } catch {
      await this.checkSession();
      throw new WorkerError(
        `Pagina SISTER non riconosciuta durante ${description}`,
        "portal_error",
        { portal: "SISTER", url: this.page.url(), description },
        true,
      );
    }
    await this.checkSession();
  }

  private async ensureResultsPage() {
    await this.checkSession();
    if (await this.page.locator(this.selectors.resultsPageMarker).count()) return;
    if (this.selectors.ownersPageMarker && await this.page.locator(this.selectors.ownersPageMarker).count()) {
      this.require("ownersBackButton");
      await this.page.locator(this.selectors.ownersBackButton).click();
      await this.waitForMarker(this.selectors.resultsPageMarker, "il ritorno ai risultati");
      return;
    }
    throw new WorkerError(
      "La scheda SISTER non mostra né i risultati né gli intestatari",
      "portal_error",
      { portal: "SISTER", url: this.page.url() },
      true,
    );
  }

  async detectPage(): Promise<boolean> {
    this.require("resultsPageMarker");
    await this.checkSession();
    return (await this.page.locator(this.selectors.resultsPageMarker).count()) > 0;
  }

  async extractSearchContext(): Promise<SearchContext> {
    if (this.selectors.searchContext) {
      const context = parseSearchContext(await text(this.page, this.selectors.searchContext));
      if (!context.municipality) {
        throw new WorkerError("Comune non riconosciuto nei risultati SISTER", "data_incomplete", { sourceUrl: this.page.url() });
      }
      return { ...context, sourceUrl: this.page.url() };
    }
    this.require("municipality");
    return {
      municipality: await text(this.page, this.selectors.municipality),
      street: (await text(this.page, this.selectors.street)) || null,
      civicNumber: (await text(this.page, this.selectors.civicNumber)) || null,
      sourceUrl: this.page.url(),
    };
  }

  async extractProperties(): Promise<CadastralProperty[]> {
    this.require("propertyRows", "sheet", "parcel", "subaltern", "category");
    const context = await this.extractSearchContext();
    const rows = this.page.locator(this.selectors.propertyRows);
    const columns = this.selectors.resultsTable
      ? await columnIndexes(this.page.locator(this.selectors.resultsTable), {
          sheet: ["Foglio"], parcel: ["Particella"], subaltern: ["Sub", "Subalterno"],
          address: ["Indirizzo"], censusZone: ["Zona cens", "Zona censuaria"], category: ["Categoria"],
          class: ["Classe"], consistency: ["Consistenza"], cadastralIncome: ["Rendita"],
        }, "immobili")
      : null;
    const properties: CadastralProperty[] = [];
    this.ignoredCategories = [];
    this.ignoredEmptyProperties = [];
    const rowCount = await rows.count();
    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      const cells = columns ? await row.locator("td").allTextContents() : null;
      const value = (key: string, selector: string) => cells
        ? Promise.resolve(cells[columns![key]!]?.trim() ?? "")
        : text(row, selector);
      const raw = {
        sheet: await value("sheet", this.selectors.sheet),
        parcel: await value("parcel", this.selectors.parcel),
        subaltern: await value("subaltern", this.selectors.subaltern),
        address: await value("address", this.selectors.address),
        censusZone: await value("censusZone", this.selectors.censusZone),
        category: await value("category", this.selectors.category),
        class: await value("class", this.selectors.class),
        consistency: await value("consistency", this.selectors.consistency),
        cadastralIncome: await value("cadastralIncome", this.selectors.cadastralIncome),
      };
      const hasCadastralData = [raw.censusZone, raw.category, raw.class, raw.consistency, raw.cadastralIncome]
        .some((item) => item.trim().length > 0);
      if (!hasCadastralData) {
        const ignored = { rowIndex: index, sheet: raw.sheet, parcel: raw.parcel, subaltern: raw.subaltern, address: raw.address };
        this.ignoredEmptyProperties.push(ignored);
        logger.info(ignored, "Record SISTER privo di dati catastali ignorato");
        continue;
      }
      const category = normalizeCategory(raw.category);
      if (!/^[AC]\//i.test(category)) {
        this.ignoredCategories.push({ category, rowIndex: index });
        logger.info({ category, rowIndex: index }, "Categoria catastale ignorata");
        continue;
      }
      properties.push({
        municipality: context.municipality,
        sheet: raw.sheet,
        parcel: raw.parcel,
        subaltern: raw.subaltern,
        address: raw.address || null,
        censusZone: raw.censusZone || null,
        category,
        class: raw.class || null,
        consistency: raw.consistency || null,
        cadastralIncome: parseIncome(raw.cadastralIncome),
        sourceRef: String(index),
        rawPayload: { rowIndex: index, sourceOrder: index, searchContext: context },
      });
    }
    return properties;
  }

  async extractOwners(property: CadastralProperty): Promise<CadastralOwner[]> {
    this.require("propertyRows");
    await this.ensureResultsPage();
    const rowIndex = Number(property.sourceRef ?? property.rawPayload.rowIndex);
    if (!Number.isInteger(rowIndex)) {
      throw new WorkerError("Riferimento riga SISTER non disponibile", "data_incomplete", { property: property.rawPayload });
    }
    const owners: CadastralOwner[] = [];
    if (this.selectors.ownersWithinRow) {
      const blocks = this.page.locator(this.selectors.propertyRows).nth(rowIndex).locator(this.selectors.ownersWithinRow);
      for (let index = 0; index < await blocks.count(); index += 1) {
        this.addOwner(owners, parseOwnerBlock((await blocks.nth(index).innerText()).trim()), rowIndex);
      }
      return owners;
    }

    this.require(
      "propertyRadioWithinRow", "ownersButton", "ownersPageMarker", "ownerRows",
      "ownerPersonalData", "ownerTaxCode", "ownerRightType", "ownerShare", "ownersBackButton",
    );
    const row = this.page.locator(this.selectors.propertyRows).nth(rowIndex);
    await row.locator(this.selectors.propertyRadioWithinRow).check();
    await this.page.locator(this.selectors.ownersButton).click();
    await this.waitForMarker(this.selectors.ownersPageMarker, "l'apertura degli intestatari");

    try {
      const ownerRows = this.page.locator(this.selectors.ownerRows);
      const ownerColumns = this.selectors.ownersTable
        ? await columnIndexes(this.page.locator(this.selectors.ownersTable), {
            personalData: ["Nominativo o denominazione", "Nominativo"],
            taxCode: ["Codice fiscale"], rightType: ["Titolarita", "Diritto"], share: ["Quota"],
          }, "intestatari")
        : null;
      const ownerValue = (ownerRow: Locator, key: string, selector: string) => ownerColumns
        ? cellText(ownerRow, ownerColumns[key]!)
        : text(ownerRow, selector);
      for (let index = 0; index < await ownerRows.count(); index += 1) {
        const ownerRow = ownerRows.nth(index);
        const block = [
          await ownerValue(ownerRow, "personalData", this.selectors.ownerPersonalData),
          await ownerValue(ownerRow, "taxCode", this.selectors.ownerTaxCode),
          await ownerValue(ownerRow, "rightType", this.selectors.ownerRightType),
          await ownerValue(ownerRow, "share", this.selectors.ownerShare),
        ].join("\n");
        this.addOwner(owners, parseOwnerBlock(block), rowIndex);
      }
    } finally {
      if (await this.page.locator(this.selectors.ownersPageMarker).count()) {
        await this.page.locator(this.selectors.ownersBackButton).click();
        await this.waitForMarker(this.selectors.resultsPageMarker, "il ritorno ai risultati");
      }
    }
    return owners;
  }

  private addOwner(owners: CadastralOwner[], owner: CadastralOwner, rowIndex: number) {
    if (/^proprieta'?$/i.test(owner.rightType.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) owners.push(owner);
    else {
      this.ignoredRights.push({ rightType: owner.rightType, rowIndex });
      logger.info({ rightType: owner.rightType, rowIndex }, "Diritto reale ignorato");
    }
  }

  getIgnoredCategories() {
    return [...this.ignoredCategories];
  }

  getIgnoredEmptyProperties() {
    return [...this.ignoredEmptyProperties];
  }

  getIgnoredRights() {
    return [...this.ignoredRights];
  }
}
