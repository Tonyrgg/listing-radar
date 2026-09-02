import type { Locator, Page } from "playwright";

import { ImportV2Error } from "./errors.js";
import { canonicalTaxCode, sameAddress } from "./identity.js";
import { isManagedCrmOwnership, isPrivateFiscalCode, normalizedOwnershipRight } from "./ownership-policy.js";
import type {
  CadastralIdentity,
  CrmOwnershipSnapshot,
  CrmPersonSnapshot,
  CrmPropertySnapshot,
  CrmPropertySummary,
  ImportV2Checkpoint,
  ImportV2Plan,
  PersonWriteModel,
} from "./public-types.js";
import type { CrmOwnershipSnapshotResult, MergeRequest, OwnershipWrite, TecnocloudV2Port } from "./ports.js";

const CRM_ROOT = "/CRMImmobiliareLightning/s";
const ACCOUNT_LIST = `${CRM_ROOT}/account/Account`;
const PROPERTY_LIST = `${CRM_ROOT}/immobile/Immobile__c`;
const PROPERTY_SEARCH = `${CRM_ROOT}/immobile/Immobile__c/Default?queryId=a0Q3Y00000ecOpjUAE`;

function normalized(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

function recordIdFromUrl(rawUrl: string, entity: "account" | "immobile"): string | null {
  const match = new URL(rawUrl).pathname.match(new RegExp(`/s/${entity}/([^/?#]+)`, "i"));
  const value = match?.[1] ?? "";
  return value && normalized(value) !== normalized(entity === "account" ? "Account" : "Immobile__c") ? value : null;
}

function uiDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function isoDate(value: string): string | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value.trim() || null;
}

function decimalValue(value: string): number | null {
  const cleaned = value.replace(/[^0-9,.-]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDecimal(value: number | null): string {
  if (value == null) return "";
  return new Intl.NumberFormat("it-IT", { useGrouping: false, maximumFractionDigits: 2 }).format(value);
}

export type LookupCommitEvidence = {
  value: string;
  expected: string;
  visibleOptionCount: number;
  optionMarkedSelected: boolean;
  readonly: boolean;
  hasSelectionClass: boolean;
  dependentFieldsVisible: boolean;
};

/**
 * Text and a closed result list are not proof: Lightning leaves both behind
 * after a lookup search.  A committed lookup observed in Tecnocloud has two
 * independent signals: the input becomes readonly and its container gets
 * `slds-has-selection`.
 */
export function lookupCommitConfirmed(evidence: LookupCommitEvidence): boolean {
  return normalized(evidence.value).includes(normalized(evidence.expected))
    && evidence.dependentFieldsVisible
    && evidence.readonly
    && evidence.hasSelectionClass;
}

/** A submitted relationship is not real until the property card exposes it. */
export function ownershipSyncConfirmed(actual: CrmOwnershipSnapshot[], desired: OwnershipWrite[]): boolean {
  const managed = actual.filter(isManagedCrmOwnership);
  if (managed.length !== desired.length) return false;
  return desired.every((expected) => {
    const found = managed.find((candidate) => candidate.personId === expected.personId);
    if (!found || normalized(found.role) !== normalized(expected.role)) return false;
    return found.sharePercentage == null || expected.sharePercentage == null
      ? found.sharePercentage == null && expected.sharePercentage == null
      : Math.abs(found.sharePercentage - expected.sharePercentage) < 0.01;
  });
}

function propertyDraft(plan: ImportV2Plan) {
  const raw = plan.source.fullAddress.replace(/,\s*\d{5}\s+.+?\s*\([A-Z]{2}\)\s*$/i, "").trim();
  const internal = raw.match(/\[\s*([^\]]+)\s*\]\s*$/)?.[1]
    ?? raw.match(/\bINTERNO\s+([A-Z0-9/-]+)/i)?.[1]
    ?? ".";
  const floorToken = raw.match(/\bPIANO\s+((?:T|S\d+|\d+)(?:\s*-\s*(?:T|S\d+|\d+))*)/i)?.[1]?.replace(/\s+/g, "").toUpperCase() ?? "";
  const base = raw.replace(/\s+(?:EDIFICIO|SCALA|INTERNO|PIANO)\b.*$/i, "").replace(/\[\s*[^\]]+\s*\]\s*$/, "").trim();
  const match = base.match(/^(.*?)\s+(?:N(?:\.|°|º)?\s*)?(\d+)(?:\s*\/?\s*([A-Z]))?$/i);
  const street = match?.[1]?.trim() ?? base;
  const civic = match?.[2] ?? ".";
  const letter = match?.[3]?.toUpperCase() ?? "";
  const category = plan.source.category.toUpperCase().replace(/\s+/g, "").replace(/^([AC])(\d)/, "$1/$2");
  const rooms = Number(plan.source.consistency?.replace(",", ".").match(/\d+(?:\.\d+)?/)?.[0] ?? 0);
  const type = category.startsWith("A/") ? "Appartamenti" : "Box / posti auto";
  const subtype = type === "Appartamenti"
    ? rooms <= 3 ? "Monolocale" : rooms >= 9 ? "Multilocale" : `${Math.max(2, Math.ceil(rooms - 2))} locali`
    : category === "C/6" ? "Posto auto" : "Box";
  let floor = "";
  let floorNumber = "";
  if (floorToken.includes("-")) floor = "Su più livelli";
  else if (floorToken === "T") floor = "Terra";
  else if (/^S\d+$/.test(floorToken)) { floor = "Seminterrato"; floorNumber = `-${Number(floorToken.slice(1))}`; }
  else if (/^\d+$/.test(floorToken)) {
    floorNumber = floorToken;
    floor = Number(floorToken) <= 2 ? "Basso" : Number(floorToken) <= 4 ? "Medio" : "Alto";
  }
  return { street, civic, letter, internal, floor, floorNumber, type, subtype };
}

export class TecnocloudUiV2Port implements TecnocloudV2Port {
  private readonly submittedActivities = new Set<string>();
  private readonly virtualPeople = new Map<string, CrmPersonSnapshot>();
  private readonly virtualProperties = new Map<string, CrmPropertySnapshot>();
  /* La risoluzione e la sincronizzazione sono due checkpoint distinti e, in
   * assenza di questa cache, cercavano immediatamente due volte lo stesso CF.
   * È volutamente solo in memoria: dopo un riavvio non sopravvive e quindi non
   * può trasformare una vecchia lettura in un'istruzione di scrittura. */
  private readonly personSearchCache = new Map<string, CrmPersonSnapshot[]>();

  constructor(private readonly page: Page, private readonly dryRun = false) {}

  async assertSession(): Promise<void> {
    const url = this.page.url();
    const loginUrl = /(login|signin|accesso|autenticazione|logout-success|sessione[_-]?scaduta)/i.test(url);
    const password = await this.page.locator('input[type="password"]').filter({ visible: true }).count();
    if (loginUrl || password) {
      throw new ImportV2Error("Sessione Tecnocloud scaduta", "global_session", { global: true });
    }
    if (!/tecnocasa-group\.my\.site\.com/i.test(url)) {
      throw new ImportV2Error("Scheda Tecnocloud non riconosciuta", "global_portal", { global: true });
    }
  }

  private async action<T>(label: string, operation: () => Promise<T>): Promise<T> {
    try {
      await this.assertSession();
      return await operation();
    } catch (error) {
      if (error instanceof ImportV2Error) throw error;
      await this.assertSession();
      throw new ImportV2Error(`${label}: ${error instanceof Error ? error.message : String(error)}`, "transient_portal", {
        retryable: true,
      });
    }
  }

  private url(pathname: string): string {
    return new URL(pathname, this.page.url()).toString();
  }

  private async navigate(pathname: string): Promise<void> {
    await this.page.goto(this.url(pathname), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await this.assertSession();
  }

  private async one(locator: Locator, label: string, timeout = 15_000): Promise<Locator> {
    await locator.first().waitFor({ state: "visible", timeout });
    const count = await locator.count();
    if (count !== 1) {
      throw new ImportV2Error(`${label} non univoco (${count})`, "transient_portal", { retryable: true });
    }
    return locator.first();
  }

  private async waitForPersonRecord(): Promise<string> {
    await this.page.waitForURL((url) => Boolean(recordIdFromUrl(url.toString(), "account")), { timeout: 25_000 });
    const id = recordIdFromUrl(this.page.url(), "account");
    if (!id) throw new ImportV2Error("Identificativo nominativo non disponibile dopo il salvataggio", "verification_failed", { retryable: true });
    return id;
  }

  private personUrl(personId: string): string {
    return this.url(`${CRM_ROOT}/account/${encodeURIComponent(personId)}`);
  }

  private async openPerson(personId: string): Promise<void> {
    if (recordIdFromUrl(this.page.url(), "account") !== personId) {
      await this.page.goto(this.personUrl(personId), { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await this.assertSession();
    await this.page.locator("body").waitFor({ state: "visible", timeout: 10_000 });
  }

  private async detailValue(label: string): Promise<string> {
    const labels = this.page.locator("label").filter({ hasText: label }).filter({ visible: true });
    const exactIndexes: number[] = [];
    for (let index = 0; index < await labels.count(); index += 1) {
      if (normalized(await labels.nth(index).innerText().catch(() => "")) === normalized(label)) exactIndexes.push(index);
    }
    if (exactIndexes.length !== 1) return "";
    let row = labels.nth(exactIndexes[0]!).locator("xpath=../..");
    for (let depth = 0; depth < 4; depth += 1) {
      const value = row.locator(".slds-form-element__static .slds-grow, .slds-form-element__static, c-output-field").filter({ visible: true });
      if (await value.count()) {
        const text = (await value.first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
        if (text && normalized(text) !== normalized(label)) return text;
      }
      row = row.locator("xpath=..");
    }
    return "";
  }

  private async readCurrentPerson(personId: string): Promise<CrmPersonSnapshot> {
    await this.openPerson(personId);
    const [taxCode, firstName, lastName, fullNameField, birthDate, birthPlaceRaw, birthProvinceRaw] = await Promise.all([
      this.detailValue("Codice Fiscale"),
      this.detailValue("Nome"),
      this.detailValue("Cognome"),
      this.detailValue("Nome completo"),
      this.detailValue("Data Di Nascita"),
      this.detailValue("Luogo Di Nascita"),
      this.detailValue("Provincia Di Nascita"),
    ]);
    const phoneLabels = ["Cellulare", "Telefono fisso", "Telefono Ufficio", "Altro telefono"];
    const emailLabels = ["Email", "Email Secondaria"];
    const phones = (await Promise.all(phoneLabels.map((label) => this.detailValue(label)))).filter(Boolean);
    const emails = (await Promise.all(emailLabels.map((label) => this.detailValue(label)))).filter(Boolean);
    const provinceInPlace = birthPlaceRaw.match(/\(([A-Z]{2})\)\s*$/i)?.[1] ?? null;
    const birthPlace = birthPlaceRaw.replace(/\s*\([A-Z]{2}\)\s*$/i, "").trim() || null;
    return {
      id: personId,
      taxCode,
      firstName: firstName || null,
      lastName: lastName || null,
      fullName: firstName || lastName ? `${lastName} ${firstName}`.trim() : fullNameField,
      birthDate: isoDate(birthDate),
      birthPlace,
      birthProvince: birthProvinceRaw || provinceInPlace,
      phones,
      emails,
    };
  }

  async searchPeopleByExactTaxCode(taxCode: string): Promise<CrmPersonSnapshot[]> {
    return this.action("Ricerca nominativo per codice fiscale", async () => {
      const expected = canonicalTaxCode(taxCode);
      const virtual = this.virtualPeople.get(expected);
      if (virtual) return [structuredClone(virtual)];
      const cached = this.personSearchCache.get(expected);
      if (cached) return structuredClone(cached);
      await this.navigate(ACCOUNT_LIST);
      const search = await this.one(this.page.locator('input[title="Search..."]').filter({ visible: true }), "Barra di ricerca nominativi");
      await search.fill(expected);
      await search.press("Enter");
      await this.page.waitForURL(/\/s\/global-search\//i, { timeout: 20_000 });
      await this.page.getByText("Risultati di ricerca", { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
      const links = this.page.locator('a[data-refid="recordId"][data-recordid][href*="/s/account/"]').filter({ visible: true });
      const records = await links.evaluateAll((elements) => elements.flatMap((element) => {
        const href = element.getAttribute("href") ?? "";
        const id = element.getAttribute("data-recordid") ?? href.match(/\/s\/account\/([^/?#]+)/i)?.[1] ?? "";
        return id ? [{ id, href }] : [];
      }));
      const unique = [...new Map(records.map((record) => [record.id, record])).values()];
      const matches: CrmPersonSnapshot[] = [];
      for (const record of unique) {
        await this.page.goto(new URL(record.href, this.page.url()).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
        const snapshot = await this.readCurrentPerson(record.id);
        if (canonicalTaxCode(snapshot.taxCode) === expected) matches.push(snapshot);
      }
      this.personSearchCache.set(expected, structuredClone(matches));
      return structuredClone(matches);
    });
  }

  private invalidatePersonSearch(taxCode: string): void {
    this.personSearchCache.delete(canonicalTaxCode(taxCode));
  }

  private async fillPicklist(component: Locator, value: string, label: string): Promise<void> {
    const input = await this.one(component.locator('input[role="textbox"]').filter({ visible: true }), label);
    if (normalized(await input.inputValue()) === normalized(value)) return;
    await input.click();
    const options = component.locator('[role="option"]').filter({ visible: true });
    await options.first().waitFor({ state: "visible", timeout: 8_000 });
    const values = await options.allTextContents();
    const index = values.findIndex((candidate) => normalized(candidate) === normalized(value));
    if (index < 0) throw new ImportV2Error(`${label}: valore non disponibile`, "unsupported_case");
    await options.nth(index).click();
  }

  private async fillBirthPlace(value: string): Promise<void> {
    const component = await this.one(this.page.locator('c-lookup:has(label:text-is("Luogo Di Nascita"))').filter({ visible: true }), "Lookup luogo di nascita");
    const lookup = await this.one(component.locator('input[placeholder="Cerca"]').filter({ visible: true }), "Luogo di nascita");
    const alreadyCommitted = lookupCommitConfirmed({
      value: await lookup.inputValue(), expected: value,
      visibleOptionCount: 0, optionMarkedSelected: false,
      readonly: await lookup.getAttribute("readonly") !== null,
      hasSelectionClass: await component.locator(".slds-combobox_container.slds-has-selection").count() === 1,
      dependentFieldsVisible: true,
    });
    if (alreadyCommitted) return;
    if (await lookup.getAttribute("readonly") !== null) {
      const remove = await this.one(component.locator('button[title="Remove selected option"]').filter({ visible: true }), "Rimuovi luogo di nascita");
      await remove.click();
    }
    await lookup.fill("");
    await lookup.pressSequentially(value, { delay: 40 });
    const options = component.locator('[role="option"]').filter({ visible: true });
    await options.first().waitFor({ state: "visible", timeout: 8_000 });
    const texts = await options.allTextContents();
    const index = texts.findIndex((candidate) => !/NUOVO RECORD|CERCA /i.test(candidate)
      && (normalized(candidate) === normalized(value)
        || normalized(candidate).startsWith(`${normalized(value)} `)));
    if (index < 0) throw new ImportV2Error("Luogo di nascita non disponibile nel gestionale", "unsupported_case");
    const selected = options.nth(index);
    await selected.click({ force: true });
    let confirmed = false;
    for (let check = 0; check < 25 && !confirmed; check += 1) {
      const optionMarkedSelected = await component.locator('[role="option"][aria-selected="true"]').filter({ visible: true }).count() > 0;
      confirmed = lookupCommitConfirmed({
        value: await lookup.inputValue(), expected: value,
        visibleOptionCount: await options.count(), optionMarkedSelected,
        readonly: await lookup.getAttribute("readonly") !== null,
        hasSelectionClass: await component.locator(".slds-combobox_container.slds-has-selection").count() === 1,
        dependentFieldsVisible: true,
      });
      if (!confirmed) await this.page.waitForTimeout(160);
    }
    if (!confirmed) {
      throw new ImportV2Error("Luogo di nascita digitato ma non selezionato dal lookup", "transient_portal", { retryable: true });
    }
  }

  private async fillPersonFields(desired: PersonWriteModel, editing: boolean): Promise<void> {
    const values: Array<[string, Locator, string]> = [
      ["Nome", this.page.locator('.slds-form-element:has(label:text-is("Nome")) input').filter({ visible: true }), desired.firstName],
      ["Cognome", this.page.locator('.slds-form-element:has(label:has-text("Cognome")) input').filter({ visible: true }), desired.lastName],
      ["Codice Fiscale", this.page.getByLabel("Codice Fiscale", { exact: true }).filter({ visible: true }), desired.taxCode],
    ];
    for (const [label, locator, value] of values) {
      if (!value) continue;
      const input = await this.one(locator, label);
      if (await input.inputValue() !== value) await input.fill(value);
    }

    const gender = Number(desired.taxCode.slice(9, 11)) > 40 ? "F" : "M";
    const genderComponent = this.page.locator('c-picklist:has(label:text-is("Sesso"))').filter({ visible: true });
    if (await genderComponent.count() === 1) await this.fillPicklist(genderComponent, gender, "Sesso");
    if (desired.birthDate) {
      const date = this.page.locator('c-input-date-time:has(label:text-is("Data Di Nascita")) input').filter({ visible: true });
      const input = await this.one(date, "Data di nascita");
      await input.fill(uiDate(desired.birthDate));
    }
    if (desired.birthPlace) {
      await this.fillBirthPlace(desired.birthPlace);
      const birthPlace = this.page.locator('c-lookup:has(label:text-is("Luogo Di Nascita")) input[placeholder="Cerca"]').filter({ visible: true });
      const retained = normalized(await birthPlace.inputValue()).startsWith(normalized(desired.birthPlace));
      if (!retained) {
        throw new ImportV2Error("Luogo di nascita non confermato dal lookup", "transient_portal", { retryable: true });
      }
    }

    const phoneLabels = ["Cellulare", "Telefono fisso", "Telefono Ufficio", "Altro telefono"];
    if (desired.phones.length > phoneLabels.length) {
      throw new ImportV2Error("Più numeri disponibili dei campi telefono Tecnocloud", "unsupported_case", {
        details: { phoneCount: desired.phones.length, capacity: phoneLabels.length },
      });
    }
    for (const [index, label] of phoneLabels.entries()) {
      const field = this.page.getByLabel(label, { exact: true }).filter({ visible: true });
      if (await field.count() === 1) await field.fill(desired.phones[index] ?? "");
      else if (desired.phones[index]) throw new ImportV2Error(`Campo ${label} non disponibile`, "transient_portal", { retryable: true });
    }
    const emailLabels = ["Email", "Email Secondaria"];
    for (const [index, label] of emailLabels.entries()) {
      const field = this.page.getByLabel(label, { exact: true }).filter({ visible: true });
      if (await field.count() === 1) await field.fill(desired.emails[index] ?? "");
      else if (desired.emails[index]) throw new ImportV2Error(`Campo ${label} non disponibile`, "transient_portal", { retryable: true });
    }
    if (desired.privateNotes) {
      const notes = this.page.getByLabel(/Note Private/i).filter({ visible: true });
      if (await notes.count() !== 1) {
        if (editing) throw new ImportV2Error("Campo Note private non disponibile", "unsupported_case");
      } else {
        await notes.fill(desired.privateNotes);
      }
    }
  }

  private mergeDialog(): Locator {
    return this.page.locator('[role="dialog"]:visible').filter({ hasText: /Merge dei campi|Riconcilia/i }).last();
  }

  private async resolveVisibleMerge(): Promise<string> {
    const dialog = this.mergeDialog();
    await dialog.waitFor({ state: "visible", timeout: 15_000 });
    const dialogBox = await dialog.boundingBox();
    if (!dialogBox) throw new ImportV2Error("Finestra merge priva di geometria", "transient_portal", { retryable: true });
    const actions = dialog.locator('button, [role="button"], [role="radio"], input[type="radio"], [onclick], [tabindex]:not([tabindex="-1"])').filter({ visible: true });
    let selected = 0;
    for (let index = 0; index < await actions.count(); index += 1) {
      const action = actions.nth(index);
      const box = await action.boundingBox();
      if (!box || box.width < 30 || box.height < 15) continue;
      const left = (box.x - dialogBox.x) / dialogBox.width;
      const top = (box.y - dialogBox.y) / dialogBox.height;
      const bottom = (box.y + box.height - dialogBox.y) / dialogBox.height;
      if (left < 0.34 || left > 0.64 || top < 0.15 || bottom > 0.88) continue;
      await action.click({ force: true });
      selected += 1;
    }
    if (!selected) throw new ImportV2Error("Nessuna opzione sinistra identificata nel merge", "verification_failed", { retryable: true });
    const blocked = dialog.getByText(/Non si può procedere|Non è possibile procedere/i).filter({ visible: true });
    if (await blocked.count()) throw new ImportV2Error("Tecnocloud non consente il merge dopo la selezione sinistra", "verification_failed", { retryable: true });
    const ready = dialog.getByText(/Tutti i campi sono stati riconciliati/i).filter({ visible: true });
    await ready.first().waitFor({ state: "visible", timeout: 15_000 });
    const save = await this.one(dialog.getByRole("button", { name: "Salva", exact: true }).filter({ visible: true }), "Salva merge");
    await save.click();
    await dialog.waitFor({ state: "hidden", timeout: 20_000 });
    return this.waitForPersonRecord();
  }

  private async savePersonForm(): Promise<{ personId: string; merged: boolean }> {
    const save = await this.one(this.page.getByRole("button", { name: "Salva", exact: true }).filter({ visible: true }), "Salva nominativo");
    const taxCodeField = this.page.getByLabel("Codice Fiscale", { exact: true }).filter({ visible: true });
    await save.click();
    let result: "merge" | "saved";
    try {
      result = await Promise.race([
        this.mergeDialog().waitFor({ state: "visible", timeout: 25_000 }).then(() => "merge" as const),
        taxCodeField.waitFor({ state: "hidden", timeout: 25_000 })
          .then(() => this.waitForPersonRecord())
          .then(() => "saved" as const),
      ]);
    } catch (error) {
      const messages = (await this.page.locator('.slds-form-element__help:visible, [role="alert"]:visible').allTextContents())
        .map((message) => message.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const body = normalized(await this.page.locator("body").innerText().catch(() => ""));
      if (body.includes("CODICE FISCALE NON COERENTE")) {
        throw new ImportV2Error("Tecnocloud rifiuta il codice fiscale rispetto ai dati anagrafici", "invalid_source", {
          details: { validationMessages: messages },
        });
      }
      if (messages.length) {
        throw new ImportV2Error("Tecnocloud non ha accettato il modulo nominativo", "verification_failed", {
          retryable: true,
          details: { validationMessages: messages },
        });
      }
      throw error;
    }
    if (result === "merge") return { personId: await this.resolveVisibleMerge(), merged: true };
    return { personId: await this.waitForPersonRecord(), merged: false };
  }

  private async openPersonCreateForm(): Promise<void> {
    await this.navigate(ACCOUNT_LIST);
    const launcher = await this.one(this.page.locator("c-spotlight .icon_container").filter({ visible: true }), "Comando Nuovo");
    await launcher.click();
    const item = await this.one(this.page.locator('c-spotlight li.element:has-text("Nominativo")').filter({ visible: true }), "Voce Nominativo");
    await item.click();
    await this.page.getByLabel("Nome", { exact: true }).filter({ visible: true }).waitFor({ state: "visible", timeout: 15_000 });
  }

  private async openPersonEditForm(personId: string): Promise<void> {
    await this.openPerson(personId);
    const triggers = this.page.locator("button.inline-edit-trigger").filter({ visible: true });
    await triggers.first().waitFor({ state: "visible", timeout: 15_000 });
    if (!(await triggers.count())) throw new ImportV2Error("Modifica nominativo non disponibile", "transient_portal", { retryable: true });
    await triggers.first().click();
    await this.page.getByLabel("Codice Fiscale", { exact: true }).filter({ visible: true }).waitFor({ state: "visible", timeout: 10_000 });
  }

  async createPerson(desired: PersonWriteModel): Promise<CrmPersonSnapshot> {
    return this.action("Creazione nominativo", async () => {
      this.invalidatePersonSearch(desired.taxCode);
      if (this.dryRun) {
        const person: CrmPersonSnapshot = { id: `dry-person-${desired.taxCode}`, ...desired };
        this.virtualPeople.set(canonicalTaxCode(desired.taxCode), person);
        return structuredClone(person);
      }
      await this.openPersonCreateForm();
      await this.fillPersonFields(desired, false);
      const saved = await this.savePersonForm();
      if (desired.privateNotes && !saved.merged) {
        await this.openPersonEditForm(saved.personId);
        await this.fillPersonFields(desired, true);
        await this.savePersonForm();
      }
      return this.readCurrentPerson(saved.personId);
    });
  }

  async overwritePerson(personId: string, desired: PersonWriteModel): Promise<CrmPersonSnapshot> {
    return this.action("Aggiornamento nominativo", async () => {
      this.invalidatePersonSearch(desired.taxCode);
      if (this.dryRun) {
        const person: CrmPersonSnapshot = { id: personId, ...desired };
        this.virtualPeople.set(canonicalTaxCode(desired.taxCode), person);
        return structuredClone(person);
      }
      await this.openPersonEditForm(personId);
      await this.fillPersonFields(desired, true);
      const saved = await this.savePersonForm();
      return this.readCurrentPerson(saved.personId);
    });
  }

  async mergePeople(request: MergeRequest): Promise<CrmPersonSnapshot> {
    return this.action("Merge nominativi", async () => {
      if (request.fieldSelection !== "all_left") throw new ImportV2Error("Il merge V2 richiede tutte le opzioni sinistre", "invalid_source");
      this.invalidatePersonSearch(request.taxCode);
      if (this.dryRun) {
        const person: CrmPersonSnapshot = { id: request.canonicalPersonId, ...request.desired };
        this.virtualPeople.set(canonicalTaxCode(request.taxCode), person);
        return structuredClone(person);
      }
      await this.openPersonEditForm(request.canonicalPersonId);
      await this.fillPersonFields(request.desired, true);
      const saved = await this.savePersonForm();
      if (!saved.merged) throw new ImportV2Error("Il salvataggio non ha aperto il merge atteso", "verification_failed", { retryable: true });
      return this.readCurrentPerson(saved.personId);
    });
  }

  private propertyUrl(propertyId: string): string {
    return this.url(`${CRM_ROOT}/immobile/${encodeURIComponent(propertyId)}`);
  }

  private async openProperty(propertyId: string): Promise<void> {
    if (recordIdFromUrl(this.page.url(), "immobile") !== propertyId) {
      await this.page.goto(this.propertyUrl(propertyId), { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await this.assertSession();
    await this.page.getByText("Indirizzo Completo Immobile", { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
  }

  private async waitForPropertyRecord(): Promise<string> {
    await this.page.waitForURL((url) => Boolean(recordIdFromUrl(url.toString(), "immobile")), { timeout: 25_000 });
    const id = recordIdFromUrl(this.page.url(), "immobile");
    if (!id) throw new ImportV2Error("Identificativo immobile non disponibile dopo il salvataggio", "verification_failed", { retryable: true });
    return id;
  }

  private async readCadastralIdentity(): Promise<CadastralIdentity> {
    const [urbanSection, sheet, parcel, parcelDenomination, subaltern, income] = await Promise.all([
      this.detailValue("Catasto Sezione Urbana"), this.detailValue("Catasto Foglio"),
      this.detailValue("Catasto Particella"), this.detailValue("Catasto Denom Particella"),
      this.detailValue("Catasto Subalterno"), this.detailValue("Catasto Rendita"),
    ]);
    return {
      urbanSection: urbanSection || null,
      sheet,
      parcel,
      parcelDenomination: parcelDenomination || null,
      subaltern,
      income: decimalValue(income),
    };
  }

  private async readPropertySummary(propertyId: string, displayName = ""): Promise<CrmPropertySummary> {
    await this.openProperty(propertyId);
    const addressField = this.page.locator('li.slds-page-header__detail-block:has(.slds-text-title:has-text("Indirizzo Completo Immobile")) c-output-field').filter({ visible: true });
    const fullAddress = await addressField.first().innerText().catch(() => this.detailValue("Indirizzo Completo Immobile"));
    const heading = displayName || (await this.page.locator("h1:visible, h2:visible").first().innerText().catch(() => ""));
    return { id: propertyId, displayName: heading.replace(/\s+/g, " ").trim(), fullAddress: fullAddress || null, cadastral: await this.readCadastralIdentity() };
  }

  private async propertyLinksForPerson(personId: string, plan: ImportV2Plan): Promise<Array<{ id: string; href: string; label: string }>> {
    await this.openPerson(personId);
    const card = this.page.locator("article:visible").filter({ hasText: /Immobili\s*\/\s*Notizie\s*\/\s*Incarichi/i });
    const current = await this.one(card, "Immobili/Notizie/Incarichi", 20_000);
    const declared = Number((await current.innerText()).match(/Immobili\s*\/\s*Notizie\s*\/\s*Incarichi\s*\((\d+)\)/i)?.[1] ?? 0);
    let scope: Locator = current;
    const viewAll = current.getByText("Visualizza tutto", { exact: true }).filter({ visible: true });
    if (declared > 2 || await viewAll.count() === 1) {
      if (await viewAll.count() !== 1) {
        throw new ImportV2Error("Elenco completo immobili non disponibile", "transient_portal", { retryable: true });
      }
      await viewAll.click({ force: true });
      scope = await this.one(
        this.page.locator('[role="dialog"]:visible').filter({ hasText: /Immobili\s*\/\s*Notizie\s*\/\s*Incarichi/i }),
        "Elenco completo Immobili/Notizie/Incarichi",
        12_000,
      );
    }
    const links = scope.locator('a[href*="/s/immobile/"]').filter({ visible: true });
    const rows = await links.evaluateAll((nodes) => nodes.map((node) => {
      const href = node.getAttribute("href") ?? "";
      const label = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      const id = node.getAttribute("data-recordid") ?? node.getAttribute("data-id") ?? href.match(/\/s\/immobile\/([^/?#]+)/i)?.[1] ?? "";
      return { id, href, label };
    }));
    const properties = rows.filter((row) => row.id && /^\s*IM\s*-/i.test(row.label));
    if (declared > 0 && !properties.length) {
      throw new ImportV2Error("La scheda dichiara immobili ma non espone righe IM leggibili", "verification_failed", { retryable: true });
    }
    const paired = properties.filter((row) => sameAddress(row.label, plan.source.fullAddress));
    // Pair first; if an unknown label format prevents pairing, inspect all IM
    // rows rather than risk creating a duplicate. NT/IN rows never enter here.
    const selected = paired.length ? paired : properties;
    const modal = this.page.locator('[role="dialog"]:visible').filter({ hasText: /Immobili\s*\/\s*Notizie\s*\/\s*Incarichi/i });
    if (await modal.count()) {
      const close = modal.getByRole("button", { name: /Chiudi|Close/i }).filter({ visible: true });
      if (await close.count()) await close.last().click({ force: true });
    }
    return selected;
  }

  async listAllPropertiesForPeople(personIds: string[], plan: ImportV2Plan): Promise<CrmPropertySummary[]> {
    return this.action("Lettura immobili collegati", async () => {
      const links = [] as Array<{ id: string; href: string; label: string }>;
      for (const personId of [...new Set(personIds)]) links.push(...await this.propertyLinksForPerson(personId, plan));
      const unique = [...new Map(links.map((link) => [link.id, link])).values()];
      const summaries: CrmPropertySummary[] = [];
      for (const link of unique) summaries.push(await this.readPropertySummary(link.id, link.label));
      return summaries;
    });
  }

  async findPropertiesByCadastralIdentity(plan: ImportV2Plan): Promise<CrmPropertySummary[]> {
    return this.action("Ricerca catastale globale", async () => {
      await this.navigate(PROPERTY_SEARCH);
      const filter = (index: number) => this.page.locator(`lightning-input[c-queryviewerfilters_queryviewerfilters][data-index="${index}"] input`).filter({ visible: true });
      let sheet = filter(22);
      if (!(await sheet.count())) {
        const open = await this.one(this.page.locator('button[title="Filters"]').filter({ visible: true }), "Filtri immobili", 12_000);
        await open.click({ force: true });
        sheet = filter(22);
        await sheet.waitFor({ state: "visible", timeout: 12_000 });
      }
      const parcel = await this.one(filter(23), "Filtro particella");
      const subaltern = await this.one(filter(27), "Filtro subalterno");
      await (await this.one(sheet, "Filtro foglio")).fill(plan.source.cadastral.sheet);
      await parcel.fill(plan.source.cadastral.parcel);
      await subaltern.fill(plan.source.cadastral.subaltern);
      await (await this.one(this.page.getByRole("button", { name: "Applica", exact: true }).filter({ visible: true }), "Applica filtri")).click({ force: true });

      const ids = this.page.locator('lightning-input[c-queryviewer_queryviewer][data-id]').filter({ visible: true });
      let prior = "";
      let stable = 0;
      for (let attempt = 0; attempt < 60 && stable < 3; attempt += 1) {
        await this.page.waitForTimeout(250);
        const signature = (await ids.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id") ?? "").filter(Boolean).sort())).join("|");
        stable = signature === prior ? stable + 1 : 0;
        prior = signature;
      }
      if (stable < 3) throw new ImportV2Error("Risultati catastali non stabilizzati", "transient_portal", { retryable: true });
      const found = [...new Set(await ids.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id") ?? "").filter(Boolean)))];
      const summaries: CrmPropertySummary[] = [];
      for (const id of found) summaries.push(await this.readPropertySummary(id));
      return summaries;
    });
  }

  private async pick(component: Locator, expected: string, label: string): Promise<void> {
    if (!expected) return;
    const input = await this.one(component.locator('input[role="textbox"]').filter({ visible: true }), label);
    if (normalized(await input.inputValue()) === normalized(expected)) return;
    await input.click();
    const options = component.locator('[role="option"]').filter({ visible: true });
    await options.first().waitFor({ state: "visible", timeout: 8_000 });
    const texts = await options.allTextContents();
    const index = texts.findIndex((text) => normalized(text) === normalized(expected));
    if (index < 0) throw new ImportV2Error(`${label}: valore ${expected} non disponibile`, "unsupported_case");
    await options.nth(index).click({ force: true });
    if (normalized(await input.inputValue()) !== normalized(expected)) {
      throw new ImportV2Error(`${label} non confermato`, "transient_portal", { retryable: true });
    }
  }

  private async fillVisibleInput(label: string, value: string, required = false): Promise<void> {
    if (!value && !required) return;
    const fields = this.page.getByLabel(label, { exact: true }).filter({ visible: true });
    if (!(await fields.count())) {
      if (required) throw new ImportV2Error(`Campo ${label} non disponibile`, "transient_portal", { retryable: true });
      return;
    }
    const input = await this.one(fields, label);
    if (normalized(await input.inputValue()) !== normalized(value)) await input.fill(value);
    if (normalized(await input.inputValue()) !== normalized(value)) {
      throw new ImportV2Error(`Il valore del campo ${label} non è rimasto nel modulo`, "transient_portal", { retryable: true });
    }
  }

  private async fillMunicipality(value: string): Promise<void> {
    const component = await this.one(this.page.locator('c-lookup:has(label:has-text("Comune"))').filter({ visible: true }), "Lookup Comune");
    const input = await this.one(component.locator('input[placeholder="Cerca"]').filter({ visible: true }), "Comune");
    const alreadyCommitted = lookupCommitConfirmed({
      value: await input.inputValue(), expected: value,
      visibleOptionCount: 0, optionMarkedSelected: false,
      readonly: await input.getAttribute("readonly") !== null,
      hasSelectionClass: await component.locator(".slds-combobox_container.slds-has-selection").count() === 1,
      dependentFieldsVisible: true,
    });
    if (alreadyCommitted) return;
    if (await input.getAttribute("readonly") !== null) {
      const remove = await this.one(component.locator('button[title="Remove selected option"]').filter({ visible: true }), "Rimuovi Comune");
      await remove.click();
    }
    await input.fill("");
    await input.pressSequentially(value, { delay: 45 });
    const options = component.locator('[role="option"]').filter({ visible: true });
    await options.first().waitFor({ state: "visible", timeout: 8_000 });
    const labels = await options.allTextContents();
    const indexes = labels.map((label, index) => !/NUOVO RECORD|CERCA /i.test(label)
      && normalized(label).startsWith(normalized(value)) ? index : -1).filter((index) => index >= 0);
    if (indexes.length !== 1) throw new ImportV2Error("Comune non selezionabile in modo univoco", "verification_failed", { retryable: true });
    await options.nth(indexes[0]!).click({ force: true });
    let committed = false;
    for (let check = 0; check < 25 && !committed; check += 1) {
      committed = lookupCommitConfirmed({
        value: await input.inputValue(), expected: value,
        visibleOptionCount: await options.count(), optionMarkedSelected: false,
        readonly: await input.getAttribute("readonly") !== null,
        hasSelectionClass: await component.locator(".slds-combobox_container.slds-has-selection").count() === 1,
        dependentFieldsVisible: true,
      });
      if (!committed) await this.page.waitForTimeout(160);
    }
    if (!committed) {
      throw new ImportV2Error("Comune digitato ma non selezionato dal lookup", "transient_portal", { retryable: true });
    }
  }

  private async fillPropertyCore(plan: ImportV2Plan): Promise<void> {
    const draft = propertyDraft(plan);
    await this.pick(this.page.locator('c-picklist:has(label:text-is("Tipologia Immobile"))').filter({ visible: true }), draft.type, "Tipologia Immobile");
    await this.pick(this.page.locator('c-picklist:has(label:text-is("Sottotipologia Immobile"))').filter({ visible: true }), draft.subtype, "Sottotipologia Immobile");
    if (draft.floor) await this.pick(this.page.locator('c-picklist:has(label:text-is("Piano Immobile"))').filter({ visible: true }), draft.floor, "Piano Immobile");
    await this.fillVisibleInput("Numero Piano", draft.floorNumber);
    await this.fillVisibleInput("Indirizzo", draft.street, true);
    await this.fillVisibleInput("Civico", draft.civic, true);
    await this.fillVisibleInput("Interno", draft.internal, true);
    await this.fillVisibleInput("Lettera", draft.letter);
    await this.fillMunicipality(plan.source.municipality);
    const postal = plan.source.fullAddress.match(/,\s*(\d{5})\b/)?.[1] ?? "";
    const postalComponent = this.page.locator('c-picklist:has(label:has-text("CAP"))').filter({ visible: true });
    if (postal && await postalComponent.count() === 1) await this.pick(postalComponent, postal, "CAP");
  }

  private cadastralRows(plan: ImportV2Plan): Array<[string, string]> {
    return [
      ["Catasto Sezione Urbana", plan.source.cadastral.urbanSection ?? ""],
      ["Catasto Foglio", plan.source.cadastral.sheet],
      ["Catasto Particella", plan.source.cadastral.parcel],
      ["Catasto Denom Particella", plan.source.cadastral.parcelDenomination ?? ""],
      ["Catasto Subalterno", plan.source.cadastral.subaltern],
      ["Catasto Rendita", formatDecimal(plan.source.cadastral.income)],
      ["Note Catasto", plan.source.cadastralNotes ?? ""],
    ];
  }

  private async openInlineGroup(label: string): Promise<void> {
    if (await this.page.getByLabel(label, { exact: true }).filter({ visible: true }).count()) return;
    const labels = this.page.locator("label").filter({ hasText: label }).filter({ visible: true });
    const exact: Locator[] = [];
    for (let index = 0; index < await labels.count(); index += 1) {
      if (normalized(await labels.nth(index).innerText()) === normalized(label)) exact.push(labels.nth(index));
    }
    if (exact.length !== 1) throw new ImportV2Error(`Riga ${label} non univoca`, "transient_portal", { retryable: true });
    let row = exact[0]!.locator("xpath=../..");
    for (let depth = 0; depth < 4; depth += 1) {
      const edit = row.locator('button.inline-edit-trigger, button[title*="Modifica"], button[title*="Edit"]').filter({ visible: true });
      if (await edit.count() === 1) {
        await edit.click();
        await this.page.getByLabel(label, { exact: true }).filter({ visible: true }).waitFor({ state: "visible", timeout: 10_000 });
        return;
      }
      row = row.locator("xpath=..");
    }
    throw new ImportV2Error(`Modifica ${label} non disponibile`, "transient_portal", { retryable: true });
  }

  private async syncCadastral(plan: ImportV2Plan): Promise<void> {
    const expected = this.cadastralRows(plan).filter(([, value]) => value);
    if (!expected.length) return;
    const mismatch = await Promise.all(expected.map(async ([label, value]) => normalized(await this.detailValue(label)) !== normalized(value)));
    if (!mismatch.some(Boolean)) return;
    await this.openInlineGroup(expected[mismatch.findIndex(Boolean)]![0]);
    for (const [label, value] of expected) await this.fillVisibleInput(label, value, true);
    const save = await this.one(this.page.getByRole("button", { name: "Salva", exact: true }).filter({ visible: true }), "Salva catasto");
    await save.click();
    await save.waitFor({ state: "hidden", timeout: 15_000 });
    await this.assertSession();
  }

  private async finishPropertyPositioning(plan: ImportV2Plan): Promise<void> {
    const dialog = this.page.locator('[role="dialog"]:visible').filter({ hasText: /posizion|Google|Stesso valore/i });
    if (!(await dialog.count())) return;
    const currentRadios = dialog.locator('input[type="radio"][id*="_current-"]').filter({ visible: true });
    if (await currentRadios.count()) {
      for (let index = 0; index < await currentRadios.count(); index += 1) {
        const radio = currentRadios.nth(index);
        if (!(await radio.isChecked())) await radio.check({ force: true });
      }
    } else {
      const draft = propertyDraft(plan);
      const postal = plan.source.fullAddress.match(/,\s*(\d{5})\b/)?.[1] ?? "";
      for (const inserted of [draft.street, draft.civic, postal].filter(Boolean)) {
        const text = dialog.getByText(inserted, { exact: true }).filter({ visible: true });
        if (await text.count() !== 1) throw new ImportV2Error("Confronto indirizzo non univoco", "verification_failed", { retryable: true });
        let row = text.locator("xpath=..");
        let selected = false;
        for (let depth = 0; depth < 7 && !selected; depth += 1) {
          if (normalized(await row.innerText()).includes("STESSO VALORE")) { selected = true; break; }
          const action = row.locator('button, a, [role="button"], [role="option"], input[type="radio"], label').filter({ visible: true });
          if (await action.count() === 1) { await action.click({ force: true }); selected = true; break; }
          row = row.locator("xpath=..");
        }
        if (!selected) throw new ImportV2Error("Valore SISTER non selezionabile nel confronto indirizzo", "verification_failed", { retryable: true });
      }
    }
    const locality = dialog.locator('c-picklist:has(label:has-text("Localit")), lightning-combobox:has(label:has-text("Localit"))').filter({ visible: true });
    if (await locality.count() === 1) {
      const native = locality.locator("select").filter({ visible: true });
      if (await native.count()) await native.selectOption({ index: 1 });
      else {
        const trigger = locality.locator('input[role="textbox"], button[aria-haspopup="listbox"]').filter({ visible: true }).first();
        if (!(await trigger.inputValue().catch(() => "")).trim()) {
          await trigger.click();
          const options = locality.locator('[role="option"]').filter({ visible: true });
          await options.first().waitFor({ state: "visible", timeout: 8_000 });
          await options.first().click({ force: true });
        }
      }
    }
    const save = dialog.getByRole("button", { name: "Salva", exact: true }).filter({ visible: true });
    if (await save.count() !== 1) throw new ImportV2Error("Posizionamento immobile non salvabile", "transient_portal", { retryable: true });
    await save.click();
    await dialog.waitFor({ state: "hidden", timeout: 12_000 });
  }

  async createProperty(plan: ImportV2Plan, primaryPersonId: string): Promise<CrmPropertySnapshot> {
    return this.action("Creazione immobile", async () => {
      if (this.dryRun) {
        const primarySource = plan.source.owners
          .map((owner, index) => ({ owner, index }))
          .sort((left, right) => ((right.owner.sharePercentage ?? -1) - (left.owner.sharePercentage ?? -1)) || left.index - right.index)[0]?.owner;
        const property: CrmPropertySnapshot = {
          id: `dry-property-${plan.source.cadastral.sheet}-${plan.source.cadastral.parcel}-${plan.source.cadastral.subaltern}`,
          displayName: `IM - ${plan.source.fullAddress.split(",")[0]}`,
          fullAddress: plan.source.fullAddress,
          cadastral: structuredClone(plan.source.cadastral),
          owners: [{ linkId: `dry-primary-${primaryPersonId}`, personId: primaryPersonId, taxCode: primarySource?.taxCode ?? null, sharePercentage: primarySource?.sharePercentage ?? null, rightType: null, role: "Proprietario Principale" }],
        };
        this.virtualProperties.set(property.id, property);
        return structuredClone(property);
      }
      await this.openPerson(primaryPersonId);
      const card = await this.one(this.page.locator("article:visible").filter({ hasText: /Immobili\s*\/\s*Notizie\s*\/\s*Incarichi/i }), "Immobili/Notizie/Incarichi", 20_000);
      const toggle = await this.one(card.locator("c-menu button").filter({ visible: true }), "Menu nuovo immobile");
      let item = card.locator('c-menu a[role="menuitem"] span[title="Nuovo"]').filter({ visible: true });
      if (!(await item.count())) { await toggle.click(); await item.first().waitFor({ state: "visible", timeout: 8_000 }); }
      item = card.locator('c-menu a[role="menuitem"]:has(span[title="Nuovo"])').filter({ visible: true });
      await (await this.one(item, "Nuovo immobile")).click();
      await this.page.locator('c-picklist:has(label:text-is("Tipologia Immobile"))').filter({ visible: true }).waitFor({ state: "visible", timeout: 15_000 });
      await this.fillPropertyCore(plan);
      await (await this.one(this.page.getByRole("button", { name: "Avanti", exact: true }).filter({ visible: true }), "Avanti immobile")).click();
      await this.finishPropertyPositioning(plan);
      const id = await this.waitForPropertyRecord();
      await this.openProperty(id);
      await this.syncCadastral(plan);
      return this.readProperty(id);
    });
  }

  async updateProperty(propertyId: string, plan: ImportV2Plan): Promise<CrmPropertySnapshot> {
    return this.action("Aggiornamento immobile", async () => {
      if (this.dryRun) {
        const previous = await this.readProperty(propertyId);
        const property = { ...previous, fullAddress: plan.source.fullAddress, cadastral: structuredClone(plan.source.cadastral) };
        this.virtualProperties.set(propertyId, property);
        return structuredClone(property);
      }
      await this.openProperty(propertyId);
      const core = this.page.locator('div.flex:has(label span:text-is("Tipologia Immobile"))').filter({ visible: true });
      if (await core.count() === 1) {
        const edit = core.locator("button.inline-edit-trigger").filter({ visible: true });
        if (await edit.count() === 1) {
          await edit.click();
          await this.page.locator('c-picklist:has(label:text-is("Tipologia Immobile"))').filter({ visible: true }).waitFor({ state: "visible", timeout: 10_000 });
          await this.fillPropertyCore(plan);
          const save = await this.one(this.page.getByRole("button", { name: "Salva", exact: true }).filter({ visible: true }), "Salva dati immobile");
          await save.click();
          await save.waitFor({ state: "hidden", timeout: 15_000 });
          await this.finishPropertyPositioning(plan);
        }
      }
      await this.openProperty(propertyId);
      await this.syncCadastral(plan);
      return this.readProperty(propertyId);
    });
  }

  private async ownershipCard(propertyId: string): Promise<Locator> {
    await this.openProperty(propertyId);
    return this.one(this.page.locator("article:visible").filter({ hasText: /Soggetti collegati/i }), "Soggetti collegati", 20_000);
  }

  private async ownershipLinks(propertyId: string): Promise<Array<{ personId: string; linkId: string; text: string }>> {
    const card = await this.ownershipCard(propertyId);
    let scope = card;
    const viewAll = card.getByText("Visualizza tutto", { exact: true }).filter({ visible: true });
    if (await viewAll.count() === 1) {
      await viewAll.click({ force: true });
      scope = await this.one(this.page.locator('[role="dialog"]:visible').filter({ hasText: /Soggetti collegati/i }), "Elenco soggetti collegati", 12_000);
    }
    const links = scope.locator('a[href*="/s/account/"]').filter({ visible: true });
    const result = await links.evaluateAll((nodes) => nodes.map((node) => {
      const href = node.getAttribute("href") ?? "";
      const row = node.closest("tr") ?? node.closest("li") ?? node.parentElement?.parentElement ?? node.parentElement;
      const personId = node.getAttribute("data-recordid") ?? node.getAttribute("data-id") ?? href.match(/\/s\/account\/([^/?#]+)/i)?.[1] ?? "";
      const linkId = row?.querySelector("[data-recordid],[data-id]")?.getAttribute("data-recordid")
        ?? row?.querySelector("[data-recordid],[data-id]")?.getAttribute("data-id") ?? `link-${personId}`;
      return { personId, linkId, text: (row?.textContent ?? node.textContent ?? "").replace(/\s+/g, " ").trim() };
    }));
    const modal = this.page.locator('[role="dialog"]:visible').filter({ hasText: /Soggetti collegati/i });
    if (await modal.count()) {
      const close = modal.getByRole("button", { name: /Chiudi|Close/i }).filter({ visible: true });
      if (await close.count()) await close.last().click({ force: true });
    }
    return [...new Map(result.filter((row) => row.personId).map((row) => [row.personId, row])).values()];
  }

  private roleFromText(text: string): string | null {
    if (/Proprietario Principale/i.test(text)) return "Proprietario Principale";
    if (/Comproprietario/i.test(text)) return "Comproprietario";
    return null;
  }

  private rightFromText(text: string): string | null {
    if (/Usufrutt/i.test(text)) return "Usufrutto";
    if (/Nud[ao]\s+Propriet/i.test(text)) return "Nuda proprietà";
    if (/Propriet/i.test(text)) return "Proprietà";
    return null;
  }

  private shareFromText(text: string): number | null {
    const percent = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (percent?.[1]) return decimalValue(percent[1]);
    const labelled = text.match(/Quota\s*[:\-]?\s*(\d+(?:[.,]\d+)?)/i);
    return labelled?.[1] ? decimalValue(labelled[1]) : null;
  }

  private async readPrimaryOwnership(propertyId: string): Promise<CrmOwnershipSnapshot | null> {
    await this.openProperty(propertyId);
    const labels = this.page.locator("label").filter({ hasText: "Proprietario Predefinito" }).filter({ visible: true });
    const exact: Locator[] = [];
    for (let index = 0; index < await labels.count(); index += 1) {
      if (normalized(await labels.nth(index).innerText()) === "PROPRIETARIO PREDEFINITO") exact.push(labels.nth(index));
    }
    if (!exact.length) return null;
    if (exact.length !== 1) {
      throw new ImportV2Error("Proprietario principale non univoco", "verification_failed", { retryable: true });
    }
    const row = exact[0]!.locator("xpath=../..");
    const link = row.locator('a[href*="/s/account/"]').filter({ visible: true });
    if (await link.count() !== 1) {
      throw new ImportV2Error("Scheda del proprietario principale non verificabile", "verification_failed", { retryable: true });
    }
    const href = await link.getAttribute("href") ?? "";
    const personId = await link.getAttribute("data-recordid")
      ?? await link.getAttribute("data-id")
      ?? href.match(/\/s\/account\/([^/?#]+)/i)?.[1]
      ?? "";
    if (!personId) {
      throw new ImportV2Error("Identificativo del proprietario principale assente", "verification_failed", { retryable: true });
    }
    const sharePercentage = decimalValue(await this.detailValue("Quota Proprietario"));
    const person = await this.readCurrentPerson(personId);
    return {
      linkId: `primary-${personId}`,
      personId,
      taxCode: person.taxCode || null,
      sharePercentage,
      rightType: null,
      role: "Proprietario Principale",
    };
  }

  private async readOwnerships(propertyId: string): Promise<CrmOwnershipSnapshot[]> {
    const primary = await this.readPrimaryOwnership(propertyId);
    const links = await this.ownershipLinks(propertyId);
    const result: CrmOwnershipSnapshot[] = [];
    for (const link of links) {
      const person = await this.readCurrentPerson(link.personId);
      result.push({
        linkId: link.linkId,
        personId: link.personId,
        taxCode: person.taxCode || null,
        sharePercentage: this.shareFromText(link.text),
        rightType: this.rightFromText(link.text),
        role: this.roleFromText(link.text),
      });
    }
    await this.openProperty(propertyId);
    return primary ? [primary, ...result.filter((owner) => owner.personId !== primary.personId)] : result;
  }

  private async syncPrimaryOwnership(propertyId: string, desired: OwnershipWrite, current: CrmOwnershipSnapshot | null): Promise<void> {
    if (current?.personId === desired.personId && this.sameShare(current.sharePercentage, desired.sharePercentage)) return;
    await this.openProperty(propertyId);
    const row = this.page.locator('div.flex:has(label span:text-is("Proprietario Predefinito"))').filter({ visible: true });
    const edit = row.locator("button.inline-edit-trigger").filter({ visible: true });
    await (await this.one(edit, "Modifica proprietario principale")).click();
    const component = this.page.locator('c-lookup:has(label:text-is("Proprietario Predefinito"))').filter({ visible: true });
    await component.waitFor({ state: "visible", timeout: 10_000 });
    const lookup = await this.one(component.locator('input[placeholder="Cerca"]').filter({ visible: true }), "Proprietario principale");
    if (current?.personId !== desired.personId) {
      if (await lookup.getAttribute("readonly") !== null) {
        const remove = await this.one(component.locator('button[title="Remove selected option"]').filter({ visible: true }), "Rimuovi proprietario principale");
        await remove.click();
      }
      await lookup.fill("");
      await lookup.pressSequentially(desired.fullName, { delay: 75 });
      const options = component.locator('[role="option"]').filter({ visible: true });
      await options.first().waitFor({ state: "visible", timeout: 8_000 });
      const exact = options.filter({ has: this.page.locator(`[data-item-id="${desired.personId}"], [data-recordid="${desired.personId}"], [data-id="${desired.personId}"]`) });
      if (await exact.count() !== 1) {
        throw new ImportV2Error("Proprietario principale non selezionabile tramite identificativo CRM", "verification_failed", { retryable: true });
      }
      await exact.click({ force: true });
      const committed = lookupCommitConfirmed({
        value: await lookup.inputValue(),
        expected: desired.fullName,
        visibleOptionCount: await options.count(),
        optionMarkedSelected: false,
        readonly: await lookup.getAttribute("readonly") !== null,
        hasSelectionClass: await component.locator(".slds-combobox_container.slds-has-selection").count() === 1,
        dependentFieldsVisible: true,
      });
      if (!committed) {
        throw new ImportV2Error("Proprietario principale digitato ma non selezionato", "transient_portal", { retryable: true });
      }
    }
    const quota = await this.one(this.page.getByLabel("Quota Proprietario", { exact: true }).filter({ visible: true }), "Quota proprietario");
    await quota.fill(formatDecimal(desired.sharePercentage));
    const internal = this.page.getByLabel("Interno", { exact: true }).filter({ visible: true });
    if (await internal.count() === 1 && !(await internal.inputValue()).trim()) await internal.fill(".");
    const save = await this.one(this.page.getByRole("button", { name: "Salva", exact: true }).filter({ visible: true }), "Salva proprietario principale");
    await save.click();
    await save.waitFor({ state: "hidden", timeout: 15_000 });
    const verified = await this.readPrimaryOwnership(propertyId);
    if (!verified || verified.personId !== desired.personId || !this.sameShare(verified.sharePercentage, desired.sharePercentage)) {
      throw new ImportV2Error("Proprietario principale o quota non confermati dalla scheda immobile", "verification_failed", { retryable: true });
    }
  }

  private async ownershipRow(propertyId: string, personId: string): Promise<Locator> {
    const card = await this.ownershipCard(propertyId);
    let scope = card;
    let link = scope.locator(`a[href*="/s/account/${personId}"], a[data-recordid="${personId}"], a[data-id="${personId}"]`).filter({ visible: true });
    if (await link.count() !== 1) {
      const viewAll = card.getByText("Visualizza tutto", { exact: true }).filter({ visible: true });
      if (await viewAll.count() === 1) {
        await viewAll.click({ force: true });
        scope = await this.one(this.page.locator('[role="dialog"]:visible').filter({ hasText: /Soggetti collegati/i }), "Elenco soggetti collegati", 12_000);
        link = scope.locator(`a[href*="/s/account/${personId}"], a[data-recordid="${personId}"], a[data-id="${personId}"]`).filter({ visible: true });
      }
    }
    await link.first().waitFor({ state: "visible", timeout: 10_000 });
    if (await link.count() !== 1) throw new ImportV2Error("Riga soggetto collegato non univoca", "verification_failed", { retryable: true });
    const tr = link.locator("xpath=ancestor::tr[1]");
    if (await tr.count()) return tr;
    return link.locator("xpath=../..");
  }

  private async relationshipAction(propertyId: string, personId: string, action: "Modifica" | "Elimina"): Promise<void> {
    const row = await this.ownershipRow(propertyId, personId);
    const direct = row.getByRole("button", { name: action, exact: true }).filter({ visible: true });
    if (await direct.count() === 1) { await direct.click(); return; }
    const menu = row.locator('button[title*="Azioni"], button[title*="Actions"], button.slds-button_icon').filter({ visible: true });
    if (await menu.count() !== 1) throw new ImportV2Error(`Azione ${action} non disponibile sul soggetto`, "transient_portal", { retryable: true });
    await menu.click({ force: true });
    const item = this.page.getByText(action, { exact: true }).filter({ visible: true });
    await (await this.one(item, action, 6_000)).click({ force: true });
  }

  private async deleteOwnership(propertyId: string, personId: string): Promise<void> {
    await this.relationshipAction(propertyId, personId, "Elimina");
    const dialog = await this.one(this.page.locator('[role="dialog"]:visible').filter({ hasText: /elimin/i }), "Conferma eliminazione", 8_000);
    await (await this.one(dialog.getByRole("button", { name: "Elimina", exact: true }).filter({ visible: true }), "Elimina soggetto")).click();
    await dialog.waitFor({ state: "hidden", timeout: 12_000 });
  }

  private async fillOwnershipForm(dialog: Locator, desired: OwnershipWrite, selectPerson: boolean): Promise<void> {
    if (selectPerson) {
      const lookup = await this.one(dialog.locator('c-lookup:has(label:text-is("Cliente")) input[placeholder="Cerca"]').filter({ visible: true }), "Cliente comproprietario");
      let committed = false;
      for (let attempt = 0; attempt < 3 && !committed; attempt += 1) {
        if (await lookup.getAttribute("readonly") !== null) {
          const dependent = dialog.locator('c-picklist:has(label:text-is("Ruolo")), lightning-input:has(label:text-is("Quota"))').filter({ visible: true });
          committed = lookupCommitConfirmed({
            value: await lookup.inputValue(), expected: desired.fullName,
            visibleOptionCount: 0, optionMarkedSelected: false,
            readonly: true,
            hasSelectionClass: await dialog.locator('c-lookup:has(label:text-is("Cliente")) .slds-combobox_container.slds-has-selection').count() === 1,
            dependentFieldsVisible: await dependent.count() >= 2,
          });
          if (committed) break;
          const remove = dialog.locator('c-lookup:has(label:text-is("Cliente")) button[title="Remove selected option"]').filter({ visible: true });
          if (await remove.count() === 1) await remove.click();
        }
        await lookup.fill("");
        await lookup.pressSequentially(desired.fullName, { delay: 75 });
        const options = dialog.locator('c-lookup:has(label:text-is("Cliente")) [role="option"]').filter({ visible: true });
        await options.first().waitFor({ state: "visible", timeout: 7_000 });
        let signature = "";
        let stable = 0;
        for (let wait = 0; wait < 12 && stable < 2; wait += 1) {
          await this.page.waitForTimeout(200);
          const current = JSON.stringify(await options.allTextContents());
          stable = current === signature ? stable + 1 : 0;
          signature = current;
        }
        const exact = options.filter({ has: this.page.locator(`[data-item-id="${desired.personId}"], [data-recordid="${desired.personId}"], [data-id="${desired.personId}"]`) });
        if (await exact.count() !== 1) continue;
        await exact.click({ force: true });
        for (let check = 0; check < 25 && !committed; check += 1) {
          const marked = dialog.locator('c-lookup:has(label:text-is("Cliente")) [role="option"][aria-selected="true"]').filter({ visible: true });
          const dependent = dialog.locator('c-picklist:has(label:text-is("Ruolo")), lightning-input:has(label:text-is("Quota"))').filter({ visible: true });
          committed = lookupCommitConfirmed({
            value: await lookup.inputValue(), expected: desired.fullName,
            visibleOptionCount: await options.count(), optionMarkedSelected: await marked.count() > 0,
            readonly: await lookup.getAttribute("readonly") !== null,
            hasSelectionClass: await dialog.locator('c-lookup:has(label:text-is("Cliente")) .slds-combobox_container.slds-has-selection').count() === 1,
            dependentFieldsVisible: await dependent.count() >= 2,
          });
          if (!committed) await this.page.waitForTimeout(160);
        }
      }
      if (!committed) {
        throw new ImportV2Error("Il comproprietario è visibile ma il lookup non ne conferma la selezione", "transient_portal", { retryable: true });
      }
    }
    const role = dialog.locator('c-picklist:has(label:text-is("Ruolo"))').filter({ visible: true });
    await this.pick(role, desired.role, "Ruolo");
    const quota = await this.one(dialog.getByLabel("Quota", { exact: true }).filter({ visible: true }), "Quota");
    const expectedShare = formatDecimal(desired.sharePercentage);
    await quota.fill(expectedShare);
    if (normalized(await quota.inputValue()) !== normalized(expectedShare)) {
      throw new ImportV2Error("Quota comproprietario non confermata", "transient_portal", { retryable: true });
    }
  }

  private async addOwnership(propertyId: string, desired: OwnershipWrite): Promise<void> {
    const card = await this.ownershipCard(propertyId);
    const create = await this.one(card.getByRole("button", { name: "Nuovo", exact: true }).filter({ visible: true }), "Nuovo soggetto collegato");
    await create.click({ force: true });
    const dialog = await this.one(this.page.locator('[role="dialog"]:visible').filter({ hasText: /Soggetto correlato/i }), "Soggetto correlato", 15_000);
    await this.fillOwnershipForm(dialog, desired, true);
    const save = await this.one(dialog.getByRole("button", { name: "Salva", exact: true }).filter({ visible: true }), "Salva soggetto collegato");
    await save.click();
    const duplicate = dialog.getByText(/già.*proprietario|proprietario pri(?:n)?cipale/i).filter({ visible: true });
    const outcome = await Promise.race([
      dialog.waitFor({ state: "hidden", timeout: 15_000 }).then(() => "saved" as const),
      duplicate.first().waitFor({ state: "visible", timeout: 15_000 }).then(() => "existing" as const),
    ]);
    if (outcome === "existing") {
      const cancel = dialog.getByRole("button", { name: "Annulla", exact: true }).filter({ visible: true });
      if (await cancel.count() === 1) await cancel.click();
      await dialog.waitFor({ state: "hidden", timeout: 8_000 });
    }
  }

  private async updateOwnership(propertyId: string, desired: OwnershipWrite): Promise<void> {
    await this.relationshipAction(propertyId, desired.personId, "Modifica");
    const dialog = await this.one(this.page.locator('[role="dialog"]:visible').filter({ hasText: /Soggetto correlato/i }), "Modifica soggetto correlato", 10_000);
    await this.fillOwnershipForm(dialog, desired, false);
    const save = await this.one(dialog.getByRole("button", { name: "Salva", exact: true }).filter({ visible: true }), "Salva soggetto collegato");
    await save.click();
    await dialog.waitFor({ state: "hidden", timeout: 15_000 });
  }

  private sameShare(left: number | null, right: number | null): boolean {
    return left == null || right == null ? left == null && right == null : Math.abs(left - right) < 0.01;
  }

  async replaceManagedOwnerships(propertyId: string, desired: OwnershipWrite[]): Promise<CrmOwnershipSnapshotResult> {
    return this.action("Sincronizzazione soggetti collegati", async () => {
      if (this.dryRun) {
        const property = await this.readProperty(propertyId);
        const protectedOwners = property.owners.filter((owner) => !isManagedCrmOwnership(owner));
        const managedBefore = property.owners.filter(isManagedCrmOwnership);
        const removedPersonIds = managedBefore.filter((owner) => !desired.some((candidate) => candidate.personId === owner.personId)).map((owner) => owner.personId);
        property.owners = [...protectedOwners, ...desired.map((owner, index) => ({
          linkId: `dry-link-${index}`, personId: owner.personId, taxCode: owner.taxCode,
          sharePercentage: owner.sharePercentage, rightType: null, role: owner.role,
        }))];
        this.virtualProperties.set(propertyId, property);
        return { propertyId, owners: structuredClone(property.owners), removedPersonIds };
      }
      const before = await this.readOwnerships(propertyId);
      const unknownPrivate = before.filter((owner) => isPrivateFiscalCode(owner.taxCode)
        && !isManagedCrmOwnership(owner)
        && !/^usufrutt/.test(normalizedOwnershipRight(owner.rightType)));
      if (unknownPrivate.length) {
        throw new ImportV2Error("Uno o più soggetti privati non espongono ruolo o diritto verificabili", "verification_failed", {
          retryable: true,
          details: { personIds: unknownPrivate.map((owner) => owner.personId) },
        });
      }
      const desiredPrimary = desired.filter((owner) => owner.role === "Proprietario Principale");
      if (desiredPrimary.length !== 1) {
        throw new ImportV2Error("La fonte deve identificare un solo proprietario principale", "invalid_source");
      }
      const currentPrimary = before.find((owner) => owner.role === "Proprietario Principale") ?? null;
      await this.syncPrimaryOwnership(propertyId, desiredPrimary[0]!, currentPrimary);
      const afterPrimary = await this.readOwnerships(propertyId);
      const desiredLinked = desired.filter((owner) => owner.role !== "Proprietario Principale");
      const managed = afterPrimary.filter((owner) => isManagedCrmOwnership(owner) && owner.role !== "Proprietario Principale");
      const removedPersonIds: string[] = [];
      for (const existing of managed) {
        if (!desiredLinked.some((candidate) => candidate.personId === existing.personId)) {
          await this.deleteOwnership(propertyId, existing.personId);
          removedPersonIds.push(existing.personId);
        }
      }
      for (const owner of desiredLinked) {
        const existing = managed.find((candidate) => candidate.personId === owner.personId);
        if (existing && (!this.sameShare(existing.sharePercentage, owner.sharePercentage) || normalized(existing.role) !== normalized(owner.role))) {
          await this.updateOwnership(propertyId, owner);
        } else if (!existing) {
          await this.addOwnership(propertyId, owner);
        }
      }
      let owners = await this.readOwnerships(propertyId);
      if (!ownershipSyncConfirmed(owners, desired)) {
        await this.page.waitForTimeout(1_200);
        await this.page.reload({ waitUntil: "domcontentloaded" });
        owners = await this.readOwnerships(propertyId);
      }
      if (!ownershipSyncConfirmed(owners, desired)) {
        const managedAfter = owners.filter(isManagedCrmOwnership);
        throw new ImportV2Error("Tecnocloud non espone ancora tutti i comproprietari e le quote salvati", "transient_portal", {
          retryable: true,
          details: {
            expectedPersonIds: desired.map((owner) => owner.personId),
            actualPersonIds: managedAfter.map((owner) => owner.personId),
          },
        });
      }
      return { propertyId, owners, removedPersonIds };
    });
  }

  async readProperty(propertyId: string): Promise<CrmPropertySnapshot> {
    const virtual = this.virtualProperties.get(propertyId);
    if (virtual) return structuredClone(virtual);
    return this.action("Rilettura immobile", async () => {
      const summary = await this.readPropertySummary(propertyId);
      return { ...summary, owners: await this.readOwnerships(propertyId) };
    });
  }

  private async activityCard(propertyId: string): Promise<Locator> {
    await this.openProperty(propertyId);
    return this.one(this.page.locator("article:visible").filter({ hasText: /Attivit[aà] e appuntamenti/i }), "Attività e appuntamenti", 20_000);
  }

  async ensureActivity(propertyId: string, plan: ImportV2Plan): Promise<{ activityId: string | null; outcome: "created" | "existing" | "disabled" }> {
    if (!plan.source.activity.enabled) return { activityId: null, outcome: "disabled" };
    if (this.dryRun) return { activityId: null, outcome: "existing" };
    return this.action("Attività immobile", async () => {
      const card = await this.activityCard(propertyId);
      const cardText = normalized(await card.innerText());
      const description = plan.source.activity.description?.trim() || "Inserire attività";
      if (cardText.includes(normalized(description)) || this.submittedActivities.has(propertyId)) {
        return { activityId: null, outcome: "existing" };
      }
      const create = await this.one(card.getByRole("button", { name: "Nuovo", exact: true }).filter({ visible: true }), "Nuova attività");
      await create.click();
      const dialog = await this.one(this.page.locator('[role="dialog"]:visible'), "Attività", 20_000);
      const descriptionField = await this.one(dialog.locator('c-input-field:has-text("Descrizione") textarea').filter({ visible: true }), "Descrizione attività", 20_000);
      await descriptionField.fill(description);
      const related = await this.one(dialog.locator('c-input-field:has-text("Correlato a") input').filter({ visible: true }), "Correlato a");
      let relatedValue = (await related.inputValue()).trim();
      for (let wait = 0; !relatedValue && wait < 10; wait += 1) { await this.page.waitForTimeout(250); relatedValue = (await related.inputValue()).trim(); }
      if (!/^IM\s*-/i.test(relatedValue)) {
        throw new ImportV2Error("L’attività non è correlata all’immobile aperto", "transient_portal", { retryable: true });
      }
      const client = await this.one(dialog.locator('c-input-field:has-text("Cliente") input').filter({ visible: true }), "Cliente attività");
      let clientValue = (await client.inputValue()).trim();
      for (let wait = 0; !clientValue && wait < 10; wait += 1) { await this.page.waitForTimeout(250); clientValue = (await client.inputValue()).trim(); }
      if (!clientValue) throw new ImportV2Error("Cliente obbligatorio dell’attività non valorizzato", "transient_portal", { retryable: true });
      await this.pick(dialog.locator('c-input-field:has-text("Modalit"):has-text("Contatto")').filter({ visible: true }), plan.source.activity.contactMode, "Modalità contatto");
      await this.pick(dialog.locator('c-input-field:has-text("Stato")').filter({ visible: true }), plan.source.activity.status, "Stato attività");
      if (normalized(await descriptionField.inputValue()) !== normalized(description)) {
        throw new ImportV2Error("Descrizione attività non confermata", "transient_portal", { retryable: true });
      }
      const save = await this.one(dialog.getByRole("button", { name: "Salva", exact: true }).filter({ visible: true }), "Salva attività");
      await save.click();
      this.submittedActivities.add(propertyId);
      await descriptionField.waitFor({ state: "hidden", timeout: 15_000 });
      const followUp = this.page.locator('[role="dialog"]:visible').filter({ hasText: /Vuoi pianificare un'altra attività\/appuntamento/i });
      if (await followUp.count()) {
        const cancel = followUp.getByRole("button", { name: "Annulla", exact: true }).filter({ visible: true });
        if (await cancel.count() === 1) await cancel.click();
      }
      return { activityId: null, outcome: "created" };
    });
  }

  async recover(_stage: ImportV2Checkpoint["stage"], _error: unknown): Promise<void> {
    await this.assertSession();
    /* Il tentativo successivo sa già aprire la pagina necessaria. Tornare alla
     * home qui aggiungeva un caricamento completo ad ogni errore transitorio e
     * poteva lasciare due navigazioni concorrenti. Si smontano invece, dalla
     * più interna, solo le modal rimaste a metà. */
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const dialogs = this.page.locator('[role="dialog"]:visible');
      const count = await dialogs.count();
      if (!count) break;
      const dialog = dialogs.last();
      const cancel = dialog.getByRole("button", { name: /Annulla|Chiudi|Close/i }).filter({ visible: true });
      const close = dialog.locator('button[aria-label*="Chiudi" i], button[aria-label*="Close" i], button[title*="Chiudi" i], button[title*="Close" i]').filter({ visible: true });
      const action = await cancel.count() ? cancel.last() : await close.count() ? close.last() : null;
      if (!action) break;
      await action.click({ force: true }).catch(() => undefined);
      await dialog.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => undefined);
    }
    await this.assertSession();
  }
}
