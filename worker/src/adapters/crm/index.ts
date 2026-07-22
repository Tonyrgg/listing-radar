import type { Locator, Page } from "playwright";

import { SelectorConfigurationError, WorkerError } from "../../core/errors.js";
import { addressIdentity, formatPersonName, formatShareForUi, genderFromTaxCode, parsePropertyAddress, samePropertyAddress, splitPersonName } from "../../core/normalize.js";
import type {
  CrmActivityInput,
  CrmActivityResult,
  CrmAdapter,
  NormalizedPerson,
  NormalizedProperty,
  PersonCreationResult,
  PersonMatchResult,
  PersonMergeResult,
  PersonSearchInput,
  PropertyMatchResult,
} from "../../types.js";
import { crmSelectors, type CrmSelectors } from "./selectors.js";

const CRM_PATH = "/CRMImmobiliareLightning/s";
const ACTIVITY_FORM_TIMEOUT = 20_000;
const ACTIVITY_PRE_SAVE_ATTEMPTS = 3;

function normalizedUiText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function activityRelationMatchesProperty(value: string, expectedAddress: string | null) {
  if (!/^\s*IM\s*-/i.test(value)) return false;
  if (!expectedAddress) return true;
  const identity = addressIdentity(expectedAddress);
  if (!identity) return true;
  const relation = normalizedUiText(value);
  const street = normalizedUiText(identity.street);
  const civic = normalizedUiText(identity.civic);
  return relation.includes(street) && relation.split(" ").includes(civic);
}

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

  private visible(selector: string) {
    return this.page.locator(selector).filter({ visible: true });
  }

  private async uniqueVisible(key: keyof CrmSelectors, label: string, timeout = 12_000): Promise<Locator> {
    this.require(key);
    const locator = this.visible(this.selectors[key]);
    await locator.first().waitFor({ state: "visible", timeout });
    const count = await locator.count();
    if (count !== 1) {
      throw new WorkerError(
        `Il gestionale mostra ${count} elementi per “${label}”. Il worker non sceglie un elemento ambiguo.`,
        "needs_review",
        { portal: "CRM", action: "unique-visible-element", selectorKey: key, count },
        true,
      );
    }
    return locator.first();
  }

  private async isActivityFormOpen() {
    if (!this.selectors.activityDialog || !this.selectors.activityDescription || !this.selectors.activityCancel) return false;
    const dialogs = this.visible(this.selectors.activityDialog);
    if (!(await dialogs.count())) return false;
    const descriptions = this.visible(this.selectors.activityDescription);
    if (!(await descriptions.count())) {
      await descriptions.first().waitFor({ state: "visible", timeout: 4_000 }).catch(() => undefined);
    }
    return (await descriptions.count()) > 0 && (await this.visible(this.selectors.activityCancel).count()) > 0;
  }

  private async closeKnownStaleActivityForm() {
    if (!(await this.isActivityFormOpen())) return false;
    const description = await this.uniqueVisible("activityDescription", "Descrizione attività", 5_000);
    const currentDescription = (await description.inputValue()).trim();
    if (currentDescription && normalizedUiText(currentDescription) !== normalizedUiText("Inserire attività")) {
      throw new WorkerError(
        "È aperta un’attività compilata manualmente. Il worker la lascia intatta: completala o annullala, poi premi “Riprendi”.",
        "needs_review",
        { portal: "CRM", action: "dirty-activity-modal" },
        true,
      );
    }
    const cancel = await this.uniqueVisible("activityCancel", "Annulla attività", 5_000);
    await cancel.click().catch(async () => this.page.keyboard.press("Escape"));
    await description.waitFor({ state: "hidden", timeout: 10_000 });
    return true;
  }

  private async ensureCrmIdle() {
    await this.checkSession();
    await this.closeKnownStaleActivityForm();
    this.require("blockingDialog");
    const remainingDialogs = this.visible(this.selectors.blockingDialog);
    if (await remainingDialogs.count()) {
      throw new WorkerError(
        "Nel gestionale è aperta una finestra diversa dall’attività del worker. Per sicurezza non viene chiusa automaticamente.",
        "needs_review",
        { portal: "CRM", action: "unknown-blocking-dialog", dialogCount: await remainingDialogs.count() },
        true,
      );
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
    if (this.selectors.loadingSpinner) {
      await this.visible(this.selectors.loadingSpinner).first().waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
    }
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
    await this.ensureCrmIdle();
    if (this.page.url().includes(`/s/account/${personId}`)) {
      if (this.selectors.personRelatedTab) {
        await this.visible(this.selectors.personRelatedTab).first().waitFor({ state: "visible", timeout: 15_000 });
      }
      return;
    }
    const fixtureRow = this.page.locator(this.selectors.personResultRows).filter({ has: this.page.locator(this.selectors.personResultId, { hasText: personId }) });
    if (await fixtureRow.count()) {
      await fixtureRow.first().locator(this.selectors.personResultOpen).first().click();
      return;
    }
    await this.page.goto(new URL(`${CRM_PATH}/account/${personId}`, this.page.url()).toString(), { waitUntil: "domcontentloaded" });
    await this.checkSession();
    if (this.selectors.personRelatedTab) {
      await this.visible(this.selectors.personRelatedTab).first().waitFor({ state: "visible", timeout: 15_000 });
    }
  }

  private async openProperty(propertyId: string, refresh = false) {
    await this.ensureCrmIdle();
    const alreadyOpen = this.page.url().includes(`/s/immobile/${propertyId}`);
    if (alreadyOpen && refresh) await this.page.reload({ waitUntil: "domcontentloaded" });
    else if (!alreadyOpen) {
      await this.page.goto(new URL(`${CRM_PATH}/immobile/${propertyId}`, this.page.url()).toString(), { waitUntil: "domcontentloaded" });
    }
    await this.checkSession();
    this.require("propertyAddressValue");
    await this.visible(this.selectors.propertyAddressValue).first().waitFor({ state: "visible", timeout: 20_000 });
  }

  private async readPropertyIdentity() {
    this.require("propertySheetValue", "propertyParcelValue", "propertySubalternValue", "propertyAddressValue");
    const read = async (selector: string) => (await this.page.locator(selector).first().textContent())?.trim() ?? "";
    const rawAddress = await read(this.selectors.propertyAddressValue);
    const parsedAddress = parsePropertyAddress(rawAddress);
    return {
      sheet: await read(this.selectors.propertySheetValue),
      parcel: await read(this.selectors.propertyParcelValue),
      subaltern: await read(this.selectors.propertySubalternValue),
      address: parsedAddress.address,
      internal: parsedAddress.internal,
      rawAddress,
    };
  }

  private async currentPersonId() {
    const fromUrl = recordIdFromHref(this.page.url(), "account");
    if (fromUrl) return fromUrl;
    if (!this.selectors.recordId) return "";
    return (await this.page.locator(this.selectors.recordId).first().textContent())?.trim() ?? "";
  }

  async detectPage(): Promise<boolean> {
    this.require("pageMarker");
    await this.checkSession();
    return (await this.page.locator(this.selectors.pageMarker).count()) > 0;
  }

  async findPerson(input: PersonSearchInput): Promise<PersonMatchResult> {
    return this.friendly("person-search", "Non riesco a completare la ricerca del nominativo.", async () => {
      this.require("personSearchPage", "personSearchTaxCode", "personSearchSubmit", "personResultRows", "personResultId", "personResultLabel", "personResultOpen");
      await this.ensureCrmIdle();
      const navigation = await this.uniqueVisible("personSearchPage", "sezione Nominativi");
      const href = await navigation.getAttribute("href");
      await navigation.click();
      const navigated = href
        ? await this.page.waitForURL(/\/s\/account\/Account(?:[/?#]|$)/i, { timeout: 10_000 }).then(() => true).catch(() => false)
        : true;
      if (!navigated && href) {
        await this.page.goto(new URL(href, this.page.url()).toString(), { waitUntil: "domcontentloaded" });
      }
      await this.uniqueVisible("personSearchTaxCode", "ricerca nominativi", 15_000);
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
      return { matches };
    });
  }

  private async personField(key: keyof CrmSelectors, label: string, timeout = 8_000) {
    this.require(key);
    const fields = this.visible(this.selectors[key]);
    try {
      await fields.first().waitFor({ state: "visible", timeout });
    } catch {
      throw new WorkerError(
        `Non trovo il campo “${label}” nella finestra del nominativo.`,
        "portal_error",
        { portal: "CRM", action: "person-field-missing", selectorKey: key, label },
        true,
      );
    }
    const count = await fields.count();
    if (count !== 1) {
      throw new WorkerError(
        `La finestra del nominativo mostra ${count} campi “${label}”.`,
        "portal_error",
        { portal: "CRM", action: "person-field-ambiguous", selectorKey: key, label, count },
        true,
      );
    }
    return fields.first();
  }

  private async fillPersonText(key: keyof CrmSelectors, label: string, value: string) {
    if (!value || !this.selectors[key]) return;
    const field = await this.personField(key, label);
    try {
      await field.fill(value);
    } catch (error) {
      throw new WorkerError(
        `Non riesco a compilare il campo “${label}”.`,
        "portal_error",
        { portal: "CRM", action: "person-field-fill", selectorKey: key, label, technicalError: error instanceof Error ? error.message : String(error) },
        true,
      );
    }
  }

  private async selectPersonGender(person: NormalizedPerson) {
    const gender = genderFromTaxCode(person.taxCode);
    if (!gender || !this.selectors.personGender) return;
    const field = await this.personField("personGender", "Sesso");
    await field.click();
    const options = this.visible(this.selectors.personGenderOption);
    await options.first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
    const labels = (await options.allTextContents()).map((value) => value.trim().toUpperCase());
    const index = labels.findIndex((value) => value === gender);
    if (index >= 0) await options.nth(index).click();
    else if (await field.isEditable()) await field.fill(gender);
    else throw new WorkerError("Non riesco a selezionare il sesso ricavato dal codice fiscale.", "portal_error", { portal: "CRM", action: "person-gender", gender }, true);
  }

  private async selectPersonBirthPlace(person: NormalizedPerson) {
    if (!person.birthPlace || !this.selectors.personBirthPlace) return;
    const field = await this.personField("personBirthPlace", "Luogo di nascita");
    const formattedPlace = formatPersonName(person.birthPlace);
    await field.fill("");
    await field.pressSequentially(formattedPlace, { delay: 70 });
    const options = this.visible(this.selectors.personBirthPlaceOption);
    await options.first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
    const labels = await options.allTextContents();
    const place = normalizedUiText(person.birthPlace);
    const province = normalizedUiText(person.birthProvince);
    const exactIndexes = labels.flatMap((value, index) => normalizedUiText(value) === place ? [index] : []);
    const matchingIndexes = labels.flatMap((value, index) => {
      const normalized = normalizedUiText(value);
      return normalized.startsWith(`${place} `) ? [index] : [];
    });
    const provinceMatch = province
      ? matchingIndexes.find((index) => normalizedUiText(labels[index]).includes(province))
      : undefined;
    const selectedIndex = exactIndexes[0] ?? provinceMatch ?? matchingIndexes[0] ?? (labels.length === 1 ? 0 : -1);
    if (selectedIndex >= 0) {
      await options.nth(selectedIndex).click();
      return;
    }
    await field.press("ArrowDown");
    await field.press("Enter");
    await this.page.waitForTimeout(300);
    if (await this.visible(this.selectors.personBirthPlaceOption).count() === 0) return;
    throw new WorkerError(
      `Non riesco a selezionare automaticamente “${formattedPlace}” nel menu del luogo di nascita.`,
      "portal_error",
      { portal: "CRM", action: "person-birth-place", birthPlace: person.birthPlace, birthProvince: person.birthProvince, alternatives: labels },
      true,
    );
  }

  private async fillPerson(person: NormalizedPerson) {
    const name = splitPersonName(person.fullName, person.taxCode);
    if (this.selectors.personFirstName && this.selectors.personLastName && !name.verified) {
      throw new WorkerError("Nome e cognome non sono separabili con certezza tramite il codice fiscale. Correggi manualmente l’anagrafica e premi “Riprendi”.", "needs_review", { portal: "CRM", action: "person-name-split" });
    }
    const uiBirthDate = person.birthDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      ? person.birthDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1")
      : person.birthDate ?? "";
    const fields: Array<[keyof CrmSelectors, string, string]> = [
      ...(this.selectors.personFirstName && this.selectors.personLastName
        ? [["personFirstName", "Nome", formatPersonName(name.firstName)], ["personLastName", "Cognome", formatPersonName(name.lastName)]] as Array<[keyof CrmSelectors, string, string]>
        : [["personFullName", "Nominativo", formatPersonName(person.fullName)]] as Array<[keyof CrmSelectors, string, string]>),
      ["personEmail", "Email", person.emails[0] ?? ""],
      ["personMobile", "Cellulare", person.mobiles[0] ?? ""],
      ["personOfficePhone", "Telefono fisso", person.landlines[0] ?? ""],
      ["personOtherPhone", "Altro telefono", [...person.mobiles.slice(1), ...person.landlines.slice(1)][0] ?? ""],
    ];
    for (const [key, label, value] of fields) await this.fillPersonText(key, label, value);
    await this.selectPersonGender(person);
    await this.selectPersonBirthPlace(person);
    await this.fillPersonText("personBirthProvince", "Provincia di nascita", person.birthProvince ?? "");
    await this.fillPersonText("personBirthDate", "Data di nascita", uiBirthDate);
    await this.fillPersonText("personTaxCode", "Codice fiscale", person.taxCode ?? "");
  }

  async createPerson(person: NormalizedPerson, duplicateCandidateIds: string[] = [], onBeforeSave?: () => Promise<void>): Promise<PersonCreationResult> {
    if (this.dryRun) return {
      personId: `dry-person-${person.taxCode ?? Date.now()}`,
      mergeStatus: duplicateCandidateIds.length ? "simulated" : "not_required",
      details: { duplicateCandidateIds, dryRun: true },
    };
    return this.friendly("person-create", "Non riesco a creare il nominativo.", async () => {
      this.require("personCreate", "personCreateMenuItem", "personSave");
      const personFormAlreadyOpen = await this.visible(this.selectors.personSave).count() === 1
        && await this.visible(this.selectors.personFirstName || this.selectors.personFullName).count() >= 1
        && await this.visible(this.selectors.personLastName || this.selectors.personFullName).count() >= 1;
      if (!personFormAlreadyOpen) {
        await this.page.locator(this.selectors.personCreate).click();
        const menuItem = this.page.locator(this.selectors.personCreateMenuItem).filter({ visible: true }).first();
        await menuItem.waitFor({ state: "visible", timeout: 8_000 });
        await menuItem.click();
      }
      await this.fillPerson(person);
      await onBeforeSave?.();
      await this.page.locator(this.selectors.personSave).click();
      await this.checkSession();
      const mergeSelectorsConfigured = ["personMergeDialog", "personMergeReady", "personMergeBlocked", "personMergeConfirm", "personMergeMessage"]
        .every((key) => Boolean(this.selectors[key as keyof CrmSelectors]));
      if (duplicateCandidateIds.length && !mergeSelectorsConfigured) {
        return {
          personId: null,
          mergeStatus: "pending",
          details: { duplicateCandidateIds, calibrationRequired: true, message: "Merge non confermato: controllo manuale richiesto" },
        };
      }
      if (duplicateCandidateIds.length && await this.page.locator(this.selectors.personMergeDialog).filter({ visible: true }).count()) {
        const merge = await this.inspectPersonMerge();
        return { personId: merge.personId, mergeStatus: merge.status, details: { ...merge.details, duplicateCandidateIds } };
      }
      const personId = await this.currentPersonId();
      if (!personId) throw new WorkerError("Il gestionale ha salvato il nominativo ma non espone il suo identificativo. Apri la scheda creata e premi “Riprendi”.", "needs_review", { portal: "CRM", action: "person-create-record-id" }, true);
      return { personId, mergeStatus: "not_required", details: { duplicateCandidateIds } };
    });
  }

  async inspectPersonMerge(): Promise<PersonMergeResult> {
    return this.friendly("person-merge-inspect", "Non riesco a verificare l’esito del merge nominativi.", async () => {
      const required: Array<keyof CrmSelectors> = ["personMergeDialog", "personMergeReady", "personMergeBlocked", "personMergeMessage"];
      if (required.some((key) => !this.selectors[key])) {
        const personId = await this.currentPersonId();
        return personId
          ? { status: "completed", personId, message: "Merge completato manualmente", details: { source: "crm-current-person", calibrationRequired: true } }
          : { status: "pending", personId: null, message: "La finestra di merge non è ancora calibrata. Verifica l’esito nel gestionale e completa il merge manualmente", details: { pageUrl: this.page.url(), calibrationRequired: true } };
      }
      const dialog = this.page.locator(this.selectors.personMergeDialog).filter({ visible: true }).last();
      if (!(await dialog.count())) {
        const personId = await this.currentPersonId();
        return personId
          ? { status: "completed", personId, message: "Merge completato o risolto manualmente", details: { source: "crm-current-person" } }
          : { status: "pending", personId: null, message: "La finestra di merge non è riconoscibile", details: { pageUrl: this.page.url() } };
      }
      const message = (await dialog.locator(this.selectors.personMergeMessage).first().textContent())?.trim() ?? "";
      if (await dialog.locator(this.selectors.personMergeBlocked).filter({ visible: true }).count()) {
        return { status: "blocked", personId: null, message: message || "Il Cloud segnala problemi nel merge", details: { source: "crm-merge-dialog" } };
      }
      if (await dialog.locator(this.selectors.personMergeReady).filter({ visible: true }).count()) {
        return { status: "ready", personId: null, message: message || "Il Cloud non segnala problemi nel merge", details: { source: "crm-merge-dialog" } };
      }
      return { status: "pending", personId: null, message: message || "Il Cloud non ha ancora concluso il controllo del merge", details: { source: "crm-merge-dialog" } };
    });
  }

  async confirmPersonMerge(): Promise<PersonMergeResult> {
    return this.friendly("person-merge-confirm", "Non riesco a confermare il merge nominativi.", async () => {
      const inspection = await this.inspectPersonMerge();
      if (inspection.status !== "ready") return inspection;
      this.require("personMergeDialog", "personMergeConfirm");
      const dialog = this.page.locator(this.selectors.personMergeDialog).filter({ visible: true }).last();
      await dialog.locator(this.selectors.personMergeConfirm).first().click();
      await dialog.waitFor({ state: "hidden", timeout: 15_000 });
      await this.checkSession();
      const personId = await this.currentPersonId();
      if (!personId) return { status: "pending", personId: null, message: "Merge confermato, identificativo finale non ancora disponibile", details: { source: "crm-merge-confirm" } };
      return { status: "completed", personId, message: "Merge completato", details: { source: "crm-merge-confirm" } };
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

  async findPropertyForPerson(personId: string, property: NormalizedProperty): Promise<PropertyMatchResult> {
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
        const cadastralMatch = comparableCadastralValue(identity.sheet) === comparableCadastralValue(property.sheet)
          && comparableCadastralValue(identity.parcel) === comparableCadastralValue(property.parcel)
          && comparableCadastralValue(identity.subaltern) === comparableCadastralValue(property.subaltern);
        const addressMatch = samePropertyAddress(identity.rawAddress, property.address);
        if (cadastralMatch || addressMatch) {
          const id = isFixture
            ? (await this.page.locator(this.selectors.propertyResultId).first().textContent())?.trim() ?? ""
            : recordIdFromHref(this.page.url(), "immobile") || recordIdFromHref(href, "immobile");
          const sisterAddress = addressIdentity(property.address);
          matches.push({
            id,
            data: {
              source: "crm-person-related-properties",
              matchedBy: cadastralMatch
                ? "cadastral"
                : identity.internal && sisterAddress?.internal ? "street-civic-and-internal" : "street-and-civic",
              ...identity,
              href,
            },
          });
        }
      }
      if (matches.length > 1) throw new WorkerError("Il nominativo ha più immobili compatibili per dati catastali oppure via e civico. Seleziona manualmente quello corretto e premi “Riprendi”.", "needs_review", { portal: "CRM", personId, property, alternatives: matches }, true);
      if (!matches.length) await this.page.goto(personUrl, { waitUntil: "domcontentloaded" });
      return { match: matches[0] ?? null };
    });
  }

  private async fillProperty(property: NormalizedProperty) {
    const fields: Array<[keyof CrmSelectors, string]> = [
      ["propertyAddress", property.address ?? ""], ["propertySheet", property.sheet],
      ["propertyParcel", property.parcel], ["propertySubaltern", property.subaltern], ["propertyCategory", property.category],
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

  async createPropertyActivity(input: CrmActivityInput): Promise<CrmActivityResult> {
    if (input.propertyId.startsWith("dry-")) {
      return {
        outcome: "simulated",
        crmActivityId: `dry-activity-${input.propertyId}`,
        correlatedProperty: input.propertyAddress ?? input.propertyId,
        attempts: 0,
      };
    }
    return this.friendly("property-activity-create", "Non riesco a preparare l’attività dell’immobile.", async () => {
      this.require(
        "activityCard", "activityCreate", "activityDialog", "activityDescription", "activityClient",
        "activityRelatedProperty", "activityStatus", "activityOption", "activityCancel", "activitySave",
      );
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= ACTIVITY_PRE_SAVE_ATTEMPTS; attempt += 1) {
        let saveClicked = false;
        try {
          await this.openProperty(input.propertyId, attempt > 1);
          const card = await this.uniqueVisible("activityCard", "riquadro Attività e appuntamenti", 20_000);
          const createButtons = card.locator(this.selectors.activityCreate).filter({ visible: true });
          const createCount = await createButtons.count();
          if (createCount !== 1) {
            throw new WorkerError(
              `Nel riquadro dell’immobile risultano ${createCount} pulsanti “Nuovo”.`,
              "needs_review",
              { portal: "CRM", action: "property-activity-create-button", propertyId: input.propertyId, createCount },
              true,
            );
          }
          await createButtons.first().click();

          // The c-lwc-modal host is zero-sized in production. Wait for the
          // rendered controls, which appear only after the internal spinner.
          await this.uniqueVisible("activityDialog", "finestra Attività", ACTIVITY_FORM_TIMEOUT);
          const description = await this.uniqueVisible("activityDescription", "Descrizione attività", ACTIVITY_FORM_TIMEOUT);
          const relatedField = await this.uniqueVisible("activityRelatedProperty", "Correlato a", ACTIVITY_FORM_TIMEOUT);
          const relatedInputs = relatedField.locator("input").filter({ visible: true });
          if (await relatedInputs.count() !== 1) {
            throw new WorkerError(
              "Il campo “Correlato a” dell’attività non è univoco.",
              "needs_review",
              { portal: "CRM", action: "property-activity-related-field", propertyId: input.propertyId },
              true,
            );
          }
          const relatedInput = relatedInputs.first();
          let correlatedProperty = (await relatedInput.inputValue()).trim();
          if (!activityRelationMatchesProperty(correlatedProperty, input.propertyAddress)) {
            await relatedInput.click();
            const propertyOptions = this.visible(this.selectors.activityOption).filter({ hasText: "IM -" });
            await propertyOptions.first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
            const optionCount = await propertyOptions.count();
            if (optionCount === 1) await propertyOptions.first().click();
            correlatedProperty = (await relatedInput.inputValue()).trim();
          }
          if (!activityRelationMatchesProperty(correlatedProperty, input.propertyAddress)) {
            throw new WorkerError(
              "L’attività non risulta correlata all’immobile aperto. Il worker non salva collegamenti incerti.",
              "needs_review",
              { portal: "CRM", action: "property-activity-correlation", propertyId: input.propertyId, correlatedProperty },
              true,
            );
          }

          // Cliente remains a mandatory CRM field, but it is not the origin of
          // the activity: navigation and correlation both stay on the property.
          const client = await this.uniqueVisible("activityClient", "Cliente dell’attività", ACTIVITY_FORM_TIMEOUT);
          const clientValue = (await client.inputValue()).trim();
          if (!clientValue) {
            throw new WorkerError(
              "Il gestionale non ha precompilato il Cliente obbligatorio dell’attività. L’immobile resta comunque l’origine e il correlato.",
              "needs_review",
              { portal: "CRM", action: "property-activity-client", propertyId: input.propertyId, fallbackPersonId: input.fallbackPersonId ?? null },
              true,
            );
          }

          await description.fill(input.description);
          const status = await this.uniqueVisible("activityStatus", "Stato attività", ACTIVITY_FORM_TIMEOUT);
          let currentStatus = (await status.inputValue()).trim();
          if (normalizedUiText(currentStatus) !== normalizedUiText(input.status)) {
            await status.click();
            const desiredOptions = this.visible(this.selectors.activityOption).filter({ hasText: input.status });
            await desiredOptions.first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
            const desiredCount = await desiredOptions.count();
            if (desiredCount === 1) await desiredOptions.first().click();
            currentStatus = (await status.inputValue()).trim();
          }
          if (normalizedUiText(currentStatus) !== normalizedUiText(input.status)) {
            throw new WorkerError(
              `Il modulo attività non può essere impostato automaticamente su “${input.status}”.`,
              "needs_review",
              { portal: "CRM", action: "property-activity-status", propertyId: input.propertyId, currentStatus },
              true,
            );
          }

          if (this.dryRun) {
            const cancel = await this.uniqueVisible("activityCancel", "Annulla attività", 8_000);
            await cancel.click().catch(async () => this.page.keyboard.press("Escape"));
            await description.waitFor({ state: "hidden", timeout: 10_000 });
            return {
              outcome: "simulated",
              crmActivityId: `dry-activity-${input.propertyId}`,
              correlatedProperty,
              attempts: attempt,
            };
          }

          const save = await this.uniqueVisible("activitySave", "Salva attività", 8_000);
          saveClicked = true;
          await save.click();
          await description.waitFor({ state: "hidden", timeout: 15_000 });
          await this.checkSession();
          return { outcome: "created", crmActivityId: null, correlatedProperty, attempts: attempt };
        } catch (error) {
          if (saveClicked) {
            throw new WorkerError(
              "Il salvataggio dell’attività è stato inviato, ma l’esito non è verificabile. Il worker non ripete il salvataggio per evitare duplicati.",
              "needs_review",
              { portal: "CRM", action: "property-activity-save-uncertain", propertyId: input.propertyId, attempt, technicalError: error instanceof Error ? error.message : String(error) },
              true,
            );
          }
          if (error instanceof WorkerError && error.status !== "portal_error") throw error;
          lastError = error;
          await this.closeKnownStaleActivityForm().catch(() => undefined);
          if (attempt === ACTIVITY_PRE_SAVE_ATTEMPTS) break;
        }
      }
      throw new WorkerError(
        `Il gestionale non ha preparato l’attività dell’immobile dopo ${ACTIVITY_PRE_SAVE_ATTEMPTS} tentativi automatici.`,
        "portal_error",
        {
          portal: "CRM",
          action: "property-activity-pre-save-retries-exhausted",
          propertyId: input.propertyId,
          attempts: ACTIVITY_PRE_SAVE_ATTEMPTS,
          technicalError: lastError instanceof Error ? lastError.message : String(lastError),
          pageUrl: this.page.url(),
        },
        true,
      );
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
