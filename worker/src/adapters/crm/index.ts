import type { Locator, Page } from "playwright";

import { SelectorConfigurationError, WorkerError } from "../../core/errors.js";
import { formatShareForUi } from "../../core/normalize.js";
import type {
  CadastralKey,
  CrmActivityInput,
  CrmAdapter,
  NormalizedPerson,
  NormalizedProperty,
  PersonMatchResult,
  PersonSearchInput,
  PropertyMatchResult,
} from "../../types.js";
import { crmSelectors, type CrmSelectors } from "./selectors.js";

const CRM_PATH = "/CRMImmobiliareLightning/s";

function comparableCadastralValue(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, "").replace(/^0+(?=\d)/, "").toUpperCase();
}

function recordIdFromHref(href: string | null, entity: "account" | "immobile") {
  return href?.match(new RegExp(`/s/${entity}/([^/?#]+)`, "i"))?.[1] ?? "";
}

export class PlaywrightCrmAdapter implements CrmAdapter {
  constructor(
    private readonly page: Page,
    private readonly dryRun: boolean,
    private readonly selectors: CrmSelectors = crmSelectors,
  ) {}

  private require(...keys: Array<keyof CrmSelectors>) {
    const missing = keys.filter((key) => !this.selectors[key]);
    if (missing.length) throw new SelectorConfigurationError("CRM", missing);
  }

  private async friendly<T>(action: string, message: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      throw new WorkerError(
        `${message} Apri la pagina indicata nel gestionale e premi “Riprendi”.`,
        "portal_error",
        {
          portal: "CRM",
          action,
          technicalError: error instanceof Error ? error.message : String(error),
          pageUrl: this.page.url(),
        },
        true,
      );
    }
  }

  private async checkSession() {
    if (this.selectors.sessionExpiredMarker && await this.page.locator(this.selectors.sessionExpiredMarker).count()) {
      throw new WorkerError("La sessione del gestionale è scaduta. Accedi nuovamente e premi “Riprendi”.", "session_expired", { portal: "CRM" }, true);
    }
    if (this.selectors.unexpectedError && await this.page.locator(this.selectors.unexpectedError).count()) {
      throw new WorkerError("Il gestionale mostra un errore inatteso. Chiudi il messaggio e premi “Riprendi”.", "portal_error", { portal: "CRM" }, true);
    }
  }

  private async readRecordId(row: Locator, selector: string): Promise<string> {
    const target = row.locator(selector).first();
    return (await target.getAttribute("data-recordid"))
      || (await target.getAttribute("data-id"))
      || recordIdFromHref(await target.getAttribute("href"), "account")
      || (await target.textContent())?.trim()
      || "";
  }

  private async readResultLabel(row: Locator, selector: string): Promise<string> {
    const target = row.locator(selector).first();
    return (await target.getAttribute("title")) ?? (await target.textContent())?.trim() ?? "";
  }

  private async submitGlobalSearch(inputSelector: string, submitSelector: string) {
    if (inputSelector === submitSelector) {
      const field = this.page.locator(inputSelector).filter({ visible: true }).first();
      await field.press("Enter");
      const navigated = await this.page.waitForURL(/\/global-search\//, { timeout: 4_000 }).then(() => true).catch(() => false);
      if (!navigated) {
        const searchOption = this.page.locator('li.SEARCH_OPTION:visible a[role="option"], li.SEARCH_OPTION:visible a').first();
        if (await searchOption.count()) await searchOption.click({ force: true });
        else await field.press("Enter");
        await this.page.waitForURL(/\/global-search\//, { timeout: 8_000 });
      }
    } else await this.page.locator(submitSelector).first().click();
    this.require("personResultsReady");
    await this.page.locator(this.selectors.personResultsReady).first().waitFor({ state: "visible", timeout: 15_000 });
    await this.page.locator("lightning-spinner:visible").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
    await this.page.waitForTimeout(900);
  }

  private async enterGlobalSearch(inputSelector: string, submitSelector: string, value: string) {
    const field = this.page.locator(inputSelector).filter({ visible: true }).first();
    await field.waitFor({ state: "visible", timeout: 12_000 });
    await field.click();
    await field.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await field.press("Backspace");
    await field.type(value, { delay: 30 });
    if ((await field.inputValue()).trim() !== value.trim()) {
      throw new WorkerError(
        "Il codice fiscale non è stato scritto nella ricerca del gestionale. Lascia aperta la scheda Clienti e premi “Riprendi”.",
        "portal_error",
        { portal: "CRM", action: "person-search-input" },
        true,
      );
    }
    await this.submitGlobalSearch(inputSelector, submitSelector);
  }

  private async collectPersonMatches(confidence: "certain" | "possible", source: string, matchedPhone?: string) {
    const rows = this.page.locator(this.selectors.personResultRows);
    const matches: PersonMatchResult["matches"] = [];
    for (let index = 0; index < await rows.count(); index += 1) {
      const row = rows.nth(index);
      const id = await this.readRecordId(row, this.selectors.personResultId);
      if (!id || matches.some((match) => match.id === id)) continue;
      const target = row.locator(this.selectors.personResultOpen).first();
      matches.push({
        id,
        label: await this.readResultLabel(row, this.selectors.personResultLabel),
        confidence,
        data: { source, href: await target.getAttribute("href"), ...(matchedPhone ? { matchedPhone } : {}) },
      });
    }
    return matches;
  }

  private async openPerson(personId: string) {
    if (this.page.url().includes(`/s/account/${personId}`)) return;
    const fixtureRow = this.page.locator(this.selectors.personResultRows).filter({ has: this.page.locator(this.selectors.personResultId, { hasText: personId }) });
    if (await fixtureRow.count()) {
      await fixtureRow.first().locator(this.selectors.personResultOpen).first().click();
      return;
    }
    await this.page.goto(new URL(`${CRM_PATH}/account/${personId}`, this.page.url()).toString(), { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(900);
    await this.checkSession();
  }

  private async openProperty(propertyId: string) {
    if (this.page.url().includes(`/s/immobile/${propertyId}`)) return;
    await this.page.goto(new URL(`${CRM_PATH}/immobile/${propertyId}`, this.page.url()).toString(), { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(900);
    await this.checkSession();
  }

  private async readPropertyIdentity() {
    this.require("propertySheetValue", "propertyParcelValue", "propertySubalternValue");
    const read = async (selector: string) => (await this.page.locator(selector).first().textContent())?.trim() ?? "";
    return {
      sheet: await read(this.selectors.propertySheetValue),
      parcel: await read(this.selectors.propertyParcelValue),
      subaltern: await read(this.selectors.propertySubalternValue),
    };
  }

  async detectPage(): Promise<boolean> {
    this.require("pageMarker");
    await this.checkSession();
    return (await this.page.locator(this.selectors.pageMarker).count()) > 0;
  }

  async findPerson(input: PersonSearchInput): Promise<PersonMatchResult> {
    return this.friendly("person-search", "Non riesco a completare la ricerca del nominativo.", async () => {
      const manuallySelectedId = recordIdFromHref(this.page.url(), "account");
      this.require("personSearchPage", "personSearchTaxCode", "personSearchSubmit", "personResultRows", "personResultId", "personResultLabel", "personResultOpen");
      await this.page.locator(this.selectors.personSearchPage).first().click({ force: true });
      await this.page.waitForTimeout(700);
      await this.enterGlobalSearch(this.selectors.personSearchTaxCode, this.selectors.personSearchSubmit, input.taxCode);
      await this.checkSession();
      const matches = await this.collectPersonMatches("certain", "crm-tax-code-search");
      if (!matches.length && input.phones.length) {
        this.require("personSearchPhone");
        for (const phone of input.phones) {
          await this.enterGlobalSearch(this.selectors.personSearchPhone, this.selectors.personSearchSubmit, phone);
          await this.checkSession();
          for (const match of await this.collectPersonMatches("possible", "crm-phone-search", phone)) {
            if (!matches.some((current) => current.id === match.id)) matches.push(match);
          }
        }
      }
      const manuallySelected = manuallySelectedId ? matches.find((match) => match.id === manuallySelectedId) : undefined;
      return { matches: manuallySelected ? [{ ...manuallySelected, data: { ...manuallySelected.data, manuallySelected: true } }] : matches };
    });
  }

  private async fillPerson(person: NormalizedPerson) {
    const fields: Array<[keyof CrmSelectors, string]> = [
      ["personFullName", person.fullName], ["personBirthPlace", person.birthPlace ?? ""],
      ["personBirthProvince", person.birthProvince ?? ""], ["personBirthDate", person.birthDate ?? ""],
      ["personTaxCode", person.taxCode ?? ""], ["personMobile", person.mobiles[0] ?? ""],
      ["personOfficePhone", person.landlines[0] ?? ""],
      ["personOtherPhone", [...person.mobiles.slice(1), ...person.landlines.slice(1)][0] ?? ""],
      ["personEmail", person.emails[0] ?? ""],
    ];
    this.require(...fields.map(([key]) => key));
    for (const [key, value] of fields) if (value) await this.page.locator(this.selectors[key]).fill(value);
  }

  async createPerson(person: NormalizedPerson): Promise<string> {
    if (this.dryRun) return `dry-person-${person.taxCode ?? Date.now()}`;
    return this.friendly("person-create", "Non riesco a creare il nominativo.", async () => {
      this.require("personCreate", "personSave", "recordId");
      await this.page.locator(this.selectors.personCreate).click();
      await this.fillPerson(person);
      await this.page.locator(this.selectors.personSave).click();
      await this.checkSession();
      return (await this.page.locator(this.selectors.recordId).textContent())?.trim() ?? "";
    });
  }

  async updatePerson(id: string, person: NormalizedPerson): Promise<void> {
    if (this.dryRun) return;
    await this.friendly("person-update", "Non riesco ad aggiornare il nominativo.", async () => {
      await this.openPerson(id);
      await this.fillPerson(person);
      this.require("personSave");
      await this.page.locator(this.selectors.personSave).click();
      await this.checkSession();
    });
  }

  async findPropertyForPerson(personId: string, key: CadastralKey): Promise<PropertyMatchResult> {
    if (personId.startsWith("dry-person-")) return { match: null };
    return this.friendly("person-property-search", "Non riesco a leggere gli immobili collegati al nominativo.", async () => {
      this.require("personRelatedTab", "personPropertiesCard", "personPropertyLinks");
      await this.openPerson(personId);
      const relatedTab = this.page.locator(this.selectors.personRelatedTab).first();
      if (await relatedTab.count()) await relatedTab.click({ force: true });
      await this.page.waitForTimeout(700);
      const personUrl = this.page.url();
      const card = this.page.locator(this.selectors.personPropertiesCard).first();
      if (!(await card.count())) return { match: null };
      const hrefs = [...new Set((await card.locator(this.selectors.personPropertyLinks).evaluateAll((links) => links.map((link) => link.getAttribute("href")))).filter((href): href is string => Boolean(href)))];
      const matches: Array<{ id: string; data: Record<string, unknown> }> = [];
      for (const href of hrefs) {
        const isFixture = href.startsWith("#fixture-property");
        if (!isFixture) {
          await this.page.goto(new URL(href, personUrl).toString(), { waitUntil: "domcontentloaded" });
          await this.page.waitForTimeout(650);
        }
        const identity = await this.readPropertyIdentity();
        if (
          comparableCadastralValue(identity.sheet) === comparableCadastralValue(key.sheet)
          && comparableCadastralValue(identity.parcel) === comparableCadastralValue(key.parcel)
          && comparableCadastralValue(identity.subaltern) === comparableCadastralValue(key.subaltern)
        ) {
          const id = isFixture
            ? (await this.page.locator(this.selectors.propertyResultId).first().textContent())?.trim() ?? ""
            : recordIdFromHref(this.page.url(), "immobile") || recordIdFromHref(href, "immobile");
          matches.push({ id, data: { source: "crm-person-related-properties", ...identity, href } });
        }
      }
      if (matches.length > 1) throw new WorkerError("Il nominativo ha più immobili con gli stessi dati catastali. Seleziona manualmente quello corretto e premi “Riprendi”.", "needs_review", { portal: "CRM", personId, key, alternatives: matches }, true);
      if (!matches.length) await this.page.goto(personUrl, { waitUntil: "domcontentloaded" });
      return { match: matches[0] ?? null };
    });
  }

  private async fillProperty(property: NormalizedProperty) {
    const fields: Array<[keyof CrmSelectors, string]> = [
      ["propertyAddress", property.address ?? ""], ["propertyCategory", property.category],
      ["propertyClass", property.class ?? ""], ["propertyConsistency", property.consistency ?? ""],
      ["propertyIncome", property.cadastralIncome?.toString().replace(".", ",") ?? ""],
    ];
    this.require(...fields.map(([key]) => key));
    for (const [key, value] of fields) if (value) await this.page.locator(this.selectors[key]).fill(value);
  }

  async createProperty(property: NormalizedProperty): Promise<string> {
    if (this.dryRun) return `dry-property-${property.sheet}-${property.parcel}-${property.subaltern}`;
    return this.friendly("property-create", "Non riesco a creare l’immobile.", async () => {
      this.require("propertyCreate", "propertySave", "recordId");
      await this.page.locator(this.selectors.propertyCreate).click();
      await this.fillProperty(property);
      await this.page.locator(this.selectors.propertySave).click();
      await this.checkSession();
      return (await this.page.locator(this.selectors.recordId).textContent())?.trim() ?? "";
    });
  }

  async updateProperty(id: string, property: NormalizedProperty): Promise<void> {
    if (this.dryRun) return;
    await this.friendly("property-update", "Non riesco ad aggiornare l’immobile collegato.", async () => {
      await this.openProperty(id);
      await this.fillProperty(property);
      this.require("propertySave");
      await this.page.locator(this.selectors.propertySave).click();
      await this.checkSession();
    });
  }

  async createActivity(input: CrmActivityInput): Promise<string> {
    if (input.personId.startsWith("dry-") || input.propertyId.startsWith("dry-")) return `dry-activity-${input.propertyId}`;
    return this.friendly("activity-create", "Non riesco a preparare l’attività da eseguire.", async () => {
      this.require("personRelatedTab", "activityCard", "activityCreate", "activityDialog", "activityDescription", "activityStatus", "activityCancel", "activitySave");
      await this.openPerson(input.personId);
      const relatedTab = this.page.locator(this.selectors.personRelatedTab).first();
      if (await relatedTab.count()) await relatedTab.click({ force: true });
      await this.page.waitForTimeout(500);
      const card = this.page.locator(this.selectors.activityCard).first();
      await card.locator(this.selectors.activityCreate).first().click({ force: true });
      const dialog = this.page.locator(this.selectors.activityDialog).last();
      await dialog.waitFor({ state: "visible" });
      await dialog.locator(this.selectors.activityDescription).fill(input.description);
      const status = await dialog.locator(this.selectors.activityStatus).inputValue();
      if (!status.toLocaleLowerCase("it").includes("da eseguire")) {
        throw new WorkerError("Il modulo attività non è impostato su “Da eseguire”. Correggilo manualmente e premi “Riprendi”.", "needs_review", { portal: "CRM", action: "activity-status", currentStatus: status }, true);
      }
      if (this.dryRun) {
        await dialog.locator(this.selectors.activityCancel).first().click({ force: true });
        return `dry-activity-${input.propertyId}`;
      }
      this.require("activityRelatedProperty");
      const related = dialog.locator(this.selectors.activityRelatedProperty).first();
      await related.fill(input.propertyId);
      const option = this.page.locator('[role="option"]:visible').first();
      await option.waitFor({ state: "visible", timeout: 8_000 });
      await option.click();
      await dialog.locator(this.selectors.activitySave).first().click();
      await this.checkSession();
      return `activity-${Date.now()}`;
    });
  }

  async findLinkedOwnerIds(propertyId: string): Promise<string[]> {
    if (propertyId.startsWith("dry-")) return [];
    return this.friendly("property-owner-check", "Non riesco a controllare i comproprietari collegati all’immobile.", async () => {
      this.require("propertyOwnersCard", "propertyOwnerLinks");
      await this.openProperty(propertyId);
      const card = this.page.locator(this.selectors.propertyOwnersCard).first();
      if (!(await card.count())) return [];
      const hrefs = await card.locator(this.selectors.propertyOwnerLinks).evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      return [...new Set(hrefs.map((href) => recordIdFromHref(href, "account")).filter(Boolean))];
    });
  }

  async linkOwner(propertyId: string, personId: string, share: number): Promise<string> {
    if ((await this.findLinkedOwnerIds(propertyId)).includes(personId)) return `existing-link-${personId}`;
    if (this.dryRun) return `dry-link-${personId}`;
    return this.friendly("property-owner-link", "Non riesco a collegare il comproprietario.", async () => {
      this.require("propertyOwnersCard", "activityCreate", "activityDialog", "ownerPersonId", "ownerShare", "ownerSave");
      await this.openProperty(propertyId);
      const card = this.page.locator(this.selectors.propertyOwnersCard).first();
      await card.locator(this.selectors.activityCreate).first().click({ force: true });
      const dialog = this.page.locator(this.selectors.activityDialog).last();
      await dialog.locator(this.selectors.ownerPersonId).fill(personId);
      await dialog.locator(this.selectors.ownerShare).fill(formatShareForUi(share));
      await dialog.locator(this.selectors.ownerSave).first().click();
      await this.checkSession();
      return `owner-link-${Date.now()}`;
    });
  }
}
