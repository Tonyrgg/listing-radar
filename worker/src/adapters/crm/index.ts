import type { Locator, Page } from "playwright";

import { SelectorConfigurationError, WorkerError } from "../../core/errors.js";
import { selectOwnerLookupCandidate } from "../../core/owner-link-selection.js";
import { addressIdentity, formatPersonName, formatShareForUi, genderFromTaxCode, normalizePhone, parsePropertyAddress, samePropertyAddress, samePropertyAddressWithMissingCivicSuffix, splitPersonName } from "../../core/normalize.js";
import { propertyFormValues } from "../../core/property-form.js";
import type {
  CrmActivityInput,
  CrmActivityResult,
  CrmAdapter,
  CrmContactTransferResult,
  CrmPhoneAssignment,
  NormalizedPerson,
  NormalizedProperty,
  OwnerLinkInput,
  OwnerLinkResult,
  PersonCreationResult,
  PersonMatchResult,
  PersonMergeResult,
  PersonSearchInput,
  PropertyMatchResult,
} from "../../types.js";
import { logger } from "../../logger.js";
import { crmSelectors, type CrmSelectors } from "./selectors.js";

const CRM_PATH = "/CRMImmobiliareLightning/s";
/** Oltre questa soglia un'azione sul gestionale merita una riga nel registro. */
const AZIONE_LENTA_MS = 3_000;

const ACTIVITY_FORM_TIMEOUT = 20_000;
// CRM renders the activity modal in several asynchronous phases. A failed
// preparation has not produced any data yet, so it is safe to retry it three
// times from a freshly loaded property. Once "Salva" has been clicked we keep
// the separate, conservative path below to avoid creating duplicate activities.
const ACTIVITY_PRE_SAVE_ATTEMPTS = 3;
const ACTIVITY_PREFILL_WAIT_CYCLES = process.env.VITEST ? 2 : 32;
const PERSON_MERGE_ID_WAIT_CYCLES = 40;

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

function isPropertyActivityRelation(value: string) {
  return /^\s*IM\s*-/i.test(value);
}

function isNewsOrMandateActivityRelation(value: string) {
  return /^\s*(?:NT|IN)\s*-/i.test(value);
}

function comparableCadastralValue(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, "").replace(/^0+(?=\d)/, "").toUpperCase();
}

function hasSameCadastralIdentity(
  identity: { sheet: string; parcel: string; subaltern: string },
  property: Pick<NormalizedProperty, "sheet" | "parcel" | "subaltern">,
) {
  const expected = [property.sheet, property.parcel, property.subaltern].map(comparableCadastralValue);
  const actual = [identity.sheet, identity.parcel, identity.subaltern].map(comparableCadastralValue);
  return expected.every(Boolean)
    && actual.every(Boolean)
    && expected.every((value, index) => value === actual[index]);
}

function hasSameMunicipality(rawAddress: string | null | undefined, municipality: string | null | undefined) {
  const expected = normalizedUiText(municipality ?? "");
  if (!expected) return false;
  const address = normalizedUiText(rawAddress ?? "");
  const expectedWords = expected.split(" ").filter(Boolean);
  const addressWords = address.split(" ").filter(Boolean);
  return expectedWords.length > 0 && expectedWords.every((word) => addressWords.includes(word));
}

/**
 * The full related-records modal renders property names as
 * `IM - <address> - <zone>`.  Use that cheap, deterministic hint before
 * opening records; the detail page remains the source of truth.
 */
function propertyListLabelMatchesAddress(label: string, expectedAddress: string | null | undefined) {
  const withoutPrefix = label.replace(/^\s*IM\s*-\s*/i, "").trim();
  if (!withoutPrefix) return false;
  const withoutTrailingZone = withoutPrefix.replace(/\s+-\s+[^-]+$/, "").trim();
  return samePropertyAddress(withoutTrailingZone, expectedAddress);
}

function recordIdFromHref(href: string | null, entity: "account" | "immobile") {
  return href?.match(new RegExp(`/s/${entity}/([^/?#]+)`, "i"))?.[1] ?? "";
}

export class PlaywrightCrmAdapter implements CrmAdapter {
  /**
   * Un ID account puÃ² sparire durante una run dopo un merge eseguito nel Cloud.
   * Conserviamo la ricerca verificata che lo ha prodotto per poterlo risolvere
   * di nuovo senza chiedere al runner di conoscere i dettagli del portale.
   */
  private readonly personSearchInputsByCrmId = new Map<string, PersonSearchInput>();

  constructor(
    private readonly page: Page,
    private readonly dryRun: boolean,
    private readonly selectors: CrmSelectors = crmSelectors,
  ) {}

  private require(...keys: Array<keyof CrmSelectors>) {
    const missing = keys.filter((key) => !this.selectors[key]);
    if (missing.length) throw new SelectorConfigurationError("CRM", missing);
  }

  /**
   * Ogni azione sul gestionale, cronometrata.
   *
   * Solo osservazione: qui non si cambia niente di quello che il worker fa ne'
   * di quanto aspetta. Serve a sapere dove va il tempo di una run prima di
   * decidere se e dove valga la pena intervenire.
   */
  private async friendly<T>(action: string, message: string, work: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await work();
      const durationMs = Date.now() - startedAt;
      if (durationMs >= AZIONE_LENTA_MS) {
        logger.info({ portal: "CRM", action, durationMs }, "Azione gestionale lenta");
      } else {
        logger.debug({ portal: "CRM", action, durationMs }, "Azione gestionale conclusa");
      }
      return result;
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

  private async isAccessDeniedPage() {
    if (this.selectors.accessDeniedMarker && await this.visible(this.selectors.accessDeniedMarker).count()) return true;
    const body = normalizedUiText(await this.page.locator("body").innerText().catch(() => ""));
    return body.includes("ACCESSO NEGATO")
      && body.includes("NON ESISTE OPPURE NON HAI I DIRITTI");
  }

  private async throwIfAccessDenied(personId?: string) {
    if (!(await this.isAccessDeniedPage())) return;
    throw new WorkerError(
      "La vecchia scheda nominativo non esiste più dopo il merge. Il worker tornerà alla home e ricercherà il nominativo aggiornato.",
      "portal_error",
      { portal: "CRM", action: "person-record-merged-away", personId, pageUrl: this.page.url() },
    );
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

  /**
   * Unlike closeKnownStaleActivityForm, this is used only while retrying the
   * activity that this same adapter has just opened. Its description may be a
   * legitimate non-default value (for example "Non sa nulla"), therefore it
   * must not be mistaken for a user-authored modal and prevent recovery.
   */
  private async discardWorkerActivityFormForRetry() {
    if (!(await this.isActivityFormOpen())) return false;
    const description = await this.uniqueVisible("activityDescription", "Descrizione attività", 5_000);
    const cancel = await this.uniqueVisible("activityCancel", "Annulla attivitÃ ", 5_000);
    await cancel.click().catch(async () => this.page.keyboard.press("Escape"));
    await description.waitFor({ state: "hidden", timeout: 10_000 });
    return true;
  }

  /** Wait until the dynamic controls stop being replaced by the CRM renderer. */
  private async waitForActivityFormToSettle() {
    const description = await this.uniqueVisible("activityDescription", "Descrizione attività", ACTIVITY_FORM_TIMEOUT);
    const client = await this.uniqueVisible("activityClient", "Cliente dell’attività", ACTIVITY_FORM_TIMEOUT);
    const relatedField = await this.uniqueVisible("activityRelatedProperty", "Correlato a", ACTIVITY_FORM_TIMEOUT);
    const relatedInput = relatedField.locator("input").filter({ visible: true });
    const contactMode = await this.uniqueVisible("activityContactMode", "Modalità contatto", ACTIVITY_FORM_TIMEOUT);
    const status = await this.uniqueVisible("activityStatus", "Stato attivitÃ ", ACTIVITY_FORM_TIMEOUT);
    if (await relatedInput.count() !== 1) return;

    let previous: string | null = null;
    for (let check = 0; check < 5; check += 1) {
      const snapshot = await Promise.all([
        description.inputValue(),
        client.inputValue(),
        relatedInput.inputValue(),
        contactMode.inputValue(),
        status.inputValue(),
      ]).then((values) => values.join("\u0001"));
      if (snapshot === previous) return;
      previous = snapshot;
      await this.page.waitForTimeout(250);
    }
  }

  private async closeActivityFollowUpPrompt(waitForAppearance = false) {
    if (!this.selectors.activityFollowUpDialog || !this.selectors.activityFollowUpCancel || !this.selectors.activityFollowUpClose) return false;
    const dialogs = this.visible(this.selectors.activityFollowUpDialog);
    if (waitForAppearance && !(await dialogs.count())) {
      await dialogs.first().waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
    }
    const count = await dialogs.count();
    if (!count) return false;
    if (count !== 1) {
      throw new WorkerError(
        "Il gestionale mostra più finestre per pianificare la prossima attività. Il worker non sceglie quale chiudere.",
        "needs_review",
        { portal: "CRM", action: "activity-follow-up-prompt-ambiguous", count },
        true,
      );
    }
    const dialog = dialogs.first();
    const promptText = normalizedUiText(await dialog.innerText().catch(() => ""));
    if (!promptText.includes("VUOI PIANIFICARE UN ALTRA ATTIVITA")) return false;

    const cancel = dialog.locator(this.selectors.activityFollowUpCancel).filter({ visible: true });
    const close = dialog.locator(this.selectors.activityFollowUpClose).filter({ visible: true });
    const cancelCount = await cancel.count();
    const closeCount = await close.count();
    if (cancelCount === 1) await cancel.click();
    else if (closeCount === 1) await close.click();
    else {
      throw new WorkerError(
        "La richiesta di pianificare un'altra attività è aperta ma non espone Annulla né la chiusura.",
        "needs_review",
        { portal: "CRM", action: "activity-follow-up-prompt-without-close", cancelCount, closeCount },
        true,
      );
    }
    await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(async () => {
      await this.page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    });
    return true;
  }

  private async closeDeferredOwnerForm() {
    if (!this.selectors.ownerDialog || !this.selectors.ownerCancel) return false;
    const dialogs = this.visible(this.selectors.ownerDialog);
    if (!(await dialogs.count())) return false;
    const dialog = dialogs.first();
    const cancel = dialog.locator(this.selectors.ownerCancel).filter({ visible: true });
    if (!(await cancel.count())) {
      throw new WorkerError(
        "La finestra Soggetto correlato è aperta ma non espone il comando Annulla.",
        "needs_review",
        { portal: "CRM", action: "deferred-owner-dialog-without-cancel" },
        true,
      );
    }
    await cancel.first().click();
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    return true;
  }

  private async ensureCrmIdle() {
    await this.checkSession();
    await this.settleVisiblePersonMergeAfterSave();
    await this.closeActivityFollowUpPrompt();
    await this.closeKnownStaleActivityForm();
    await this.closeDeferredOwnerForm();
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

  private rememberPersonSearchInput(personId: string, input: PersonSearchInput) {
    if (personId) this.personSearchInputsByCrmId.set(personId, input);
  }

  private async openPersonRecord(personId: string): Promise<void> {
    await this.ensureCrmIdle();
    await this.throwIfAccessDenied(personId);
    if (this.page.url().includes(`/s/account/${personId}`)) {
      await this.waitForPersonWorkspace(personId);
      return;
    }
    const fixtureRow = this.page.locator(this.selectors.personResultRows).filter({ has: this.page.locator(this.selectors.personResultId, { hasText: personId }) });
    if (await fixtureRow.count()) {
      await fixtureRow.first().locator(this.selectors.personResultOpen).first().click();
      await this.waitForPersonWorkspace(personId);
      return;
    }
    await this.page.goto(new URL(`${CRM_PATH}/account/${personId}`, this.page.url()).toString(), { waitUntil: "domcontentloaded" });
    await this.checkSession();
    await this.throwIfAccessDenied(personId);
    await this.waitForPersonWorkspace(personId);
  }

  private async openPerson(personId: string): Promise<string> {
    try {
      await this.openPersonRecord(personId);
      return personId;
    } catch (error) {
      if (!(error instanceof WorkerError) || error.details.action !== "person-record-merged-away") {
        throw error;
      }
      const input = this.personSearchInputsByCrmId.get(personId);
      if (!input) throw error;
      const recovered = await this.recoverMergedPerson(input, personId);
      if (!recovered) {
        throw new WorkerError(
          "La scheda precedente e stata unita, ma la ricerca non trova una scheda finale con stesso codice fiscale e nominativo.",
          "needs_review",
          { portal: "CRM", action: "person-record-merged-recovery-not-found", personId },
          true,
        );
      }
      this.rememberPersonSearchInput(recovered.id, input);
      return recovered.id;
    }
  }

  private async waitForPersonWorkspace(personId?: string) {
    this.require("personPropertiesCard");
    await this.checkSession();
    await this.throwIfAccessDenied(personId);
    const card = this.visible(this.selectors.personPropertiesCard).first();
    if (await card.waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false)) return;
    const target = personId ? new URL(`${CRM_PATH}/account/${personId}`, this.page.url()).toString() : this.page.url();
    await this.page.goto(target, { waitUntil: "domcontentloaded" });
    await this.checkSession();
    await this.throwIfAccessDenied(personId);
    if (await card.waitFor({ state: "visible", timeout: 25_000 }).then(() => true).catch(() => false)) return;
    throw new WorkerError(
      "La scheda nominativo è aperta, ma la sezione Immobili/Notizie/Incarichi non ha terminato il caricamento.",
      "portal_error",
      { portal: "CRM", action: "person-workspace-ready", personId, pageUrl: this.page.url(), attempts: 2 },
      true,
    );
  }

  /**
   * Tecnocloud's "Visualizza tutto" list is a normal intermediate state while
   * reading a person's properties, not a reason to stop the import. If it is
   * still open when a property step starts, use its Nome link only for the
   * exact CRM property requested by the run. A missing/ambiguous row is closed
   * and the known record URL is used below instead.
   */
  private async openPropertyFromVisiblePersonPropertiesModal(propertyId: string) {
    if (!this.selectors.personPropertiesModal) return false;
    const modals = this.visible(this.selectors.personPropertiesModal);
    const modalCount = await modals.count();
    if (!modalCount) return false;
    if (modalCount !== 1) {
      throw new WorkerError(
        "Il gestionale mostra più elenchi Immobili/Notizie/Incarichi. Il worker non sceglie una finestra ambigua.",
        "needs_review",
        { portal: "CRM", action: "person-properties-modal-ambiguous", propertyId, modalCount },
        true,
      );
    }
    this.require("personPropertiesModalName", "personPropertiesModalClose");
    const modal = modals.first();
    const names = modal.locator(this.selectors.personPropertiesModalName).filter({ visible: true });
    const matchingIndexes: number[] = [];
    for (let index = 0; index < await names.count(); index += 1) {
      const name = names.nth(index);
      const href = await name.getAttribute("href").catch(() => null);
      const rowPropertyId = await name.getAttribute("data-recordid").catch(() => null)
        ?? await name.getAttribute("data-id").catch(() => null)
        ?? recordIdFromHref(href, "immobile");
      if (rowPropertyId === propertyId) matchingIndexes.push(index);
    }
    if (matchingIndexes.length === 1) {
      const target = names.nth(matchingIndexes[0]!);
      await target.click();
      const reached = await this.page.waitForURL(new RegExp(`/s/immobile/${propertyId}(?:[/?#]|$)`, "i"), { timeout: 12_000 })
        .then(() => true)
        .catch(() => false);
      if (reached) return true;
    }

    const close = modal.locator(this.selectors.personPropertiesModalClose).filter({ visible: true }).last();
    if (await close.count()) await close.click({ force: true }).catch(() => undefined);
    if (await modal.isVisible().catch(() => false)) await this.page.keyboard.press("Escape").catch(() => undefined);
    await modal.waitFor({ state: "hidden", timeout: 8_000 }).catch(() => undefined);
    return false;
  }

  private async openProperty(propertyId: string, refresh = false) {
    await this.openPropertyFromVisiblePersonPropertiesModal(propertyId);
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

  private async collectPersonPropertyLinks(card: Locator, personId: string) {
    this.require("personPropertyLinks");
    const fromCard = await card.locator(this.selectors.personPropertyLinks).evaluateAll((links) => links.map((link) => ({
      href: link.getAttribute("href") ?? "",
      id: link.getAttribute("data-recordid") ?? link.getAttribute("data-id") ?? "",
      label: (link.textContent ?? "").replace(/\s+/g, " ").trim(),
    })));
    const cardLinks = fromCard.filter(({ href, id }) => Boolean(href || id));
    if (!this.selectors.personPropertiesViewAll) return { links: cardLinks, fullListOpened: false };

    const viewAll = card.locator(this.selectors.personPropertiesViewAll).filter({ visible: true }).first();
    if (!(await viewAll.count())) return { links: cardLinks, fullListOpened: false };

    this.require(
      "personPropertiesModal",
      "personPropertiesModalRows",
      "personPropertiesModalName",
      "personPropertiesModalClose",
    );
    await viewAll.click({ force: true });
    const modal = this.visible(this.selectors.personPropertiesModal).first();
    const opened = await modal.waitFor({ state: "visible", timeout: 12_000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) {
      throw new WorkerError(
        "Il gestionale mostra “Visualizza tutto”, ma non apre l’elenco completo degli immobili.",
        "portal_error",
        { portal: "CRM", action: "person-properties-modal-not-opened", personId },
        true,
      );
    }

    const rows = modal.locator(this.selectors.personPropertiesModalRows);
    const propertyLinks: Array<{ href: string; id: string; label: string }> = [];
    const unreadableProperties: Array<{ rowIndex: number; label: string }> = [];
    for (let index = 0; index < await rows.count(); index += 1) {
      const row = rows.nth(index);
      const name = row.locator(this.selectors.personPropertiesModalName).first();
      const label = ((await name.textContent().catch(() => null)) ?? (await row.textContent().catch(() => null)) ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (!/^\s*IM\s*-/i.test(label)) continue;
      const rawHref = await name.getAttribute("href").catch(() => null) ?? "";
      const id = await name.getAttribute("data-recordid").catch(() => null)
        ?? await name.getAttribute("data-id").catch(() => null)
        ?? recordIdFromHref(rawHref, "immobile");
      const href = /\/s\/immobile\//i.test(rawHref) || rawHref.startsWith("#fixture-property")
        ? rawHref
        : "";
      if (!href && !id) {
        unreadableProperties.push({ rowIndex: index, label });
        continue;
      }
      propertyLinks.push({
        href: href || `${CRM_PATH}/immobile/${id}`,
        id,
        label,
      });
    }

    const close = modal.locator(this.selectors.personPropertiesModalClose).filter({ visible: true }).last();
    if (await close.count()) await close.click({ force: true }).catch(() => undefined);
    if (await modal.isVisible().catch(() => false)) await this.page.keyboard.press("Escape").catch(() => undefined);
    await modal.waitFor({ state: "hidden", timeout: 8_000 }).catch(() => undefined);

    if (unreadableProperties.length) {
      throw new WorkerError(
        "L’elenco completo contiene immobili che il gestionale non permette di aprire. Per evitare duplicati il worker non crea un nuovo immobile.",
        "needs_review",
        {
          portal: "CRM",
          action: "person-properties-modal-unreadable",
          personId,
          unreadableProperties,
        },
        true,
      );
    }

    return {
      links: propertyLinks.filter((link, index, links) => {
        const key = link.id || link.href;
        return links.findIndex((candidate) => (candidate.id || candidate.href) === key) === index;
      }),
      fullListOpened: true,
    };
  }

  async verifyProperty(id: string, property: NormalizedProperty): Promise<PropertyMatchResult> {
    if (id.startsWith("dry-property-")) {
      return { match: { id, data: { source: "dry-property-verification", identityVerified: true } } };
    }
    return this.friendly("property-identity-check", "Non riesco a verificare l'identità dell'immobile aperto.", async () => {
      await this.openProperty(id);
      const identity = await this.readPropertyIdentity();
      const cadastralMatch = hasSameCadastralIdentity(identity, property);
      const strictAddressMatch = samePropertyAddress(identity.rawAddress, property.address);
      const addressSuffixRecovered = cadastralMatch
        && !strictAddressMatch
        && samePropertyAddressWithMissingCivicSuffix(identity.rawAddress, property.address);
      const addressMatches = strictAddressMatch || addressSuffixRecovered;
      const municipalityMatches = hasSameMunicipality(identity.rawAddress, property.municipality);
      /* La sola terna non basta: puo' esistere in Comuni diversi e, in caso
       * di dati incoerenti, non autorizza mai a toccare una scheda gia'
       * presente. */
      if (!cadastralMatch || !addressMatches || !municipalityMatches) return { match: null };
      return {
        match: {
          id,
          data: {
            source: "crm-property-identity",
            identityVerified: true,
            addressMatches,
            addressSuffixRecovered,
            municipalityMatches,
            ...identity,
          },
        },
      };
    });
  }

  private async currentPersonId() {
    const fromUrl = recordIdFromHref(this.page.url(), "account");
    if (fromUrl) return fromUrl;
    if (!this.selectors.recordId) return "";
    return (await this.page.locator(this.selectors.recordId).first().textContent())?.trim() ?? "";
  }

  private async currentPropertyId() {
    const fromUrl = recordIdFromHref(this.page.url(), "immobile");
    if (fromUrl) return fromUrl;
    if (!this.selectors.recordId) return "";
    return (await this.page.locator(this.selectors.recordId).first().textContent())?.trim() ?? "";
  }

  async detectPage(): Promise<boolean> {
    this.require("pageMarker");
    await this.checkSession();
    return (await this.page.locator(this.selectors.pageMarker).count()) > 0;
  }

  private async verifyCurrentPerson(input: PersonSearchInput, expectedId?: string) {
    const personId = await this.currentPersonId();
    if (!personId || (expectedId && personId !== expectedId)) return null;
    await this.checkSession();
    const body = normalizedUiText(await this.page.locator("body").innerText());
    const taxCode = normalizedUiText(input.taxCode).replaceAll(" ", "");
    const compactBody = body.replaceAll(" ", "");
    if (!taxCode || !compactBody.includes(taxCode)) return null;
    const nameWords = normalizedUiText(input.fullName).split(" ").filter((word) => word.length > 1);
    const nameVerified = !nameWords.length || nameWords.every((word) => body.includes(word));
    return {
      id: personId,
      // The tax code is the only identity key.  A different name is precisely
      // why the existing record must be overwritten with the SISTER data.
      data: { source: "crm-open-person", taxCodeVerified: true, nameVerified, pageUrl: this.page.url() },
    };
  }

  private async recoverMergedPerson(input: PersonSearchInput, inaccessibleId: string) {
    const homeUrl = new URL(CRM_PATH, this.page.url()).toString();
    await this.page.goto(homeUrl, { waitUntil: "domcontentloaded" });
    await this.checkSession();
    const result = await this.findPerson(input);
    for (const candidate of result.matches) {
      try {
        await this.openPerson(candidate.id);
      } catch (error) {
        if (!(error instanceof WorkerError) || error.details.action !== "person-record-merged-away") throw error;
        await this.page.goto(homeUrl, { waitUntil: "domcontentloaded" });
        continue;
      }
      const verified = await this.verifyCurrentPerson(input, candidate.id);
      if (verified) {
        this.rememberPersonSearchInput(verified.id, input);
        return {
          ...verified,
          data: {
            ...verified.data,
            source: "crm-merged-person-recovery",
            inaccessiblePersonId: inaccessibleId,
            recoveredFromAccessDenied: true,
          },
        };
      }
    }
    return null;
  }

  async openExistingPerson(input: PersonSearchInput, expectedId?: string) {
    return this.friendly("person-existing-check", "Non riesco a verificare la scheda nominativo aperta.", async () => {
      if (expectedId) {
        this.rememberPersonSearchInput(expectedId, input);
        const openedId = await this.openPerson(expectedId);
        const verified = await this.verifyCurrentPerson(input, openedId);
        if (verified && openedId !== expectedId) {
          return {
            ...verified,
            data: {
              ...verified.data,
              source: "crm-merged-person-recovery",
              inaccessiblePersonId: expectedId,
              recoveredFromAccessDenied: true,
            },
          };
        }
        // A merge can redirect the old URL without showing Accesso negato.
        // Do not retain that stale record ID: search the CRM normally instead.
        return verified ?? this.recoverMergedPerson(input, expectedId);
      }
      return this.verifyCurrentPerson(input, expectedId);
    });
  }

  async syncPersonContacts(targetPersonId: string, person: NormalizedPerson): Promise<void> {
    if (this.dryRun) return;
    await this.friendly("person-contacts-sync", "Non riesco ad aggiornare i recapiti del nominativo.", async () => {
      await this.openPerson(targetPersonId);
      await this.editExistingPersonContacts({ mobiles: person.mobiles, landlines: person.landlines, emails: person.emails });
    });
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
      return { matches };
    });
  }

  async findPhoneAssignments(phones: string[]): Promise<CrmPhoneAssignment[]> {
    const normalizedPhones = [...new Set(phones.map(normalizePhone).filter(Boolean))];
    if (!normalizedPhones.length) return [];
    return this.friendly("phone-assignment-search", "Non riesco a verificare a chi sono assegnati i recapiti.", async () => {
      this.require("personSearchPage", "personSearchPhone", "personSearchSubmit", "personResultRows", "personResultId", "personResultLabel");
      await this.ensureCrmIdle();
      const navigation = await this.uniqueVisible("personSearchPage", "sezione Nominativi");
      const href = await navigation.getAttribute("href");
      await navigation.click();
      if (href && !(await this.page.waitForURL(/\/s\/account\/Account(?:[/?#]|$)/i, { timeout: 10_000 }).then(() => true).catch(() => false))) {
        await this.page.goto(new URL(href, this.page.url()).toString(), { waitUntil: "domcontentloaded" });
      }
      const assignments: CrmPhoneAssignment[] = [];
      for (const phone of normalizedPhones) {
        await this.enterGlobalSearch(this.selectors.personSearchPhone, this.selectors.personSearchSubmit, phone);
        await this.checkSession();
        for (const match of await this.collectPersonMatches("possible", "crm-phone-assignment", phone)) {
          if (!assignments.some((item) => item.phone === phone && item.personId === match.id)) {
            assignments.push({ phone, personId: match.id, label: match.label });
          }
        }
      }
      return assignments;
    });
  }

  async findMissingPersonPhones(personId: string, phones: string[]): Promise<string[]> {
    const desiredPhones = [...new Set(phones.map(normalizePhone).filter(Boolean))];
    if (!desiredPhones.length) return [];
    return this.friendly("person-contact-coverage", "Non riesco a verificare i recapiti già presenti nel nominativo.", async () => {
      await this.openPerson(personId);
      const labels = ["Cellulare", "Telefono fisso", "Telefono Ufficio", "Altro telefono"] as const;
      const existingPhones = new Set<string>();
      for (const label of labels) {
        const value = normalizePhone(await this.readPersonDetailContact(label));
        if (value) existingPhones.add(value);
      }
      return desiredPhones.filter((phone) => !existingPhones.has(phone));
    });
  }

  private personDetailRow(label: string) {
    return this.page.locator(`div.flex:has(> div > label:text-is("${label}"))`).filter({ visible: true });
  }

  private async readPersonDetailContact(label: string) {
    const row = this.personDetailRow(label);
    if (await row.count() !== 1) return "";
    const value = row.locator(".slds-form-element__static .slds-grow").filter({ visible: true });
    if (await value.count() !== 1) return "";
    return (await value.first().innerText().catch(() => "")).trim();
  }

  private async editExistingPersonContacts(input: {
    removePhones?: Set<string>;
    mobiles?: string[];
    landlines?: string[];
    emails?: string[];
  }) {
    const labels = ["Email", "Email Secondaria", "Cellulare", "Telefono fisso", "Telefono Ufficio", "Altro telefono"] as const;
    const phoneLabels = ["Cellulare", "Telefono fisso", "Telefono Ufficio", "Altro telefono"] as const;
    const emailLabels = ["Email", "Email Secondaria"] as const;
    const before = new Map<string, string>();
    for (const label of labels) before.set(label, await this.readPersonDetailContact(label));

    const removePhones = input.removePhones ?? new Set<string>();
    const duplicatePhoneLabels = new Set<string>();
    const retainedPhones = new Set<string>();
    for (const label of phoneLabels) {
      const phone = normalizePhone(before.get(label) ?? "");
      if (!phone || removePhones.has(phone)) continue;
      if (retainedPhones.has(phone)) duplicatePhoneLabels.add(label);
      else retainedPhones.add(phone);
    }
    const duplicateEmailLabels = new Set<string>();
    const retainedEmails = new Set<string>();
    for (const label of emailLabels) {
      const email = (before.get(label) ?? "").trim().toLowerCase();
      if (!email) continue;
      if (retainedEmails.has(email)) duplicateEmailLabels.add(label);
      else retainedEmails.add(email);
    }
    const desiredMobiles = [...new Set((input.mobiles ?? []).map(normalizePhone).filter(Boolean))];
    const desiredMobileSet = new Set(desiredMobiles);
    const desiredLandlines = [...new Set((input.landlines ?? []).map(normalizePhone).filter((value) => value && !desiredMobileSet.has(value)))];
    const desiredEmails = [...new Set((input.emails ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))];
    const missingMobiles = desiredMobiles.filter((value) => !retainedPhones.has(value));
    const missingLandlines = desiredLandlines.filter((value) => !retainedPhones.has(value));
    const missingEmails = desiredEmails.filter((value) => !retainedEmails.has(value));
    const mustRemove = phoneLabels.some((label) => removePhones.has(normalizePhone(before.get(label) ?? "")));
    if (
      !mustRemove
      && !duplicatePhoneLabels.size
      && !duplicateEmailLabels.size
      && !missingMobiles.length
      && !missingLandlines.length
      && !missingEmails.length
    ) {
      return { changed: false, removed: [] as string[], overflow: [] as string[] };
    }

    const triggerCandidates = this.page.locator("div.flex button.inline-edit-trigger").filter({ visible: true });
    if (!(await triggerCandidates.count())) {
      throw new WorkerError("La scheda nominativo non mostra il comando per modificare i recapiti.", "portal_error", { portal: "CRM", action: "person-contact-edit-open" }, true);
    }
    const preferredTrigger = this.personDetailRow("Cellulare").locator("button.inline-edit-trigger").filter({ visible: true });
    await (await preferredTrigger.count() === 1 ? preferredTrigger : triggerCandidates.first()).click();

    const fields = new Map<string, Locator>();
    for (const label of labels) {
      const field = this.page.getByLabel(label, { exact: true }).filter({ visible: true });
      await field.first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
      if (await field.count() === 1) fields.set(label, field.first());
    }
    if (!fields.has("Cellulare") && !fields.has("Telefono fisso")) {
      throw new WorkerError("La modifica recapiti si è aperta, ma i campi telefono non sono disponibili.", "portal_error", { portal: "CRM", action: "person-contact-edit-fields" }, true);
    }

    const removed: string[] = [];
    for (const label of phoneLabels) {
      const field = fields.get(label);
      if (!field) continue;
      const current = normalizePhone(await field.inputValue());
      if (current && (removePhones.has(current) || duplicatePhoneLabels.has(label))) {
        await field.fill("");
        if (removePhones.has(current)) removed.push(current);
      }
    }
    for (const label of emailLabels) {
      const field = fields.get(label);
      if (field && duplicateEmailLabels.has(label)) {
        await field.fill("");
      }
    }

    const assignMissing = async (values: string[], preferredLabels: string[]) => {
      const overflow: string[] = [];
      const assignedValues = new Set<string>();
      for (const field of fields.values()) {
        const value = (await field.inputValue()).trim();
        const normalized = value.includes("@") ? value.toLowerCase() : normalizePhone(value);
        if (normalized) assignedValues.add(normalized);
      }
      for (const value of values) {
        if (assignedValues.has(value)) continue;
        let assigned = false;
        for (const label of preferredLabels) {
          const field = fields.get(label);
          if (!field || (await field.inputValue()).trim()) continue;
          await field.fill(value);
          assignedValues.add(value);
          assigned = true;
          break;
        }
        if (!assigned) overflow.push(value);
      }
      return overflow;
    };
    const overflow = [
      ...await assignMissing(missingMobiles, ["Cellulare", "Altro telefono", "Telefono Ufficio"]),
      ...await assignMissing(missingLandlines, ["Telefono fisso", "Telefono Ufficio", "Altro telefono"]),
      ...await assignMissing(missingEmails, ["Email", "Email Secondaria"]),
    ];

    const save = this.page.getByRole("button", { name: "Salva", exact: true }).filter({ visible: true });
    if (await save.count() !== 1) {
      throw new WorkerError("La modifica recapiti non mostra un solo pulsante Salva.", "portal_error", { portal: "CRM", action: "person-contact-edit-save", count: await save.count() }, true);
    }
    await save.click();
    await this.page.waitForTimeout(700);
    await this.checkSession();
    await this.settleVisiblePersonMergeAfterSave();
    return { changed: true, removed, overflow };
  }

  async transferPhoneAssignments(
    targetPersonId: string,
    person: NormalizedPerson,
    assignments: CrmPhoneAssignment[],
  ): Promise<CrmContactTransferResult> {
    const desiredPhones = new Set([...person.mobiles, ...person.landlines].map(normalizePhone).filter(Boolean));
    const relevant = assignments.filter((assignment) => desiredPhones.has(normalizePhone(assignment.phone)));
    const alreadyAssigned = [...new Set(relevant.filter((assignment) => assignment.personId === targetPersonId).map((assignment) => normalizePhone(assignment.phone)))];
    const conflicts = relevant.filter((assignment) => assignment.personId !== targetPersonId);
    const unresolved: NonNullable<CrmContactTransferResult["unresolved"]> = [];
    const ambiguousPhones = new Set<string>();
    for (const phone of desiredPhones) {
      const owners = [...new Set(conflicts.filter((assignment) => normalizePhone(assignment.phone) === phone).map((assignment) => assignment.personId))];
      if (owners.length > 1) {
        ambiguousPhones.add(phone);
        unresolved.push({ phone, personIds: owners, reason: "multiple_assignments" });
      }
    }
    const safeConflicts = conflicts.filter((assignment) => !ambiguousPhones.has(normalizePhone(assignment.phone)));
    const safePerson = {
      ...person,
      mobiles: person.mobiles.filter((phone) => !ambiguousPhones.has(normalizePhone(phone))),
      landlines: person.landlines.filter((phone) => !ambiguousPhones.has(normalizePhone(phone))),
    };
    if (this.dryRun) {
      return {
        moved: safeConflicts.map((assignment) => ({ phone: normalizePhone(assignment.phone), fromPersonId: assignment.personId, toPersonId: targetPersonId })),
        alreadyAssigned,
        ...(unresolved.length ? { unresolved } : {}),
        simulated: true,
      };
    }
    return this.friendly("phone-assignment-transfer", "Non riesco a spostare il recapito sul nominativo corretto.", async () => {
      const moved: CrmContactTransferResult["moved"] = [];
      const byOldPerson = new Map<string, Set<string>>();
      for (const assignment of safeConflicts) {
        const phones = byOldPerson.get(assignment.personId) ?? new Set<string>();
        phones.add(normalizePhone(assignment.phone));
        byOldPerson.set(assignment.personId, phones);
      }
      for (const [oldPersonId, phones] of byOldPerson) {
        await this.openPerson(oldPersonId);
        const edit = await this.editExistingPersonContacts({ removePhones: phones });
        const removed = new Set(edit.removed);
        const missing = [...phones].filter((phone) => !removed.has(phone));
        if (missing.length) {
          throw new WorkerError(
            "Il gestionale trova il recapito nella ricerca, ma non lo mostra in un campo modificabile del vecchio nominativo.",
            "needs_review",
            { portal: "CRM", action: "phone-transfer-source-field", oldPersonId, phones: missing, targetPersonId },
            true,
          );
        }
        for (const phone of removed) moved.push({ phone, fromPersonId: oldPersonId, toPersonId: targetPersonId });
      }

      await this.openPerson(targetPersonId);
      await this.editExistingPersonContacts({ mobiles: safePerson.mobiles, landlines: safePerson.landlines, emails: safePerson.emails });
      return { moved, alreadyAssigned, ...(unresolved.length ? { unresolved } : {}), simulated: false };
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
    const place = normalizedUiText(person.birthPlace);
    const alreadySelected = await field.getAttribute("readonly") !== null
      && normalizedUiText(await field.inputValue()).startsWith(place);
    if (alreadySelected) return;

    const options = this.visible(this.selectors.personBirthPlaceOption);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await field.fill("");
      await field.pressSequentially(attempt === 0 ? formattedPlace : person.birthPlace.toUpperCase(), { delay: 70 });
      const appeared = await options.first().waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
      if (appeared) break;
    }

    const labels = await options.allTextContents();
    const province = normalizedUiText(person.birthProvince);
    const matchingIndexes = labels.flatMap((value, index) => {
      const normalized = normalizedUiText(value);
      return normalized === place || normalized.startsWith(`${place} `) || normalized.startsWith(`${place}-`)
        ? [index]
        : [];
    });
    const provinceMatch = province
      ? matchingIndexes.find((index) => normalizedUiText(labels[index]).includes(province))
      : undefined;
    const selectedIndex = provinceMatch ?? matchingIndexes[0] ?? (labels.length === 1 ? 0 : -1);
    if (selectedIndex < 0) {
      throw new WorkerError(
        `Il gestionale non ha mostrato un risultato selezionabile per il luogo di nascita “${formattedPlace}”.`,
        "portal_error",
        { portal: "CRM", action: "person-birth-place-options", birthPlace: person.birthPlace, birthProvince: person.birthProvince, alternatives: labels },
        true,
      );
    }

    await options.nth(selectedIndex).click();
    for (let check = 0; check < 20; check += 1) {
      const selectedValue = normalizedUiText(await field.inputValue());
      const readonly = await field.getAttribute("readonly") !== null;
      if (readonly && (selectedValue === place || selectedValue.startsWith(`${place} `))) return;
      await this.page.waitForTimeout(150);
    }

    throw new WorkerError(
      `Il risultato “${formattedPlace}” è stato cliccato, ma il gestionale non ha confermato la selezione.`,
      "portal_error",
      { portal: "CRM", action: "person-birth-place-confirmation", birthPlace: person.birthPlace, birthProvince: person.birthProvince, alternatives: labels },
      true,
    );
  }

  private async fillPerson(person: NormalizedPerson, includeContacts = true) {
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
      ...(includeContacts ? [
        ["personEmail", "Email", person.emails[0] ?? ""],
        ["personMobile", "Cellulare", person.mobiles[0] ?? ""],
        ["personOfficePhone", "Telefono fisso", person.landlines[0] ?? ""],
        ["personOtherPhone", "Altro telefono", [...person.mobiles.slice(1), ...person.landlines.slice(1)][0] ?? ""],
      ] as Array<[keyof CrmSelectors, string, string]> : []),
    ];
    for (const [key, label, value] of fields) await this.fillPersonText(key, label, value);
    await this.selectPersonGender(person);
    await this.selectPersonBirthPlace(person);
    await this.fillPersonText("personBirthProvince", "Provincia di nascita", person.birthProvince ?? "");
    await this.fillPersonText("personBirthDate", "Data di nascita", uiBirthDate);
    await this.fillPersonText("personTaxCode", "Codice fiscale", person.taxCode ?? "");
  }

  private async throwIfTaxCodeRejectedByCrm() {
    if (!this.selectors.personTaxCode) return;
    const field = this.visible(this.selectors.personTaxCode).first();
    if (!(await field.count())) return;
    const invalidAttribute = await field.getAttribute("aria-invalid").catch(() => null);
    const surroundingText = normalizedUiText(
      await field.evaluate((element) => element.closest(".slds-form-element")?.textContent ?? "").catch(() => ""),
    );
    const pageText = normalizedUiText(await this.page.locator("body").innerText().catch(() => ""));
    if (
      invalidAttribute === "true"
      || surroundingText.includes("CODICE FISCALE NON COERENTE")
      || pageText.includes("CODICE FISCALE NON COERENTE CON I DATI INSERITI")
    ) {
      throw new WorkerError(
        "Il gestionale rifiuta il codice fiscale presente in SISTER per questo nominativo.",
        "data_incomplete",
        { portal: "CRM", action: "person-tax-code-invalid" },
        true,
      );
    }
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
      await this.page.waitForTimeout(350);
      await this.throwIfTaxCodeRejectedByCrm();
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
      if (mergeSelectorsConfigured) {
        let pendingMerge: PersonMergeResult | null = null;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const mergeDialog = this.page.locator(this.selectors.personMergeDialog).filter({ visible: true });
          if (await mergeDialog.count()) {
            const merge = await this.inspectPersonMerge();
            if (merge.status === "ready" || merge.status === "blocked") {
              return { personId: merge.personId, mergeStatus: merge.status, details: { ...merge.details, duplicateCandidateIds } };
            }
            pendingMerge = merge;
          } else {
            const personId = await this.currentPersonId();
            const personFormStillOpen = await this.visible(this.selectors.personSave).count() > 0
              && await this.visible(this.selectors.personFirstName || this.selectors.personFullName).count() > 0;
            // Concedi al Cloud alcuni secondi per mostrare un eventuale merge.
            // Se l'identificativo è già disponibile e nessuna area merge compare,
            // la creazione normale può proseguire anche se la modale si chiude lentamente.
            if (personId && (!personFormStillOpen || attempt >= 12)) {
              const workspaceReady = await this.visible(this.selectors.personPropertiesCard).count() > 0;
              return { personId, mergeStatus: "not_required", details: { duplicateCandidateIds, workspaceReady } };
            }
          }
          await this.page.waitForTimeout(250);
        }
        if (pendingMerge) {
          return {
            personId: null,
            mergeStatus: "pending",
            details: { ...pendingMerge.details, duplicateCandidateIds, message: pendingMerge.message },
          };
        }
      }
      let personId = await this.currentPersonId();
      for (let attempt = 0; !personId && attempt < PERSON_MERGE_ID_WAIT_CYCLES; attempt += 1) {
        await this.page.waitForTimeout(250);
        personId = await this.currentPersonId();
      }
      if (!personId) throw new WorkerError("Il gestionale ha salvato il nominativo ma non espone il suo identificativo. Apri la scheda creata e premi “Riprendi”.", "needs_review", { portal: "CRM", action: "person-create-record-id" }, true);
      /*
       * L'identificativo conferma che il nominativo è già stato salvato.
       * La card immobili è caricata dopo, in modo asincrono: non deve far
       * ripetere la creazione. Sarà il passaggio immobile a riaprirla.
       */
      const workspaceReady = await this.visible(this.selectors.personPropertiesCard).count() > 0;
      return { personId, mergeStatus: "not_required", details: { duplicateCandidateIds, workspaceReady } };
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
      const importerChoicesSelected = await this.selectImporterMergeChoices(dialog);
      if (importerChoicesSelected) await this.page.waitForTimeout(300);
      const messageLocator = dialog.locator(this.selectors.personMergeMessage).filter({ visible: true });
      const message = await messageLocator.count()
        ? (await messageLocator.first().textContent())?.trim() ?? ""
        : "";
      const dialogText = normalizedUiText(await dialog.innerText().catch(() => ""));
      const blockedByText = dialogText.includes("NON SI PUO PROCEDERE AL SALVATAGGIO")
        || dialogText.includes("NON E POSSIBILE PROCEDERE AL SALVATAGGIO");
      const readyByText = dialogText.includes("TUTTI I CAMPI SONO STATI RICONCILIATI")
        && dialogText.includes("PROCEDERE AL SALVATAGGIO")
        && !dialogText.includes("NON ");
      if (blockedByText || await dialog.locator(this.selectors.personMergeBlocked).filter({ visible: true }).count()) {
        return { status: "blocked", personId: null, message: message || "Il Cloud segnala problemi nel merge", details: { source: "crm-merge-dialog" } };
      }
      if (readyByText || await dialog.locator(this.selectors.personMergeReady).filter({ visible: true }).count()) {
        return { status: "ready", personId: null, message: message || "Il Cloud non segnala problemi nel merge", details: { source: "crm-merge-dialog" } };
      }
      return {
        status: "pending",
        personId: null,
        message: message || "Il Cloud non ha ancora concluso il controllo del merge",
        details: { source: "crm-merge-dialog", dialogText },
      };
    });
  }

  /**
   * In the Tecnocloud reconciliation screen the incoming record is always the
   * left-hand value. The cells have no stable field identifiers, so identify
   * only actionable controls in the central left column of this known dialog.
   */
  private async selectImporterMergeChoices(dialog: Locator) {
    if (!this.selectors.personMergeImporterChoices) return 0;
    const dialogBox = await dialog.boundingBox();
    if (!dialogBox || dialogBox.width < 300 || dialogBox.height < 180) return 0;
    const choices = dialog.locator(this.selectors.personMergeImporterChoices).filter({ visible: true });
    const count = await choices.count();
    let selected = 0;
    for (let index = 0; index < count; index += 1) {
      const choice = choices.nth(index);
      const box = await choice.boundingBox();
      if (!box || box.width < 70 || box.height < 20) continue;
      const left = (box.x - dialogBox.x) / dialogBox.width;
      const top = (box.y - dialogBox.y) / dialogBox.height;
      const bottom = (box.y + box.height - dialogBox.y) / dialogBox.height;
      // Screenshot-calibrated merge grid: labels are on the far left, importer
      // values occupy the next column, existing CRM values the following one.
      if (left < 0.35 || left > 0.64 || top < 0.18 || bottom > 0.86) continue;
      await choice.scrollIntoViewIfNeeded();
      await choice.click({ force: true });
      selected += 1;
    }

    // Phone fields are different from the other merge fields: selecting the
    // importer on every row can discard a second CRM number. Evaluate the
    // small left/right matrix and choose the combination that keeps every
    // importer number, then the greatest number of distinct phones. When
    // equally good, prefer the CRM-side value that adds a number not present
    // in Excel (the importer value remains in another field).
    const phoneLabels = ["Cellulare", "Telefono fisso", "Telefono Ufficio", "Altro telefono"];
    const phoneRows: Array<{
      label: string;
      left: { value: string; choice: Locator } | null;
      right: { value: string; choice: Locator } | null;
    }> = [];
    const candidates: Array<{ choice: Locator; box: { x: number; y: number; width: number; height: number }; text: string }> = [];
    for (let index = 0; index < count; index += 1) {
      const choice = choices.nth(index);
      const box = await choice.boundingBox();
      if (!box) continue;
      candidates.push({ choice, box, text: (await choice.innerText().catch(() => "")).trim() });
    }
    const phoneValue = (text: string) => normalizePhone(text.match(/(?:\+?\d[\d\s()./-]{6,}\d)/)?.[0] ?? text);
    for (const label of phoneLabels) {
      const labelBoxes = await dialog.locator("*").evaluateAll((elements, expectedLabel) => elements
        .filter((element) => element.children.length === 0 && (element.textContent ?? "").trim() === expectedLabel)
        .map((element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        }), label);
      const labelBox = labelBoxes[0] ?? null;
      if (!labelBox) continue;
      const rowCandidates = candidates.filter(({ box }) => Math.abs((box.y + box.height / 2) - (labelBox.y + labelBox.height / 2)) <= Math.max(22, labelBox.height * 1.6));
      const bySide = (side: "left" | "right") => {
        const eligible = rowCandidates.filter(({ box }) => {
          const relativeLeft = (box.x - dialogBox.x) / dialogBox.width;
          return side === "left" ? relativeLeft >= 0.35 && relativeLeft < 0.64 : relativeLeft >= 0.64 && relativeLeft < 0.96;
        });
        eligible.sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
        const item = eligible[0];
        return item ? { value: phoneValue(item.text), choice: item.choice } : null;
      };
      const left = bySide("left");
      const right = bySide("right");
      if (left || right) phoneRows.push({ label, left, right });
    }
    if (phoneRows.length) {
      const importerPhones = new Set(phoneRows.map((row) => row.left?.value).filter((value): value is string => Boolean(value)));
      let best: { indexes: number[]; coverage: number; distinct: number; cloudAdds: number } | null = null;
      const combinations = 1 << phoneRows.length;
      for (let mask = 0; mask < combinations; mask += 1) {
        const values = phoneRows.map((row, index) => ((mask >> index) & 1) ? row.right?.value : row.left?.value).filter((value): value is string => Boolean(value));
        const unique = new Set(values);
        const coverage = [...importerPhones].filter((value) => unique.has(value)).length;
        const cloudAdds = phoneRows.reduce((total, row, index) => {
          const value = ((mask >> index) & 1) ? row.right?.value : row.left?.value;
          return total + (value && !importerPhones.has(value) ? 1 : 0);
        }, 0);
        const candidate = { indexes: phoneRows.map((_, index) => ((mask >> index) & 1)), coverage, distinct: unique.size, cloudAdds };
        if (!best
          || candidate.coverage > best.coverage
          || (candidate.coverage === best.coverage && candidate.distinct > best.distinct)
          || (candidate.coverage === best.coverage && candidate.distinct === best.distinct && candidate.cloudAdds > best.cloudAdds)) {
          best = candidate;
        }
      }
      if (best) {
        for (let index = 0; index < phoneRows.length; index += 1) {
          if (!best.indexes[index]) continue;
          const right = phoneRows[index]!.right;
          if (!right?.value) continue;
          await right.choice.scrollIntoViewIfNeeded();
          await right.choice.click({ force: true });
        }
      }
    }
    return selected;
  }

  async confirmPersonMerge(): Promise<PersonMergeResult> {
    return this.friendly("person-merge-confirm", "Non riesco a confermare il merge nominativi.", async () => {
      const inspection = await this.inspectPersonMerge();
      if (inspection.status !== "ready") return inspection;
      this.require("personMergeDialog", "personMergeConfirm");
      const dialog = this.page.locator(this.selectors.personMergeDialog).filter({ visible: true }).last();
      const save = dialog.locator(this.selectors.personMergeConfirm).filter({ visible: true });
      const saveCount = await save.count();
      if (saveCount !== 1) {
        throw new WorkerError(
          `La finestra di merge mostra ${saveCount} pulsanti Salva utilizzabili.`,
          "portal_error",
          { portal: "CRM", action: "person-merge-save", saveCount },
          true,
        );
      }
      await save.scrollIntoViewIfNeeded();
      await save.click();
      await dialog.waitFor({ state: "hidden", timeout: 20_000 });
      await this.checkSession();
      let personId = await this.currentPersonId();
      for (let attempt = 0; !personId && attempt < 40; attempt += 1) {
        await this.page.waitForTimeout(250);
        personId = await this.currentPersonId();
      }
      if (!personId) return { status: "pending", personId: null, message: "Merge confermato, identificativo finale non ancora disponibile", details: { source: "crm-merge-confirm" } };
      return { status: "completed", personId, message: "Merge completato", details: { source: "crm-merge-confirm" } };
    });
  }

  private async settleVisiblePersonMergeAfterSave() {
    if (!this.selectors.personMergeDialog) return;
    const dialog = this.page.locator(this.selectors.personMergeDialog).filter({ visible: true }).last();
    if (!(await dialog.count())) return;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const inspection = await this.inspectPersonMerge();
      if (inspection.status === "ready") {
        const confirmed = await this.confirmPersonMerge();
        if (confirmed.status === "completed" || (
          confirmed.status === "pending"
          && confirmed.details.source === "crm-merge-confirm"
        )) return;
        throw new WorkerError(
          `Il Cloud ha accettato la riconciliazione, ma il salvataggio finale non risulta concluso: ${confirmed.message}`,
          "portal_error",
          { portal: "CRM", action: "person-merge-save-not-completed", merge: confirmed },
          true,
        );
      }
      if (inspection.status === "blocked") {
        throw new WorkerError(
          `Il Cloud non consente di salvare la riconciliazione: ${inspection.message}`,
          "needs_review",
          { portal: "CRM", action: "person-merge-blocked-after-save", merge: inspection },
          true,
        );
      }
      if (inspection.status === "completed") return;
      await this.page.waitForTimeout(250);
    }
    throw new WorkerError(
      "La finestra di riconciliazione è rimasta in elaborazione e non ha ancora autorizzato il salvataggio.",
      "portal_error",
      { portal: "CRM", action: "person-merge-still-pending" },
      true,
    );
  }

  async dismissPersonMerge(): Promise<{ dismissed: boolean; method: "none" | "cancel" | "home" }> {
    return this.friendly("person-merge-dismiss", "Non riesco a chiudere la finestra di riconciliazione.", async () => {
      this.require("personMergeDialog");
      const dialog = this.page.locator(this.selectors.personMergeDialog).filter({ visible: true }).last();
      if (!(await dialog.count())) return { dismissed: false, method: "none" };

      if (this.selectors.personMergeCancel) {
        const cancel = dialog.locator(this.selectors.personMergeCancel).filter({ visible: true });
        if (await cancel.count() === 1) {
          await cancel.click();
          const closed = await dialog.waitFor({ state: "hidden", timeout: 8_000 })
            .then(() => true)
            .catch(() => false);
          if (closed) return { dismissed: true, method: "cancel" };
        }
      }

      const currentUrl = this.page.url();
      const homeUrl = new URL(CRM_PATH, currentUrl).toString();
      await this.page.goto(homeUrl, { waitUntil: "domcontentloaded" });
      await this.checkSession();
      const lingeringDialog = this.page.locator(this.selectors.personMergeDialog).filter({ visible: true });
      if (await lingeringDialog.count()) {
        throw new WorkerError(
          "La finestra di riconciliazione è rimasta aperta anche dopo il ritorno alla home del gestionale.",
          "portal_error",
          { portal: "CRM", action: "person-merge-dismiss-home", currentUrl, homeUrl },
          true,
        );
      }
      return { dismissed: true, method: "home" };
    });
  }

  async resetToCrmHome(): Promise<{
    homeUrl: string;
    mergeDismissed: boolean;
    mergeDismissMethod: "none" | "cancel" | "home";
  }> {
    return this.friendly("crm-reset-home", "Non riesco a riportare il gestionale alla home prima del caso successivo.", async () => {
      const merge = await this.dismissPersonMerge();
      const homeUrl = new URL(CRM_PATH, this.page.url()).toString();
      await this.page.goto(homeUrl, { waitUntil: "domcontentloaded" });
      await this.checkSession();
      if (await this.isAccessDeniedPage()) {
        throw new WorkerError(
          "Il gestionale mostra ancora Accesso negato anche dopo il ritorno alla home.",
          "portal_error",
          { portal: "CRM", action: "crm-reset-home-access-denied", homeUrl },
          true,
        );
      }
      return {
        homeUrl: this.page.url(),
        mergeDismissed: merge.dismissed,
        mergeDismissMethod: merge.method,
      };
    });
  }

  async updatePerson(id: string, person: NormalizedPerson): Promise<void> {
    if (this.dryRun) return;
    await this.friendly("person-update", "Non riesco ad aggiornare il nominativo.", async () => {
      await this.openPerson(id);
      // Existing phone/email slots are not blanked here.  The dedicated
      // contact synchronizer adds missing values while retaining every
      // distinct number already present.
      await this.fillPerson(person, false);
      this.require("personSave");
      await this.page.locator(this.selectors.personSave).click();
      await this.page.waitForTimeout(700);
      await this.checkSession();
      await this.settleVisiblePersonMergeAfterSave();
    });
  }

  async findLinkedPropertyByAddress(
    personId: string,
    property: NormalizedProperty,
  ): Promise<PropertyMatchResult> {
    if (personId.startsWith("dry-person-")) return { match: null };
    return this.friendly("person-property-address-check", "Non riesco a confrontare gli immobili collegati al nominativo.", async () => {
      this.require("personPropertiesCard", "personPropertyLinks");
      await this.openPerson(personId);
      const personUrl = this.page.url();
      const card = await this.uniqueVisible("personPropertiesCard", "Immobili/Notizie/Incarichi", 20_000);
      const cardText = await card.innerText().catch(() => "");
      const declaredCount = Number(cardText.match(/Immobili\s*\/\s*Notizie\s*\/\s*Incarichi\s*\((\d+)\)/i)?.[1] ?? 0);
      const { links, fullListOpened } = await this.collectPersonPropertyLinks(card, personId);
      if (declaredCount > 0 && !links.length && !fullListOpened) {
        throw new WorkerError(
          `La scheda indica ${declaredCount} immobili collegati, ma non permette di leggerne gli indirizzi.`,
          "portal_error",
          { portal: "CRM", action: "person-properties-address-unreadable", personId, declaredCount },
          true,
        );
      }

      const addressMatches: Array<{ id: string; data: Record<string, unknown> }> = [];
      for (const link of links) {
        const href = link.href;
        const isFixture = href.startsWith("#fixture-property");
        const isConfirmedPropertyLink = isFixture
          || (/\/s\/immobile\//i.test(href) && /^\s*IM\s*-/i.test(link.label));
        /* La scheda raggruppa Immobili, Notizie e Incarichi. Solo le righe IM
         * possono partecipare alla ricerca immobile; NT/IN non vengono
         * nemmeno aperte. */
        if (!isConfirmedPropertyLink) continue;
        const hrefPropertyId = link.id || (isFixture
          ? (await this.page.locator(this.selectors.propertyResultId).first().textContent())?.trim() ?? ""
          : recordIdFromHref(href, "immobile"));
        if (!isFixture) {
          await this.page.goto(new URL(href, personUrl).toString(), { waitUntil: "domcontentloaded" });
          await this.page.waitForTimeout(650);
        }
        const identity = await this.readPropertyIdentity();
        if (samePropertyAddress(identity.rawAddress, property.address)
          && hasSameMunicipality(identity.rawAddress, property.municipality)) {
          addressMatches.push({
            id: hrefPropertyId || recordIdFromHref(this.page.url(), "immobile"),
            data: {
              source: "crm-person-related-properties",
              matchedBy: "address-for-person-selection",
              addressVerified: true,
              ...identity,
              href,
            },
          });
        }
      }

      if (!links.every(({ href }) => href.startsWith("#fixture-property"))) {
        await this.page.goto(personUrl, { waitUntil: "domcontentloaded" });
        await this.waitForPersonWorkspace(personId);
      }
      if (!addressMatches.length) return { match: null };
      return {
        match: {
          ...addressMatches[0]!,
          data: {
            ...addressMatches[0]!.data,
            matchingLinkedProperties: addressMatches.map(({ id, data }) => ({
              id,
              address: data.rawAddress,
            })),
          },
        },
      };
    });
  }

  async findPropertyForPerson(
    personId: string,
    property: NormalizedProperty,
    excludedPropertyIds: string[] = [],
  ): Promise<PropertyMatchResult> {
    if (personId.startsWith("dry-person-")) return { match: null };
    return this.friendly("person-property-search", "Non riesco a leggere gli immobili collegati al nominativo.", async () => {
      this.require("personPropertiesCard", "personPropertyLinks");
      await this.openPerson(personId);
      const personUrl = this.page.url();
      const card = await this.uniqueVisible("personPropertiesCard", "Immobili/Notizie/Incarichi", 20_000);
      const cardText = await card.innerText().catch(() => "");
      const declaredCount = Number(cardText.match(/Immobili\s*\/\s*Notizie\s*\/\s*Incarichi\s*\((\d+)\)/i)?.[1] ?? 0);
      const { links, fullListOpened } = await this.collectPersonPropertyLinks(card, personId);
      if (declaredCount > 0 && !links.length && !fullListOpened) {
        throw new WorkerError(
          `La scheda indica ${declaredCount} immobili collegati, ma il gestionale non ne espone l'elenco. Per evitare duplicati il worker non ne crea uno nuovo.`,
          "needs_review",
          { portal: "CRM", action: "person-properties-unreadable", personId, declaredCount },
          true,
        );
      }
      const matches: Array<{ id: string; data: Record<string, unknown> }> = [];
      const identityConflicts: Array<{ id: string; address: string }> = [];
      const propertyLinks = links.filter((link) => link.href.startsWith("#fixture-property")
        || (/\/s\/immobile\//i.test(link.href) && /^\s*IM\s*-/i.test(link.label)));
      const pairedLinks = propertyLinks.filter((link) => propertyListLabelMatchesAddress(link.label, property.address));
      // Pairing the modal label avoids opening unrelated properties. The
      // detail page below remains the source of truth; unknown label formats
      // safely fall back to inspecting every IM row.
      const linksToInspect = pairedLinks.length ? pairedLinks : propertyLinks;
      for (const link of linksToInspect) {
        const href = link.href;
        const isFixture = href.startsWith("#fixture-property");
        const hrefPropertyId = link.id || (isFixture
          ? (await this.page.locator(this.selectors.propertyResultId).first().textContent())?.trim() ?? ""
          : recordIdFromHref(href, "immobile"));
        if (hrefPropertyId && excludedPropertyIds.includes(hrefPropertyId)) continue;
        if (!isFixture) {
          await this.page.goto(new URL(href, personUrl).toString(), { waitUntil: "domcontentloaded" });
          await this.page.waitForTimeout(650);
        }
        const identity = await this.readPropertyIdentity();
        const cadastralMatch = hasSameCadastralIdentity(identity, property);
        const strictAddressMatch = samePropertyAddress(identity.rawAddress, property.address);
        const addressSuffixRecovered = cadastralMatch
          && !strictAddressMatch
          && samePropertyAddressWithMissingCivicSuffix(identity.rawAddress, property.address);
        const addressMatch = strictAddressMatch || addressSuffixRecovered;
        const municipalityMatch = hasSameMunicipality(identity.rawAddress, property.municipality);
        if (cadastralMatch && addressMatch && municipalityMatch) {
          const id = hrefPropertyId || recordIdFromHref(this.page.url(), "immobile");
          matches.push({
            id,
            data: {
              source: "crm-person-related-properties",
              matchedBy: "cadastral",
              identityVerified: true,
              ...identity,
              addressVerified: true,
              addressSuffixRecovered,
              municipalityVerified: true,
              needsUpdate: false,
              href,
            },
          });
        } else if (addressMatch && municipalityMatch) {
          const id = hrefPropertyId || recordIdFromHref(this.page.url(), "immobile");
          matches.push({
            id,
            data: {
              source: "crm-person-related-properties",
              matchedBy: "address",
              identityVerified: false,
              ...identity,
              addressVerified: true,
              municipalityVerified: true,
              needsUpdate: true,
              href,
            },
          });
        } else if (cadastralMatch) {
          identityConflicts.push({
            id: hrefPropertyId || recordIdFromHref(this.page.url(), "immobile"),
            address: identity.rawAddress,
          });
        }
      }
      if (identityConflicts.length) {
        throw new WorkerError(
          "La terna catastale esiste sotto il nominativo, ma indirizzo o Comune non coincidono. Il worker non modifica e non crea alcun immobile.",
          "needs_review",
          { portal: "CRM", action: "person-property-identity-conflict", personId, property, conflicts: identityConflicts },
          true,
        );
      }
      const cadastralMatches = matches.filter(({ data }) => data.matchedBy === "cadastral");
      const usableMatches = cadastralMatches.length ? cadastralMatches : matches;
      if (usableMatches.length > 1) throw new WorkerError("Il nominativo ha più immobili compatibili con indirizzo o dati catastali. Seleziona manualmente quello corretto e premi “Riprendi”.", "needs_review", { portal: "CRM", personId, property, alternatives: usableMatches }, true);
      if (!matches.length && !links.every(({ href }) => href.startsWith("#fixture-property"))) {
        await this.page.goto(personUrl, { waitUntil: "domcontentloaded" });
        await this.waitForPersonWorkspace(personId);
      }
      return { match: usableMatches[0] ?? null };
    });
  }

  async findPropertyByCadastralIdentity(property: NormalizedProperty): Promise<PropertyMatchResult> {
    if (this.dryRun) return { match: null };
    return this.friendly("property-global-cadastral-search", "Non riesco a cercare l’immobile per dati catastali nell’intero gestionale.", async () => {
      this.require(
        "propertyFiltersOpen",
        "propertySearchSheet",
        "propertySearchParcel",
        "propertySearchSubaltern",
        "propertySearchSubmit",
        "propertyResultId",
      );
      const returnUrl = this.page.url();
      const searchUrl = new URL(
        `${CRM_PATH}/immobile/Immobile__c/Default?queryId=a0Q3Y00000ecOpjUAE`,
        returnUrl,
      ).toString();
      await this.page.goto(searchUrl, { waitUntil: "domcontentloaded" });
      await this.checkSession();

      const sheet = this.visible(this.selectors.propertySearchSheet).first();
      // The filter drawer can be restored open by CRM. Give its controls a
      // short chance to hydrate before clicking Filters, otherwise we would
      // accidentally close an already-open drawer.
      const sheetAlreadyVisible = await sheet.waitFor({ state: "visible", timeout: 2_500 })
        .then(() => true)
        .catch(() => false);
      if (!sheetAlreadyVisible) {
        const filters = this.visible(this.selectors.propertyFiltersOpen).first();
        // Lightning paints the toolbar after DOMContentLoaded. Wait for the
        // actual command rather than treating that short render gap as a
        // missing filter panel.
        await filters.waitFor({ state: "visible", timeout: 12_000 }).catch(() => undefined);
        if (!(await filters.count())) {
          throw new WorkerError(
            "La ricerca globale immobili non mostra i filtri catastali.",
            "portal_error",
            { portal: "CRM", action: "property-global-cadastral-filters" },
            true,
          );
        }
        await filters.click({ force: true });
        await sheet.waitFor({ state: "visible", timeout: 12_000 });
      }
      const parcel = this.visible(this.selectors.propertySearchParcel).first();
      const subaltern = this.visible(this.selectors.propertySearchSubaltern).first();
      // Each Lightning filter recalculates the drawer. Filling them in
      // parallel can make one of the values disappear before Applica.
      await sheet.fill(property.sheet);
      await parcel.fill(property.parcel);
      await subaltern.fill(property.subaltern);
      const submit = this.visible(this.selectors.propertySearchSubmit).last();
      if (await submit.count() !== 1) {
        throw new WorkerError(
          "La ricerca globale immobili non mostra un solo pulsante Applica.",
          "portal_error",
          { portal: "CRM", action: "property-global-cadastral-submit", count: await submit.count() },
          true,
        );
      }
      await submit.click({ force: true });
      /* Lightning aggiorna i risultati in modo asincrono. Il vecchio ritardo
       * fisso di 900 ms poteva leggere zero righe mentre la tabella stava
       * ancora caricando e autorizzare per errore la creazione di un
       * duplicato. Aspettiamo che spinner e insieme degli ID siano stabili. */
      const resultIds = this.visible(this.selectors.propertyResultId);
      const deadline = Date.now() + 20_000;
      const earliestStableAt = Date.now() + 1_500;
      let previousSignature = "";
      let stableReads = 0;
      while (Date.now() < deadline) {
        await this.checkSession();
        const spinnerVisible = this.selectors.loadingSpinner
          ? await this.visible(this.selectors.loadingSpinner).count() > 0
          : false;
        const signature = (await resultIds.evaluateAll((inputs) => inputs
          .map((input) => input.getAttribute("data-id") ?? "")
          .filter(Boolean)
          .sort())).join("|");
        if (!spinnerVisible && Date.now() >= earliestStableAt) {
          stableReads = signature === previousSignature ? stableReads + 1 : 0;
          if (stableReads >= 3) break;
        } else {
          stableReads = 0;
        }
        previousSignature = signature;
        await this.page.waitForTimeout(250);
      }
      if (stableReads < 3) {
        throw new WorkerError(
          "La ricerca globale immobili non ha raggiunto uno stato stabile. Per sicurezza il worker non crea un nuovo immobile.",
          "portal_error",
          { portal: "CRM", action: "property-global-cadastral-results-not-stable" },
          true,
        );
      }
      await this.checkSession();

      const ids = [...new Set(await this.visible(this.selectors.propertyResultId).evaluateAll((inputs) => inputs
        .map((input) => input.getAttribute("data-id") ?? "")
        .filter(Boolean)))];
      const matches: Array<{ id: string; data: Record<string, unknown> }> = [];
      for (const id of ids) {
        const verified = await this.verifyProperty(id, property);
        if (!verified.match) continue;
        matches.push({
          id,
          data: {
            ...verified.match.data,
            source: "crm-global-cadastral-search",
            matchedBy: "cadastral-global",
            identityVerified: true,
          },
        });
      }
      if (ids.length && !matches.length) {
        throw new WorkerError(
          "La terna catastale esiste nel gestionale, ma la scheda non coincide per indirizzo, Comune o tipo record. Il worker non modifica e non crea alcun immobile.",
          "needs_review",
          { portal: "CRM", action: "property-global-cadastral-identity-conflict", property, candidateIds: ids },
          true,
        );
      }
      if (matches.length > 1) {
        throw new WorkerError(
          "La ricerca catastale globale ha trovato più immobili con la stessa terna. Il worker non sceglie una scheda casualmente.",
          "needs_review",
          { portal: "CRM", action: "property-global-cadastral-ambiguous", property, alternatives: matches },
          true,
        );
      }
      if (matches.length) return { match: matches[0]! };

      // Creation is performed from the nominativo workspace. Put the browser
      // back there when the global guard found nothing, otherwise the worker
      // could press a valid but unrelated "Nuovo" from the result page.
      await this.page.goto(returnUrl, { waitUntil: "domcontentloaded" });
      await this.checkSession();
      return { match: null };
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

  private async selectCadastralPicklist(
    key: "propertyCadastralGroup" | "propertyCadastralType",
    label: string,
    expected: string,
    startsWith = false,
  ) {
    const labelElement = await this.uniqueVisible(key, label, 10_000);
    const component = labelElement.locator("xpath=..");
    const input = component.locator('input[role="textbox"]').filter({ visible: true });
    const inputCount = await input.count();
    if (inputCount !== 1) {
      throw new WorkerError(
        `Il modulo catastale mostra ${inputCount} menu “${label}”.`,
        "portal_error",
        { portal: "CRM", action: "property-cadastral-picklist-input", field: label, expected, inputCount },
        true,
      );
    }
    const matches = (value: string) => startsWith
      ? normalizedUiText(value).startsWith(normalizedUiText(expected))
      : normalizedUiText(value) === normalizedUiText(expected);
    if (matches(await input.inputValue())) return;

    await input.click();
    const options = component.locator('[role="option"]').filter({ visible: true });
    await options.first().waitFor({ state: "visible", timeout: 8_000 });
    const optionLabels = await options.allTextContents();
    const optionIndex = optionLabels.findIndex(matches);
    if (optionIndex < 0) {
      throw new WorkerError(
        `Nel menu “${label}” non è disponibile il valore catastale SISTER “${expected}”.`,
        "needs_review",
        { portal: "CRM", action: "property-cadastral-picklist-option", field: label, expected, alternatives: optionLabels },
        true,
      );
    }
    await options.nth(optionIndex).click();
    if (!matches(await input.inputValue())) {
      throw new WorkerError(
        `Il gestionale non ha confermato il valore “${expected}” nel menu “${label}”.`,
        "portal_error",
        { portal: "CRM", action: "property-cadastral-picklist-confirmation", field: label, expected },
        true,
      );
    }
  }

  private async syncPropertyCadastralDetails(property: NormalizedProperty) {
    const values: Array<[keyof CrmSelectors, string, string]> = [
      ["propertyCadastralSectionUrban", "Catasto Sezione Urbana", "BA"],
      ["propertyCadastralSheet", "Catasto Foglio", property.sheet],
      ["propertyCadastralParcel", "Catasto Particella", property.parcel],
      ["propertyCadastralSubaltern", "Catasto Subalterno", property.subaltern],
      ["propertyCadastralIncome", "Catasto Rendita", property.cadastralIncome?.toString().replace(".", ",") ?? ""],
    ];
    const editableInput = (key: keyof CrmSelectors, label: string) => this.page
      .getByLabel(label, { exact: true })
      .or(this.visible(this.selectors[key]).locator("input"))
      .filter({ visible: true });
    const firstEditable = editableInput("propertyCadastralSectionUrban", "Catasto Sezione Urbana");
    let editFormOpen = await firstEditable.count() === 1;

    if (!editFormOpen) {
      let rowToEdit: Locator | null = null;
      for (const [key, label, expected] of values) {
        if (!expected) continue;
        const row = await this.uniqueVisible(key, label, 15_000);
        const currentText = normalizedUiText(await row.innerText().catch(() => ""))
          .replace(normalizedUiText(label), "")
          .trim();
        if (currentText !== normalizedUiText(expected) && !rowToEdit) rowToEdit = row;
      }
      if (!rowToEdit) return;
      const edit = rowToEdit
        .locator('button.inline-edit-trigger, button[title*="Modifica"], button[title*="Edit"], lightning-button-icon button')
        .filter({ visible: true });
      if (await edit.count() !== 1) {
        throw new WorkerError(
          "I dati catastali non coincidono con SISTER, ma la scheda non mostra un solo comando di modifica.",
          "portal_error",
          { portal: "CRM", action: "property-cadastral-edit", editButtons: await edit.count() },
          true,
        );
      }
      await edit.click();
      await firstEditable.waitFor({ state: "visible", timeout: 10_000 });
      editFormOpen = true;
    }

    if (!editFormOpen) return;
    for (const [key, label, expected] of values) {
      if (!expected) continue;
      const input = editableInput(key, label);
      const inputCount = await input.count();
      if (inputCount !== 1) {
        throw new WorkerError(
          `Il modulo catastale mostra ${inputCount} caselle “${label}”.`,
          "portal_error",
          { portal: "CRM", action: "property-cadastral-input", field: label, expected, inputCount },
          true,
        );
      }
      if (normalizedUiText(await input.inputValue()) !== normalizedUiText(expected)) await input.fill(expected);
      if (normalizedUiText(await input.inputValue()) !== normalizedUiText(expected)) {
        throw new WorkerError(
          `Il valore SISTER non è rimasto nel campo “${label}”.`,
          "portal_error",
          { portal: "CRM", action: "property-cadastral-fill", field: label, expected },
          true,
        );
      }
    }

    const categoryMatch = property.category.trim().toUpperCase().match(/^([AC])\s*\/?\s*(\d{1,2})$/);
    if (categoryMatch) {
      const categoryGroup = `Gruppo ${categoryMatch[1]}`;
      const categoryCode = `${categoryMatch[1]}${categoryMatch[2]!.padStart(2, "0")}`;
      await this.selectCadastralPicklist("propertyCadastralGroup", "Catasto Gruppi", categoryGroup);
      await this.selectCadastralPicklist("propertyCadastralType", "Catasto Tipologie", categoryCode, true);
    }

    this.require("propertySave");
    const save = this.visible(this.selectors.propertySave);
    const saveCount = await save.count();
    if (saveCount !== 1) {
      throw new WorkerError(
        `Il modulo catastale mostra ${saveCount} pulsanti Salva.`,
        "portal_error",
        { portal: "CRM", action: "property-cadastral-save", saveCount },
        true,
      );
    }
    await save.click();
    await this.checkSession();
    await this.page.waitForTimeout(700);
  }

  private async propertyPicklist(key: keyof CrmSelectors, label: string, value: string) {
    this.require(key);
    const components = this.visible(this.selectors[key]);
    await components.first().waitFor({ state: "visible", timeout: 15_000 });
    let component = components.first();
    for (let index = 0; index < await components.count(); index += 1) {
      const labels = await components.nth(index).locator("label").allTextContents();
      if (labels.some((text) => normalizedUiText(text) === normalizedUiText(label))) {
        component = components.nth(index);
        break;
      }
    }
    const input = component.locator('input[role="textbox"]').filter({ visible: true }).first();
    await input.click();
    const options = component.locator('[role="option"]').filter({ visible: true });
    await options.first().waitFor({ state: "visible", timeout: 8_000 });
    const labels = await options.allTextContents();
    const index = labels.findIndex((text) => normalizedUiText(text) === normalizedUiText(value));
    if (index < 0) {
      throw new WorkerError(
        `Nel campo “${label}” non è disponibile l'opzione “${value}”.`,
        "needs_review",
        { portal: "CRM", action: "property-picklist", label, requested: value, alternatives: labels },
        true,
      );
    }
    await options.nth(index).click();
  }

  private async selectPropertyMunicipality(municipality: string) {
    this.require("propertyMunicipality", "propertyMunicipalityOption", "propertyPostalCode");
    const component = await this.uniqueVisible("propertyMunicipality", "Comune immobile", 15_000);
    const input = component.locator('input[placeholder="Cerca"]').filter({ visible: true }).first();
    if (await input.getAttribute("readonly") === null) {
      await input.fill("");
      await input.pressSequentially(municipality, { delay: 70 });
      const options = component.locator(this.selectors.propertyMunicipalityOption).filter({ visible: true });
      await options.first().waitFor({ state: "visible", timeout: 8_000 });
      const labels = await options.allTextContents();
      const municipalityText = normalizedUiText(municipality);
      const index = labels.findIndex((text) => normalizedUiText(text) === municipalityText || normalizedUiText(text).startsWith(`${municipalityText} `));
      if (index < 0) throw new WorkerError(`Il Comune “${municipality}” non compare nella tendina dell'immobile.`, "needs_review", { portal: "CRM", action: "property-municipality", alternatives: labels }, true);
      await options.nth(index).click();
    }
    const cap = this.visible(this.selectors.propertyPostalCode).first();
    await cap.waitFor({ state: "visible", timeout: 8_000 });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if ((await cap.inputValue()).trim()) return;
      await this.page.waitForTimeout(150);
    }
    throw new WorkerError("Il CAP non è stato compilato automaticamente dopo la scelta del Comune.", "portal_error", { portal: "CRM", action: "property-postal-code" }, true);
  }

  private async advancePropertyWizard() {
    this.require("propertyNext");
    const buttons = this.visible(this.selectors.propertyNext);
    await buttons.first().waitFor({ state: "visible", timeout: 12_000 });
    await buttons.last().click();
  }

  private async assertNewPropertyComplete(values: ReturnType<typeof propertyFormValues>) {
    const required: Array<[keyof CrmSelectors, string, string]> = [
      ["propertyAddress", "Indirizzo", values.street],
      ["propertyCivic", "Civico", values.civicNumber],
      ["propertyInternal", "Interno", values.internal],
      ["propertyMunicipality", "Comune", values.municipality],
      ["propertyPostalCode", "CAP", "*"],
    ];
    if (values.civicLetter) required.push(["propertyStaircase", "Lettera", values.civicLetter]);
    for (const [key, label, expected] of required) {
      const component = await this.uniqueVisible(key, label, 8_000);
      const isInput = await component.evaluate((element) => element.matches("input"));
      const input = isInput ? component : component.locator("input").filter({ visible: true }).first();
      const value = (await input.inputValue()).trim();
      if (!value || (expected !== "*" && !normalizedUiText(value).startsWith(normalizedUiText(expected)))) {
        throw new WorkerError(
          `Il campo “${label}” non risulta compilato correttamente. Il pulsante Avanti non verrà premuto.`,
          "data_incomplete",
          { portal: "CRM", action: "property-before-next", field: label, expected, actual: value },
          true,
        );
      }
    }
  }

  private async fillNewProperty(property: NormalizedProperty) {
    const values = propertyFormValues(property);
    await this.propertyPicklist("propertyType", "Tipologia Immobile", values.type);
    await this.propertyPicklist("propertySubtype", "Sottotipologia Immobile", values.subtype);
    if (values.floor) await this.propertyPicklist("propertyFloor", "Piano Immobile", values.floor);
    const fields: Array<[keyof CrmSelectors, string, string]> = [
      ["propertyFloorNumber", "Numero piano", values.floorNumber],
      ["propertyAddress", "Indirizzo", values.street],
      ["propertyCivic", "Civico", values.civicNumber],
      ["propertyInternal", "Interno", values.internal],
      ["propertyStaircase", "Lettera", values.civicLetter],
    ];
    for (const [key, label, value] of fields) {
      if (!value && ["propertyFloorNumber", "propertyStaircase"].includes(key)) continue;
      this.require(key);
      const field = await this.uniqueVisible(key, label, 12_000);
      await field.fill(value);
    }
    await this.selectPropertyMunicipality(values.municipality);
    const postalCode = (await this.visible(this.selectors.propertyPostalCode).first().inputValue()).trim();
    await this.assertNewPropertyComplete(values);
    await this.advancePropertyWizard();
    return { ...values, postalCode };
  }

  private async confirmInsertedAddressValue(dialog: Locator, insertedValue: string) {
    const inserted = dialog.getByText(insertedValue, { exact: true }).filter({ visible: true }).first();
    if (!(await inserted.count())) return false;
    let row = inserted.locator("xpath=..");
    for (let depth = 0; depth < 7; depth += 1) {
      const text = normalizedUiText(await row.innerText().catch(() => ""));
      if (text.includes("STESSO VALORE")) return true;
      const children = row.locator(":scope > *").filter({ visible: true });
      if (await children.count() === 2) {
        const left = normalizedUiText(await children.nth(0).innerText().catch(() => ""));
        if (left.includes(normalizedUiText(insertedValue))) {
          const current = children.nth(0);
          const action = current.locator('button, a, [role="button"], [role="option"], input[type="radio"], label').filter({ visible: true }).first();
          if (await action.count()) await action.click();
          else await current.click().catch(() => undefined);
          await this.page.waitForTimeout(250);
          return true;
        }
      }
      row = row.locator("xpath=..");
    }
    return false;
  }

  private async selectInsertedAddressRadios(dialog: Locator) {
    this.require("propertyGoogleCurrentRadio");
    const groups = ["street", "streetN", "CAP"] as const;
    const selected: Record<string, string> = {};
    for (const name of groups) {
      const current = dialog.locator(this.selectors.propertyGoogleCurrentRadio).filter({ visible: true }).and(dialog.locator(`[name="${name}"]`)).first();
      if (!(await current.count())) return null;
      if (!(await current.isChecked())) await current.check({ force: true });
      if (!(await current.isChecked())) {
        throw new WorkerError(`Il valore inserito per “${name}” non risulta confermato.`, "portal_error", { portal: "CRM", action: "property-inserted-address-radio", field: name }, true);
      }
      selected[name] = (await current.inputValue()).trim();
    }
    return selected;
  }

  private async finishPropertyMap(values: ReturnType<typeof propertyFormValues> & { postalCode: string }) {
    this.require("propertyGoogleSameValue", "propertyLocality", "propertyLocalityOption", "propertySave");
    const save = this.visible(this.selectors.propertySave);
    await save.first().waitFor({ state: "visible", timeout: 20_000 });
    const visibleDialog = this.visible(this.selectors.blockingDialog).last();
    const dialog = await visibleDialog.count() ? visibleDialog : this.page.locator("body");
    const radioSelection = await this.selectInsertedAddressRadios(dialog);
    const accepted: Array<{ value: string; accepted: boolean }> = [];
    if (!radioSelection) {
      for (const value of [values.street, values.civicNumber, values.postalCode]) {
        accepted.push({ value, accepted: await this.confirmInsertedAddressValue(dialog, value) });
      }
    }
    const unresolved = accepted.filter((result) => !result.accepted).map((result) => result.value);
    if (unresolved.length) {
      throw new WorkerError(
        "Il confronto indirizzo non è completo. Il worker non salverà finché indirizzo, civico e CAP inseriti non saranno confermati.",
        "needs_review",
        { portal: "CRM", action: "property-google-address", unresolved, street: values.street, civicNumber: values.civicNumber, postalCode: values.postalCode },
        true,
      );
    }
    const locality = await this.uniqueVisible("propertyLocality", "Località", 12_000);
    const nativeSelect = locality.locator("select").filter({ visible: true });
    let localityValue = "";
    if (await nativeSelect.count()) {
      const options = await nativeSelect.locator("option").count();
      if (options < 2) throw new WorkerError("Il menu Località non contiene valori selezionabili.", "portal_error", { portal: "CRM", action: "property-locality" }, true);
      await nativeSelect.selectOption({ index: 1 });
      localityValue = await nativeSelect.inputValue();
    } else {
      const input = locality.locator('input[role="textbox"]').filter({ visible: true });
      const trigger = await input.count()
        ? input.first()
        : locality.locator('button[aria-haspopup="listbox"], button.slds-combobox__input').filter({ visible: true }).first();
      await trigger.click();
      const options = locality.locator(this.selectors.propertyLocalityOption).filter({ visible: true });
      await options.first().waitFor({ state: "visible", timeout: 8_000 });
      const selectedLabel = (await options.first().innerText()).trim();
      await options.first().click();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        localityValue = await input.count()
          ? (await input.first().inputValue()).trim()
          : (await trigger.innerText().catch(() => "")).trim();
        if (normalizedUiText(localityValue).includes(normalizedUiText(selectedLabel))) break;
        await this.page.waitForTimeout(150);
      }
    }
    if (!localityValue.trim()) {
      throw new WorkerError("La località non risulta selezionata. Il pulsante Salva non verrà premuto.", "data_incomplete", { portal: "CRM", action: "property-locality-incomplete" }, true);
    }
    await save.last().click();
  }

  private async completePropertyPositioningIfOpen(values: ReturnType<typeof propertyFormValues>) {
    const dialogs = this.visible(this.selectors.blockingDialog).filter({ hasText: "Posizionamento Immobile" });
    const dialogCount = await dialogs.count();
    if (!dialogCount) return false;
    if (dialogCount !== 1) {
      throw new WorkerError(
        "Il gestionale mostra piu finestre di posizionamento immobile.",
        "needs_review",
        { portal: "CRM", action: "property-positioning-ambiguous", dialogCount },
        true,
      );
    }
    const dialog = dialogs.first();
    // On both creation and update, the SISTER-derived value is authoritative:
    // never replace it with the Google-side proposal in this dialog.
    const radioSelection = await this.selectInsertedAddressRadios(dialog);
    if (!radioSelection) {
      const confirmed = await Promise.all([
        this.confirmInsertedAddressValue(dialog, values.street),
        this.confirmInsertedAddressValue(dialog, values.civicNumber),
      ]);
      if (confirmed.some((value) => !value)) {
        throw new WorkerError(
          "Il posizionamento non consente di confermare l'indirizzo inserito a sinistra.",
          "portal_error",
          { portal: "CRM", action: "property-positioning-inserted-address", confirmed },
          true,
        );
      }
    }
    const dialogText = normalizedUiText(await dialog.innerText());
    const missing = [values.street, values.civicNumber]
      .map(normalizedUiText)
      .filter((value) => !value || !dialogText.includes(value));
    if (missing.length) {
      throw new WorkerError(
        "Il posizionamento proposto dal gestionale non coincide con strada e civico dell'immobile SISTER. Non viene salvato.",
        "needs_review",
        {
          portal: "CRM",
          action: "property-positioning-address-mismatch",
          expected: { street: values.street, civicNumber: values.civicNumber },
          missing,
        },
        true,
      );
    }
    const save = dialog.getByRole("button", { name: "Salva", exact: true }).filter({ visible: true });
    const saveCount = await save.count();
    if (saveCount !== 1) {
      throw new WorkerError(
        "Il posizionamento dell'immobile non mostra un solo pulsante Salva.",
        "portal_error",
        { portal: "CRM", action: "property-positioning-save", saveCount },
        true,
      );
    }
    await save.click();
    await dialog.waitFor({ state: "hidden", timeout: 12_000 });
    await this.checkSession();
    return true;
  }

  async createProperty(property: NormalizedProperty): Promise<string> {
    if (this.dryRun) return `dry-property-${property.sheet}-${property.parcel}-${property.subaltern}`;
    return this.friendly("property-create", "Non riesco a creare l’immobile.", async () => {
      this.require("personPropertiesCard", "propertyCreate", "propertyCreateMenuItem");
      const card = await this.uniqueVisible("personPropertiesCard", "Immobili/Notizie/Incarichi", 20_000);
      const toggle = card.locator(this.selectors.propertyCreate).filter({ visible: true });
      const toggleCount = await toggle.count();
      if (toggleCount !== 1) {
        throw new WorkerError(
          "Non trovo in modo univoco la freccia della sezione Immobili/Notizie/Incarichi.",
          "portal_error",
          { portal: "CRM", action: "person-property-menu-toggle", count: toggleCount },
          true,
        );
      }
      let createItem = card.locator(this.selectors.propertyCreateMenuItem).filter({ visible: true });
      if (!(await createItem.count())) {
        await toggle.first().click();
        createItem = card.locator(this.selectors.propertyCreateMenuItem).filter({ visible: true });
        await createItem.first().waitFor({ state: "visible", timeout: 8_000 });
      }
      const createItemCount = await createItem.count();
      if (createItemCount !== 1) {
        throw new WorkerError(
          "Il menu Immobili/Notizie/Incarichi non mostra una sola voce Nuovo.",
          "portal_error",
          { portal: "CRM", action: "person-property-create-menu-item", count: createItemCount },
          true,
        );
      }
      await createItem.first().click();
      const values = await this.fillNewProperty(property);
      await this.finishPropertyMap(values);
      await this.checkSession();
      let propertyId = await this.currentPropertyId();
      if (!propertyId) {
        await this.page.waitForURL(/\/s\/immobile\//i, { timeout: 20_000 }).catch(() => undefined);
        propertyId = await this.currentPropertyId();
      }
      if (!propertyId) throw new WorkerError("L'immobile risulta salvato, ma il gestionale non espone il suo identificativo.", "needs_review", { portal: "CRM", action: "property-create-record-id" }, true);
      await this.syncPropertyCadastralDetails(property);
      if (values.commercialSquareMeters !== null && this.selectors.propertyCommercialSquareMeters) {
        const sqm = this.visible(this.selectors.propertyCommercialSquareMeters);
        if (await sqm.count()) await sqm.first().fill(String(values.commercialSquareMeters));
      }
      return propertyId;
    });
  }

  private async syncExistingPropertyCoreDetails(property: NormalizedProperty) {
    const values = propertyFormValues(property);
    const typeRow = this.page
      .locator('div.flex:has(label span:text-is("Tipologia Immobile"))')
      .filter({ visible: true });
    const typeRowCount = await typeRow.count();
    if (typeRowCount !== 1) {
      throw new WorkerError(
        `La scheda immobile mostra ${typeRowCount} righe “Tipologia Immobile”.`,
        "portal_error",
        { portal: "CRM", action: "property-core-edit-row", field: "Tipologia Immobile", count: typeRowCount },
        true,
      );
    }
    if (await this.visible(this.selectors.propertyType).count() !== 1) {
      const edit = typeRow.locator("button.inline-edit-trigger").filter({ visible: true });
      if (await edit.count() !== 1) {
        throw new WorkerError(
          "La scheda immobile non mostra un solo comando per modificare i dati principali.",
          "portal_error",
          { portal: "CRM", action: "property-core-edit-open", count: await edit.count() },
          true,
        );
      }
      await edit.click();
      await this.visible(this.selectors.propertyType).first().waitFor({ state: "visible", timeout: 10_000 });
    }

    await this.propertyPicklist("propertyType", "Tipologia Immobile", values.type);
    await this.propertyPicklist("propertySubtype", "Sottotipologia Immobile", values.subtype);
    if (values.floor) await this.propertyPicklist("propertyFloor", "Piano Immobile", values.floor);
    const fields: Array<[keyof CrmSelectors, string, string]> = [
      ["propertyFloorNumber", "Numero piano", values.floorNumber],
      ["propertyAddress", "Indirizzo", values.street],
      ["propertyCivic", "Civico", values.civicNumber],
      ["propertyInternal", "Interno", values.internal],
      ["propertyStaircase", "Lettera", values.civicLetter],
    ];
    for (const [key, label, value] of fields) {
      this.require(key);
      const field = await this.uniqueVisible(key, label, 10_000);
      await field.fill(value);
      if (normalizedUiText(await field.inputValue()) !== normalizedUiText(value)) {
        throw new WorkerError(
          `Il dato SISTER non è rimasto nel campo “${label}”.`,
          "portal_error",
          { portal: "CRM", action: "property-core-fill", field: label, expected: value },
          true,
        );
      }
    }
    await this.selectPropertyMunicipality(values.municipality);
    await this.assertNewPropertyComplete(values);
    const save = this.page.getByRole("button", { name: "Salva", exact: true }).filter({ visible: true });
    if (await save.count() !== 1) {
      throw new WorkerError(
        `La modifica dell'immobile mostra ${await save.count()} pulsanti Salva.`,
        "portal_error",
        { portal: "CRM", action: "property-core-save", count: await save.count() },
        true,
      );
    }
    await save.click();
    await this.page.waitForTimeout(700);
    await this.checkSession();
  }

  async updateProperty(id: string, property: NormalizedProperty): Promise<void> {
    if (this.dryRun) return;
    await this.friendly("property-update", "Non riesco ad aggiornare l'immobile collegato.", async () => {
      await this.openProperty(id);
      await this.syncExistingPropertyCoreDetails(property);
      await this.completePropertyPositioningIfOpen(propertyFormValues(property));
      await this.openProperty(id, true);
      await this.syncPropertyCadastralDetails(property);
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
      const throwIfInterrupted = () => {
        const interruption = input.interruptionRequested?.();
        if (interruption === "skip") throw new WorkerError("Immobile saltato prima del salvataggio dell'attività", "paused", { skipProperty: true, propertyId: input.propertyId });
        if (interruption === "pause") throw new WorkerError("Lavorazione messa in pausa prima del salvataggio dell'attività", "paused", { pauseRequested: true });
      };
      this.require(
        "activityCard", "activityCreate", "activityDialog", "activityDescription", "activityClient",
        "activityRelatedProperty", "activityContactMode", "activityStatus", "activityOption", "activityCancel", "activitySave",
      );
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= ACTIVITY_PRE_SAVE_ATTEMPTS; attempt += 1) {
        let saveClicked = false;
        try {
          throwIfInterrupted();
          await this.openProperty(input.propertyId, attempt > 1);
          const card = await this.uniqueVisible("activityCard", "riquadro Attività e appuntamenti", 20_000);
          const createButtons = card.locator(this.selectors.activityCreate).filter({ visible: true });
          const createCount = await createButtons.count();
          if (createCount !== 1) {
            throw new WorkerError(
              `Nel riquadro dell’immobile risultano ${createCount} pulsanti “Nuovo”.`,
              createCount === 0 ? "portal_error" : "needs_review",
              { portal: "CRM", action: "property-activity-create-button", propertyId: input.propertyId, createCount },
              true,
            );
          }
          await createButtons.first().click();

          // The c-lwc-modal host is zero-sized in production. Wait for the
          // rendered controls, which appear only after the internal spinner.
          await this.uniqueVisible("activityDialog", "finestra Attività", ACTIVITY_FORM_TIMEOUT);
          await this.waitForActivityFormToSettle();
          const activityDialog = await this.uniqueVisible("activityDialog", "modale attivita", ACTIVITY_FORM_TIMEOUT);
          const description = await this.uniqueVisible("activityDescription", "Descrizione attività", ACTIVITY_FORM_TIMEOUT);
          await description.fill(input.description);
          if (normalizedUiText(await description.inputValue()) !== normalizedUiText(input.description)) {
            throw new WorkerError(
              "La descrizione non è rimasta nel modulo dell’attività.",
              "portal_error",
              { portal: "CRM", action: "property-activity-description", propertyId: input.propertyId },
              true,
            );
          }
          const relatedField = await this.uniqueVisible("activityRelatedProperty", "Correlato a", ACTIVITY_FORM_TIMEOUT);
          const relatedInputs = relatedField.locator("input").filter({ visible: true });
          const relatedInputCount = await relatedInputs.count();
          if (relatedInputCount !== 1) {
            throw new WorkerError(
              "Il campo “Correlato a” dell’attività non è univoco.",
              relatedInputCount === 0 ? "portal_error" : "needs_review",
              { portal: "CRM", action: "property-activity-related-field", propertyId: input.propertyId, count: relatedInputCount },
              true,
            );
          }
          const relatedInput = relatedInputs.first();
          let correlatedProperty = (await relatedInput.inputValue()).trim();
          for (let wait = 0; !correlatedProperty && wait < ACTIVITY_PREFILL_WAIT_CYCLES; wait += 1) {
            await this.page.waitForTimeout(250);
            correlatedProperty = (await relatedInput.inputValue()).trim();
          }
          if (isNewsOrMandateActivityRelation(correlatedProperty)) {
            const cancel = activityDialog.locator(this.selectors.activityCancel).filter({ visible: true });
            const cancelCount = await cancel.count();
            if (cancelCount !== 1) {
              throw new WorkerError(
                "La nuova attivita e collegata a una Notizia o a un Incarico, ma la relativa finestra non mostra un solo Annulla.",
                "portal_error",
                { portal: "CRM", action: "property-activity-news-mandate-cancel", propertyId: input.propertyId, correlatedProperty, cancelCount },
                true,
              );
            }
            await cancel.click();
            await activityDialog.waitFor({ state: "hidden", timeout: 10_000 });
            return { outcome: "existing", crmActivityId: null, correlatedProperty, attempts: attempt };
          }
          // The runner has already verified the property by cadastral identity and this
          // modal is opened from that property's own activity card. Tecnocloud may
          // abbreviate the address, so an IM prefill is stronger evidence than text equality.
          if (!isPropertyActivityRelation(correlatedProperty)) {
            await relatedInput.click();
            const propertyOptions = this.visible(this.selectors.activityOption).filter({ hasText: "IM -" });
            await propertyOptions.first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
            const optionCount = await propertyOptions.count();
            const optionLabels = await propertyOptions.allTextContents();
            const matchingIndexes = optionLabels
              .map((label, index) => activityRelationMatchesProperty(label, input.propertyAddress) ? index : -1)
              .filter((index) => index >= 0);
            const optionIndex = matchingIndexes.length === 1 ? (matchingIndexes[0] ?? -1) : optionCount === 1 ? 0 : -1;
            if (optionIndex >= 0) await propertyOptions.nth(optionIndex).click();
            await this.page.waitForTimeout(350);
            correlatedProperty = (await relatedInput.inputValue()).trim();
          }
          if (!isPropertyActivityRelation(correlatedProperty)) {
            throw new WorkerError(
              "Il gestionale non ha ancora collegato l’attività all’immobile aperto; il worker riproverà automaticamente.",
              "portal_error",
              { portal: "CRM", action: "property-activity-correlation", propertyId: input.propertyId, correlatedProperty },
              true,
            );
          }

          // Cliente remains a mandatory CRM field, but it is not the origin of
          // the activity: navigation and correlation both stay on the property.
          const client = await this.uniqueVisible("activityClient", "Cliente dell’attività", ACTIVITY_FORM_TIMEOUT);
          let clientValue = (await client.inputValue()).trim();
          for (let wait = 0; !clientValue && wait < ACTIVITY_PREFILL_WAIT_CYCLES; wait += 1) {
            await this.page.waitForTimeout(250);
            clientValue = (await client.inputValue()).trim();
          }
          if (!clientValue && input.fallbackPersonId) {
            await client.fill("");
            const searchValue = input.fallbackPersonLabel?.trim() || input.fallbackPersonId;
            await client.pressSequentially(searchValue, { delay: 65 });
            const options = this.visible(this.selectors.activityOption);
            await options.first().waitFor({ state: "visible", timeout: 6_000 }).catch(() => undefined);
            const byRecordId = options.filter({ has: this.page.locator(`[data-item-id="${input.fallbackPersonId}"]`) });
            const labels = await options.allTextContents();
            const expectedLabel = normalizedUiText(input.fallbackPersonLabel);
            const textMatches = labels
              .map((label, index) => {
                const normalized = normalizedUiText(label);
                const matchesPerson = expectedLabel
                  ? normalized.includes(expectedLabel)
                  : normalized.includes(normalizedUiText(input.fallbackPersonId!));
                return matchesPerson && !/NUOVO RECORD/i.test(label) ? index : -1;
              })
              .filter((index) => index >= 0);
            if (await byRecordId.count() === 1) await byRecordId.first().click();
            else if (textMatches.length === 1) await options.nth(textMatches[0]!).click();
            await this.page.waitForTimeout(350);
            clientValue = (await client.inputValue()).trim();
          }
          if (!clientValue) {
            throw new WorkerError(
              "Il gestionale non ha ancora valorizzato il Cliente obbligatorio; il worker riproverà automaticamente dalla scheda immobile.",
              "portal_error",
              { portal: "CRM", action: "property-activity-client", propertyId: input.propertyId, fallbackPersonId: input.fallbackPersonId ?? null },
              true,
            );
          }

          const contactMode = await this.uniqueVisible("activityContactMode", "Modalità contatto", ACTIVITY_FORM_TIMEOUT);
          let currentContactMode = (await contactMode.inputValue()).trim();
          if (normalizedUiText(currentContactMode) !== normalizedUiText(input.contactMode)) {
            await contactMode.click();
            const desiredOptions = this.visible(this.selectors.activityOption);
            await desiredOptions.first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
            const labels = await desiredOptions.allTextContents();
            const indexes = labels
              .map((label, index) => normalizedUiText(label) === normalizedUiText(input.contactMode) ? index : -1)
              .filter((index) => index >= 0);
            if (indexes.length === 1) await desiredOptions.nth(indexes[0]!).click();
            await this.page.waitForTimeout(350);
            currentContactMode = (await contactMode.inputValue()).trim();
          }

          const status = await this.uniqueVisible("activityStatus", "Stato attività", ACTIVITY_FORM_TIMEOUT);
          let currentStatus = (await status.inputValue()).trim();
          if (normalizedUiText(currentStatus) !== normalizedUiText(input.status)) {
            await status.click();
            const desiredOptions = this.visible(this.selectors.activityOption);
            await desiredOptions.first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
            const labels = await desiredOptions.allTextContents();
            const indexes = labels
              .map((label, index) => normalizedUiText(label) === normalizedUiText(input.status) ? index : -1)
              .filter((index) => index >= 0);
            if (indexes.length === 1) await desiredOptions.nth(indexes[0]!).click();
            await this.page.waitForTimeout(300);
            currentStatus = (await status.inputValue()).trim();
          }

          if (normalizedUiText(await description.inputValue()) !== normalizedUiText(input.description)) {
            await description.fill(input.description);
          }
          if (normalizedUiText(await description.inputValue()) !== normalizedUiText(input.description)) {
            throw new WorkerError(
              "La descrizione dell’attività è stata cancellata dal gestionale durante il caricamento.",
              "portal_error",
              { portal: "CRM", action: "property-activity-description-final", propertyId: input.propertyId },
              true,
            );
          }
          if (normalizedUiText(currentContactMode) !== normalizedUiText(input.contactMode)) {
            throw new WorkerError(
              `Il modulo attività non può essere impostato automaticamente su modalità “${input.contactMode}”.`,
              "portal_error",
              { portal: "CRM", action: "property-activity-contact-mode", propertyId: input.propertyId, currentContactMode },
              true,
            );
          }
          if (normalizedUiText(currentStatus) !== normalizedUiText(input.status)) {
            throw new WorkerError(
              `Il modulo attività non può essere impostato automaticamente su “${input.status}”.`,
              "portal_error",
              { portal: "CRM", action: "property-activity-status", propertyId: input.propertyId, currentStatus },
              true,
            );
          }

          throwIfInterrupted();

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
          await this.closeActivityFollowUpPrompt(true);
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
          // This form was opened by the current attempt, so close it even when
          // its description is intentionally different from the default. The
          // guarded stale-modal cleanup remains in ensureCrmIdle for forms a
          // human may have opened before the worker started.
          await this.discardWorkerActivityFormForRetry().catch(() => undefined);
          await this.closeActivityFollowUpPrompt().catch(() => undefined);
          await this.page.waitForTimeout(600 * attempt);
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

  async findLinkedOwnerIds(propertyId: string, refresh = false): Promise<string[]> {
    if (propertyId.startsWith("dry-")) return [];
    return this.friendly("property-owner-check", "Non riesco a controllare i comproprietari collegati all’immobile.", async () => {
      this.require("propertyOwnersCard", "propertyOwnerLinks");
      await this.openProperty(propertyId, refresh);
      const card = this.page.locator(this.selectors.propertyOwnersCard).first();
      if (!(await card.count())) return [];
      const links = card.locator(this.selectors.propertyOwnerLinks);
      const linkedIds = await links.evaluateAll((nodes) => nodes.map((link) => {
        const href = link.getAttribute("href");
        return link.getAttribute("data-recordid")
          ?? link.getAttribute("data-id")
          ?? href?.match(/\/s\/account\/([^/?#]+)/i)?.[1]
          ?? "";
      }));
      return [...new Set(linkedIds.filter(Boolean))];
    });
  }

  private async selectOwnerPerson(
    dialog: Locator,
    personField: Locator,
    input: Pick<OwnerLinkInput, "personId" | "searchLabel" | "phones">,
  ) {
    let lastCandidateCount = 0;
    let sawCandidates = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await personField.fill("");
      await personField.pressSequentially(input.searchLabel, { delay: 90 });
      const options = dialog.locator(this.selectors.ownerPersonOption).filter({ visible: true });
      const appeared = await options.first().waitFor({ state: "visible", timeout: 7_000 })
        .then(() => true)
        .catch(() => false);
      if (!appeared) continue;

      let previousSnapshot = "";
      let stableSnapshots = 0;
      for (let wait = 0; wait < 10 && stableSnapshots < 2; wait += 1) {
        await this.page.waitForTimeout(250);
        const snapshot = JSON.stringify(await options.allTextContents());
        stableSnapshots = snapshot === previousSnapshot ? stableSnapshots + 1 : 0;
        previousSnapshot = snapshot;
      }

      const candidateCount = await options.count();
      lastCandidateCount = candidateCount;
      sawCandidates ||= candidateCount > 0;
      const candidates: Array<{ option: Locator; personId: string; text: string }> = [];
      for (let index = 0; index < candidateCount; index += 1) {
        // Resolve each option from the current list. Lightning can replace the
        // whole lookup between two frames while retaining identical text.
        const option = options.nth(index);
        const identity = option.locator('[data-item-id], [data-recordid], [data-id], a[href*="/s/account/"]').first();
        let candidatePersonId = "";
        if (await identity.count()) {
          const href = await identity.getAttribute("href");
          candidatePersonId = await identity.getAttribute("data-item-id")
            ?? await identity.getAttribute("data-recordid")
            ?? await identity.getAttribute("data-id")
            ?? recordIdFromHref(href, "account");
        }
        candidates.push({ option, personId: candidatePersonId, text: await option.innerText().catch(() => "") });
      }

      const selectionResult = selectOwnerLookupCandidate(candidates, input.personId, input.phones, input.searchLabel);
      if (!selectionResult) continue;
      const selected = candidates[selectionResult.index];
      if (!selected) continue;
      const clicked = await selected.option.click({ force: true, timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (!clicked) continue;

      const expectedWords = normalizedUiText(input.searchLabel).split(" ").filter(Boolean);
      for (let check = 0; check < 25; check += 1) {
        const selectedLabel = (await personField.inputValue().catch(() => "")).trim();
        const selectedText = normalizedUiText(selectedLabel);
        const nameConfirmed = expectedWords.length > 0 && expectedWords.every((word) => selectedText.includes(word));
        const lookupCommitted = await personField.getAttribute("readonly") !== null || await options.count() === 0;
        const formAdvanced = await this.visible(this.selectors.ownerRight).count() > 0;
        const selectedValueChanged = Boolean(selectedText)
          && selectedText !== normalizedUiText(input.searchLabel);
        const optionMarkedSelected = !lookupCommitted
          && await selected.option.getAttribute("aria-selected", { timeout: 300 }).catch(() => null) === "true";
        const exactCrmIdentitySelected = selectionResult.selection === "crm_id"
          && (selectedValueChanged || optionMarkedSelected);
        if (nameConfirmed && formAdvanced && (lookupCommitted || exactCrmIdentitySelected)) {
          return { ...selectionResult, candidateCount, selectedPersonLabel: selectedLabel, attempts: attempt };
        }
        await this.page.waitForTimeout(160);
      }
    }

    if (sawCandidates) {
      throw new WorkerError(
        "Il lookup mostra nominativi, ma nessuno coincide in modo sicuro con il comproprietario verificato.",
        "needs_review",
        { portal: "CRM", action: "property-owner-person", personId: input.personId, searchLabel: input.searchLabel, candidateCount: lastCandidateCount },
        true,
      );
    }
    throw new WorkerError(
      "Il lookup del comproprietario non ha completato il caricamento dopo tre tentativi automatici.",
      "portal_error",
      { portal: "CRM", action: "property-owner-lookup-retries", personId: input.personId, searchLabel: input.searchLabel, attempts: 3 },
      true,
    );
  }

  async linkOwner(propertyId: string, personInput: OwnerLinkInput, share: number): Promise<OwnerLinkResult> {
    const { personId, searchLabel, phones } = personInput;
    const throwIfInterrupted = () => {
      const interruption = personInput.interruptionRequested?.();
      if (interruption === "skip") throw new WorkerError("Immobile saltato prima del collegamento del comproprietario", "paused", { skipProperty: true, propertyId });
      if (interruption === "pause") throw new WorkerError("Lavorazione messa in pausa prima del collegamento del comproprietario", "paused", { pauseRequested: true });
    };
    throwIfInterrupted();
    if ((await this.findLinkedOwnerIds(propertyId)).includes(personId)) {
      return { linkId: `existing-link-${personId}`, selection: "existing", candidateCount: 1, note: null };
    }
    if (this.dryRun) {
      return { linkId: `dry-link-${personId}`, selection: "dry_run", candidateCount: 0, note: null };
    }
    return this.friendly("property-owner-link", "Non riesco a collegare il comproprietario.", async () => {
      this.require(
        "propertyOwnersCard", "ownerCreate", "ownerDialog", "ownerPersonId", "ownerPersonOption",
        "ownerRight", "ownerRole", "ownerRoleOption", "ownerShare", "ownerSave", "ownerCancel", "ownerAlreadyLinkedError",
      );
      await this.openProperty(propertyId);
      const card = await this.uniqueVisible("propertyOwnersCard", "Soggetti collegati", 20_000);
      const create = card.locator(this.selectors.ownerCreate).filter({ visible: true });
      await create.first().waitFor({ state: "visible", timeout: 10_000 });
      if (await create.count() !== 1) throw new WorkerError("Il comando per aggiungere il comproprietario non è univoco.", "portal_error", { portal: "CRM", action: "property-owner-create" }, true);
      await create.click({ force: true });

      const dialog = await this.uniqueVisible("ownerDialog", "Soggetto correlato", 15_000);
      const person = await this.uniqueVisible("ownerPersonId", "Cliente comproprietario", 10_000);
      throwIfInterrupted();
      const selectionResult = await this.selectOwnerPerson(dialog, person, { personId, searchLabel, phones });
      const { selection, note, candidateCount } = selectionResult;

      const right = await this.uniqueVisible("ownerRight", "Diritto", 8_000);
      await right.fill("Proprietà");
      await this.propertyPicklist("ownerRole", "Ruolo", "Comproprietario");
      const roleValue = this.visible(this.selectors.ownerRole).first().locator('input[role="textbox"]').filter({ visible: true }).first();
      const quota = await this.uniqueVisible("ownerShare", "Quota", 8_000);
      await quota.fill(formatShareForUi(share));
      if (normalizedUiText(await right.inputValue()) !== normalizedUiText("Proprietà")
        || normalizedUiText(await roleValue.inputValue().catch(() => "")) !== normalizedUiText("Comproprietario")
        || normalizedUiText(await quota.inputValue()) !== normalizedUiText(formatShareForUi(share))) {
        throw new WorkerError(
          "Il gestionale ha cancellato diritto, ruolo o quota durante la compilazione del comproprietario; il worker riproverà automaticamente.",
          "portal_error",
          { portal: "CRM", action: "property-owner-form-reset", personId, searchLabel },
          true,
        );
      }
      throwIfInterrupted();

      const save = dialog.locator(this.selectors.ownerSave).filter({ visible: true });
      if (await save.count() !== 1) throw new WorkerError("Il pulsante Salva del comproprietario non è univoco.", "portal_error", { portal: "CRM", action: "property-owner-save" }, true);
      await save.click();
      const alreadyLinked = this.visible(this.selectors.ownerAlreadyLinkedError);
      const outcome = await Promise.race([
        dialog.waitFor({ state: "hidden", timeout: 15_000 }).then(() => "saved" as const),
        alreadyLinked.first().waitFor({ state: "visible", timeout: 15_000 }).then(() => "existing" as const),
      ]);
      if (outcome === "existing") {
        const cancel = dialog.locator(this.selectors.ownerCancel).filter({ visible: true });
        if (await cancel.count() === 1) await cancel.click();
        await dialog.waitFor({ state: "hidden", timeout: 10_000 });
        return { linkId: `existing-link-${personId}`, selection: "existing", candidateCount, note };
      }
      await this.checkSession();
      let linkedIds = await this.findLinkedOwnerIds(propertyId);
      if (!linkedIds.includes(personId)) {
        // The relationship panel is eventually consistent. Re-open the record
        // once before deciding, but never click Nuovo again after a save.
        await this.page.waitForTimeout(800);
        linkedIds = await this.findLinkedOwnerIds(propertyId, true);
      }
      if (!linkedIds.includes(personId)) {
        return {
          linkId: `saved-owner-link-${personId}`,
          selection: "saved_unverified",
          candidateCount,
          note: note ?? "Salvataggio del comproprietario inviato; il pannello non lo espone ancora dopo il ricaricamento. Il worker non ripete l'inserimento per evitare duplicati.",
        };
      }
      return { linkId: `owner-link-${personId}`, selection, candidateCount, note };
    });
  }
}
