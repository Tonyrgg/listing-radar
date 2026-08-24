import type { Locator, Page } from "playwright";

import { SelectorConfigurationError, WorkerError } from "../../core/errors.js";
import { isOwnershipRight, parseOwnerBlock } from "../../core/owner-parser.js";
import { businessOwnerReason, maskOwnerTaxCode } from "../../core/owner-kind.js";
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
  private ignoredBusinesses: Array<{ fullName: string; taxCode: string | null; reason: string; rowIndex: number }> = [];

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

  async ensureResultsPage() {
    await this.checkSession();
    if (await this.page.locator(this.selectors.resultsPageMarker).count()) return;
    if (this.selectors.ownersPageMarker && await this.page.locator(this.selectors.ownersPageMarker).count()) {
      this.require("ownersBackButton");
      await this.page.locator(this.selectors.ownersBackButton).click();
      await this.waitForMarker(this.selectors.resultsPageMarker, "il ritorno ai risultati");
      return;
    }
    if (
      /\/Visure\/vind\/SceltaVisuraImmSoggIND\.do(?:\?|$)/i.test(this.page.url())
      && !(await this.page.locator("form").count())
    ) {
      await this.page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null);
      if (await this.page.locator(this.selectors.resultsPageMarker).count()) {
        logger.warn({ url: this.page.url() }, "Pagina intestatari SISTER vuota: recuperati i risultati tramite cronologia");
        return;
      }
      if (this.selectors.ownersPageMarker && await this.page.locator(this.selectors.ownersPageMarker).count()) {
        await this.page.locator(this.selectors.ownersBackButton).click();
        await this.waitForMarker(this.selectors.resultsPageMarker, "il recupero dei risultati dopo una risposta vuota");
        logger.warn({ url: this.page.url() }, "Pagina intestatari SISTER vuota: recuperati i risultati dalla pagina precedente");
        return;
      }
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

  async detectOperationalPage(): Promise<"results" | "address-list" | null> {
    this.require("resultsPageMarker", "addressListMarker");
    await this.checkSession();
    if (await this.page.locator(this.selectors.resultsPageMarker).count()) return "results";
    if (await this.page.locator(this.selectors.addressListMarker).count()) return "address-list";
    return null;
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
    type RawPropertyRow = {
      sheet: string;
      parcel: string;
      subaltern: string;
      address: string;
      censusZone: string;
      category: string;
      class: string;
      consistency: string;
      cadastralIncome: string;
    };
    const rawRows: RawPropertyRow[] = columns
      ? await rows.evaluateAll((elements, indexes) => elements.map((element) => {
          const cells = Array.from(element.querySelectorAll(":scope > td"), (cell) => (cell.textContent ?? "").trim());
          return {
            sheet: indexes.sheet == null ? "" : cells[indexes.sheet] ?? "",
            parcel: indexes.parcel == null ? "" : cells[indexes.parcel] ?? "",
            subaltern: indexes.subaltern == null ? "" : cells[indexes.subaltern] ?? "",
            address: indexes.address == null ? "" : cells[indexes.address] ?? "",
            censusZone: indexes.censusZone == null ? "" : cells[indexes.censusZone] ?? "",
            category: indexes.category == null ? "" : cells[indexes.category] ?? "",
            class: indexes.class == null ? "" : cells[indexes.class] ?? "",
            consistency: indexes.consistency == null ? "" : cells[indexes.consistency] ?? "",
            cadastralIncome: indexes.cadastralIncome == null ? "" : cells[indexes.cadastralIncome] ?? "",
          };
        }), columns)
      : await Promise.all(Array.from({ length: await rows.count() }, async (_, index) => {
          const row = rows.nth(index);
          return {
            sheet: await text(row, this.selectors.sheet),
            parcel: await text(row, this.selectors.parcel),
            subaltern: await text(row, this.selectors.subaltern),
            address: await text(row, this.selectors.address),
            censusZone: await text(row, this.selectors.censusZone),
            category: await text(row, this.selectors.category),
            class: await text(row, this.selectors.class),
            consistency: await text(row, this.selectors.consistency),
            cadastralIncome: await text(row, this.selectors.cadastralIncome),
          };
        }));
    const properties: CadastralProperty[] = [];
    this.ignoredCategories = [];
    this.ignoredEmptyProperties = [];
    for (const [index, raw] of rawRows.entries()) {
      const hasCadastralData = [raw.censusZone, raw.category, raw.class, raw.consistency, raw.cadastralIncome]
        .some((item) => item.trim().length > 0);
      if (!hasCadastralData) {
        const ignored = { rowIndex: index, sheet: raw.sheet, parcel: raw.parcel, subaltern: raw.subaltern, address: raw.address };
        this.ignoredEmptyProperties.push(ignored);
        continue;
      }
      const category = normalizeCategory(raw.category);
      if (!/^[AC]\//i.test(category)) {
        this.ignoredCategories.push({ category, rowIndex: index });
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
        rawPayload: { rowIndex: index, sourceOrder: index, searchContext: context, rawCells: raw },
      });
    }
    logger.info({
      rawRows: rawRows.length,
      acceptedProperties: properties.length,
      ignoredCategories: this.ignoredCategories.length,
      ignoredEmptyProperties: this.ignoredEmptyProperties.length,
    }, "Inventario SISTER letto e filtrato");
    return properties;
  }

  async extractOwners(property: CadastralProperty): Promise<CadastralOwner[]> {
    this.require("propertyRows");
    await this.ensureResultsPage();
    const sourceRowIndex = Number(property.sourceRef ?? property.rawPayload.rowIndex);
    if (!Number.isInteger(sourceRowIndex)) {
      throw new WorkerError("Riferimento riga SISTER non disponibile", "data_incomplete", { property: property.rawPayload });
    }
    const rowIndex = await this.resolvePropertyRowIndex(property, sourceRowIndex);
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
    if (!process.env.VITEST) await this.page.waitForTimeout(250);
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null),
      this.page.locator(this.selectors.ownersButton).click(),
    ]);
    if (
      /\/Visure\/vind\/SceltaVisuraImmSoggIND\.do(?:\?|$)/i.test(this.page.url())
      && !(await this.page.locator("form").count())
    ) {
      throw new WorkerError(
        "SISTER ha restituito una pagina intestatari vuota",
        "portal_error",
        { portal: "SISTER", action: "owners-empty-response", rowIndex },
        false,
      );
    }
    await this.waitForMarker(this.selectors.ownersPageMarker, "l'apertura degli intestatari");

    let extractionError: unknown = null;
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
    } catch (error) {
      extractionError = error;
      throw error;
    } finally {
      if (await this.page.locator(this.selectors.ownersPageMarker).count()) {
        try {
          await this.page.locator(this.selectors.ownersBackButton).click();
          await this.waitForMarker(this.selectors.resultsPageMarker, "il ritorno ai risultati");
        } catch (returnError) {
          if (!extractionError) throw returnError;
          logger.error({
            rowIndex,
            error: returnError instanceof Error ? returnError.message : String(returnError),
          }, "Ritorno ai risultati SISTER fallito dopo un errore di estrazione");
        }
      }
    }
    return owners;
  }

  private async resolvePropertyRowIndex(property: CadastralProperty, preferredIndex: number): Promise<number> {
    const rows = this.page.locator(this.selectors.propertyRows);
    const expected = [property.sheet, property.parcel, property.subaltern].map((value) => value.trim());
    const matches = async (index: number) => {
      if (index < 0 || index >= await rows.count()) return false;
      const row = rows.nth(index);
      const actual = await Promise.all([
        text(row, this.selectors.sheet),
        text(row, this.selectors.parcel),
        text(row, this.selectors.subaltern),
      ]);
      return actual.every((value, position) => value.trim() === expected[position]);
    };
    if (await matches(preferredIndex)) return preferredIndex;

    const matchingIndexes: number[] = [];
    for (let index = 0; index < await rows.count(); index += 1) {
      if (await matches(index)) matchingIndexes.push(index);
    }
    if (matchingIndexes.length === 1) {
      logger.warn({ preferredIndex, resolvedIndex: matchingIndexes[0], cadastralKey: expected.join("|") }, "Ordine righe SISTER cambiato: immobile ritrovato tramite terna catastale");
      return matchingIndexes[0]!;
    }
    throw new WorkerError(
      matchingIndexes.length
        ? "La terna catastale compare piÃ¹ volte nei risultati SISTER: impossibile scegliere la riga in sicurezza"
        : "La riga SISTER non coincide piÃ¹ con la terna catastale acquisita",
      "needs_review",
      {
        portal: "SISTER",
        action: "property-row-identity",
        preferredIndex,
        cadastralKey: expected.join("|"),
        matchingIndexes,
      },
      true,
    );
  }

  private addOwner(owners: CadastralOwner[], owner: CadastralOwner, rowIndex: number) {
    const businessReason = businessOwnerReason(owner.fullName, owner.taxCode);
    if (businessReason) {
      const ignored = {
        fullName: owner.fullName,
        taxCode: maskOwnerTaxCode(owner.taxCode),
        reason: businessReason,
        rowIndex,
      };
      this.ignoredBusinesses.push(ignored);
      logger.info(ignored, "Intestatario aziendale escluso dalla raccolta");
      return;
    }
    if (isOwnershipRight(owner.rightType)) owners.push(owner);
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

  getIgnoredBusinesses() {
    return [...this.ignoredBusinesses];
  }

  hasIgnoredBusinessOnRow(rowIndex: number) {
    return this.ignoredBusinesses.some((owner) => owner.rowIndex === rowIndex);
  }
}
