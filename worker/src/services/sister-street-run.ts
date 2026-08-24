import type { Locator, Page } from "playwright";

import { PlaywrightSisterAdapter } from "../adapters/sister/index.js";
import { WorkerError } from "../core/errors.js";
import { buildCadastralKey } from "../core/normalize.js";
import type { CadastralOwner, CadastralProperty } from "../types.js";
import {
  exactStreetVariants,
  normalizeSisterStreet,
  shouldStopStreetRun,
  splitSisterStreetInput,
  updateVerifiedEmptyCounters,
  type SisterStreetVariant,
} from "../core/street-scan.js";

export type StreetQueryOutcome = "empty" | "found" | "failed" | "paused";

export type SisterStreetQueryResult = {
  civicNumber: number | null;
  variantKey: string;
  variantSourceId: string;
  outcome: StreetQueryOutcome;
  rawRecords: number;
  acceptedProperties: number;
  propertyKeys: string[];
  ownersRead: number;
  skippedPropertyRows: number;
  warnings: string[];
  elapsedMs: number;
};

export type SisterStreetRunCheckpoint = {
  version: 3;
  strategy: "bulk_exact_variants" | "civic_fallback";
  mode: "dry_run" | "live";
  importJobId: string | null;
  requestedStreet: string;
  municipality: "BITONTO";
  status: "running" | "paused" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  nextCivicNumber: number;
  currentVariantIndex: number;
  emptyWindow: number;
  consecutiveEmptyByVariant: Record<string, number>;
  variants: SisterStreetVariant[];
  results: SisterStreetQueryResult[];
  totalRawRecords: number;
  totalAcceptedOccurrences: number;
  totalAcceptedProperties: number;
  uniquePropertyKeys: string[];
  totalOwnersRead: number;
  totalSkippedPropertyRows: number;
  lastError: string | null;
  inferredLastUsefulCivic: number | null;
};

type StreetRunOptions = {
  emptyWindow?: number;
  startCivic?: number;
  maximumCivic?: number;
  maxQueryAttempts?: number;
  acquireOwners?: boolean;
  prepareSearchAutomatically?: boolean;
  strategy?: "bulk_exact_variants" | "civic_fallback";
  mode?: "dry_run" | "live";
  importJobId?: string | null;
  onPropertyAcquired?: (
    variant: SisterStreetVariant,
    property: CadastralProperty,
    owners: CadastralOwner[],
  ) => void | Promise<void>;
  isCancelled?: () => boolean;
  onCheckpoint?: (checkpoint: SisterStreetRunCheckpoint) => void | Promise<void>;
};

const SEARCH_FORM = 'form[name="ricercaIndForm"]';
const ADDRESS_FORM = 'form[name="SceltaIndirizzoForm"]';
const ADDRESS_SELECT = `${ADDRESS_FORM} select[name="indirizzoSel"]`;
const RESULTS_ROWS = 'form[name="SceltaVisuraImmSoggForm"] input[name="visImmSel"]';
const NO_MATCH_PATTERN = /nessuna corrispondenza trovata/i;

async function clickAndWait(page: Page, locator: Locator, description: string) {
  if (await locator.count() !== 1) {
    throw new WorkerError(`Comando SISTER non univoco durante ${description}`, "portal_error", {
      portal: "SISTER", action: "street-run-navigation", description, count: await locator.count(),
    }, true);
  }
  await locator.click();
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
}

async function readOptions(select: Locator): Promise<Array<{ text: string; value: string }>> {
  return select.locator("option").evaluateAll((options) => options.map((option) => ({
    text: (option.textContent ?? "").replace(/\s+/g, " ").trim(),
    value: (option as HTMLOptionElement).value,
  })));
}

export class SisterStreetRun {
  private readonly adapter: PlaywrightSisterAdapter;
  private readonly emptyWindow: number;
  private readonly startCivic: number;
  private readonly maximumCivic: number;
  private readonly maxQueryAttempts: number;
  private readonly acquireOwners: boolean;
  private readonly prepareSearchAutomatically: boolean;
  private readonly strategy: "bulk_exact_variants" | "civic_fallback";
  private readonly mode: "dry_run" | "live";

  constructor(private readonly page: Page, private readonly options: StreetRunOptions = {}) {
    this.adapter = new PlaywrightSisterAdapter(page);
    this.emptyWindow = options.emptyWindow ?? 50;
    this.startCivic = options.startCivic ?? 1;
    this.maximumCivic = options.maximumCivic ?? 5_000;
    this.maxQueryAttempts = options.maxQueryAttempts ?? 3;
    this.acquireOwners = options.acquireOwners !== false;
    this.prepareSearchAutomatically = options.prepareSearchAutomatically === true;
    this.strategy = options.strategy ?? "bulk_exact_variants";
    this.mode = options.mode ?? "dry_run";
  }

  async run(requestedStreet: string, resume?: SisterStreetRunCheckpoint): Promise<SisterStreetRunCheckpoint> {
    const variants = this.prepareSearchAutomatically
      ? await this.prepareStreet(requestedStreet)
      : await this.readPreparedAddressList(requestedStreet, Boolean(resume));
    const normalizedRequestedStreet = normalizeSisterStreet(requestedStreet);
    if (resume && normalizeSisterStreet(resume.requestedStreet) !== normalizedRequestedStreet) {
      throw new Error("Il checkpoint appartiene a una via diversa");
    }
    const now = new Date().toISOString();
    const compatibleResume = resume?.version === 3 && resume.strategy === this.strategy && resume.mode === this.mode ? resume : undefined;
    let checkpoint: SisterStreetRunCheckpoint = compatibleResume
      ? {
          ...compatibleResume,
          status: "running",
          updatedAt: now,
          completedAt: null,
          variants,
          consecutiveEmptyByVariant: Object.fromEntries(variants.map((variant) => [
            variant.key,
            compatibleResume.consecutiveEmptyByVariant[variant.key] ?? 0,
          ])),
          lastError: null,
        }
      : {
          version: 3,
          strategy: this.strategy,
          mode: this.mode,
          importJobId: this.options.importJobId ?? null,
          requestedStreet: normalizedRequestedStreet,
          municipality: "BITONTO",
          status: "running",
          startedAt: now,
          updatedAt: now,
          completedAt: null,
          nextCivicNumber: this.startCivic,
          currentVariantIndex: 0,
          emptyWindow: this.emptyWindow,
          consecutiveEmptyByVariant: Object.fromEntries(variants.map((variant) => [variant.key, 0])),
          variants,
          results: [],
          totalRawRecords: 0,
          totalAcceptedOccurrences: 0,
          totalAcceptedProperties: 0,
          uniquePropertyKeys: [],
          totalOwnersRead: 0,
          totalSkippedPropertyRows: 0,
          lastError: null,
          inferredLastUsefulCivic: null,
        };
    await this.publish(checkpoint);

    try {
      if (checkpoint.strategy === "bulk_exact_variants") {
        while (checkpoint.currentVariantIndex < variants.length) {
          if (this.options.isCancelled?.()) {
            checkpoint = { ...checkpoint, status: "paused", updatedAt: new Date().toISOString() };
            await this.publish(checkpoint);
            return checkpoint;
          }
          const variant = variants[checkpoint.currentVariantIndex];
          if (!variant) break;
          const result = await this.queryWithParachute(variant, null, normalizedRequestedStreet);
          const replacedPartial = checkpoint.results.find((entry) =>
            entry.variantKey === result.variantKey && entry.outcome === "paused");
          const previousResults = checkpoint.results.filter((entry) => entry !== replacedPartial);
          const nextResults = [...previousResults, result];
          const uniquePropertyKeys = [...new Set(nextResults.flatMap((entry) => entry.propertyKeys))];
          checkpoint = {
            ...checkpoint,
            updatedAt: new Date().toISOString(),
            currentVariantIndex: ["failed", "paused"].includes(result.outcome) ? checkpoint.currentVariantIndex : checkpoint.currentVariantIndex + 1,
            results: nextResults,
            totalRawRecords: checkpoint.totalRawRecords - (replacedPartial?.rawRecords ?? 0) + result.rawRecords,
            totalAcceptedOccurrences: (checkpoint.totalAcceptedOccurrences ?? checkpoint.totalAcceptedProperties)
              - (replacedPartial?.acceptedProperties ?? 0) + result.acceptedProperties,
            totalAcceptedProperties: uniquePropertyKeys.length,
            uniquePropertyKeys,
            totalOwnersRead: checkpoint.totalOwnersRead - (replacedPartial?.ownersRead ?? 0) + result.ownersRead,
            totalSkippedPropertyRows: checkpoint.totalSkippedPropertyRows - (replacedPartial?.skippedPropertyRows ?? 0) + result.skippedPropertyRows,
            lastError: result.outcome === "failed" ? result.warnings.join("; ") : null,
          };
          await this.publish(checkpoint);
          if (result.outcome === "paused") {
            checkpoint = { ...checkpoint, status: "paused", updatedAt: new Date().toISOString() };
            await this.publish(checkpoint);
            return checkpoint;
          }
          if (result.outcome === "failed") {
            checkpoint = { ...checkpoint, status: "paused", updatedAt: new Date().toISOString() };
            await this.publish(checkpoint);
            return checkpoint;
          }
        }
        const completedAt = new Date().toISOString();
        checkpoint = {
          ...checkpoint,
          status: "completed",
          updatedAt: completedAt,
          completedAt,
          inferredLastUsefulCivic: null,
          lastError: checkpoint.results.some((result) => result.outcome === "failed")
            ? "Una o più varianti esatte non sono state verificate dopo i tentativi automatici."
            : null,
        };
        await this.publish(checkpoint);
        return checkpoint;
      }

      while (!shouldStopStreetRun(
        variants,
        checkpoint.consecutiveEmptyByVariant,
        checkpoint.emptyWindow,
        checkpoint.currentVariantIndex,
      )) {
        if (this.options.isCancelled?.()) {
          checkpoint = { ...checkpoint, status: "paused", updatedAt: new Date().toISOString() };
          await this.publish(checkpoint);
          return checkpoint;
        }
        if (checkpoint.nextCivicNumber > this.maximumCivic) {
          throw new WorkerError(
            `Limite di sicurezza di ${this.maximumCivic} civici raggiunto senza dimostrare la fine della via`,
            "needs_review",
            { portal: "SISTER", action: "street-run-safety-cap", civicNumber: checkpoint.nextCivicNumber },
            true,
          );
        }

        const variantIndex = checkpoint.currentVariantIndex;
        const variant = variants[variantIndex];
        if (!variant) throw new Error("Cursore variante non valido");
        const result = await this.queryWithParachute(variant, checkpoint.nextCivicNumber, normalizedRequestedStreet);
        if (result.outcome === "paused") {
          checkpoint = { ...checkpoint, status: "paused", updatedAt: new Date().toISOString() };
          await this.publish(checkpoint);
          return checkpoint;
        }
        const counters = updateVerifiedEmptyCounters(
          checkpoint.consecutiveEmptyByVariant,
          variant.key,
          result.outcome,
        );
        const nextVariantIndex = variantIndex + 1;
        const completedCivic = nextVariantIndex >= variants.length;
        const uniquePropertyKeys = [...new Set([
          ...(checkpoint.uniquePropertyKeys ?? []),
          ...result.propertyKeys,
        ])];
        checkpoint = {
          ...checkpoint,
          updatedAt: new Date().toISOString(),
          nextCivicNumber: completedCivic ? checkpoint.nextCivicNumber + 1 : checkpoint.nextCivicNumber,
          currentVariantIndex: completedCivic ? 0 : nextVariantIndex,
          consecutiveEmptyByVariant: counters,
          results: [...checkpoint.results, result],
          totalRawRecords: checkpoint.totalRawRecords + result.rawRecords,
          totalAcceptedOccurrences: (checkpoint.totalAcceptedOccurrences ?? checkpoint.totalAcceptedProperties) + result.acceptedProperties,
          totalAcceptedProperties: uniquePropertyKeys.length,
          uniquePropertyKeys,
          totalOwnersRead: checkpoint.totalOwnersRead + result.ownersRead,
          totalSkippedPropertyRows: checkpoint.totalSkippedPropertyRows + result.skippedPropertyRows,
          lastError: result.outcome === "failed" ? result.warnings.join("; ") : null,
        };
        await this.publish(checkpoint);
      }

      const completedAt = new Date().toISOString();
      checkpoint = {
        ...checkpoint,
        status: "completed",
        updatedAt: completedAt,
        completedAt,
        inferredLastUsefulCivic: Math.max(this.startCivic - 1, checkpoint.nextCivicNumber - 1 - checkpoint.emptyWindow),
        lastError: null,
      };
      await this.publish(checkpoint);
      return checkpoint;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checkpoint = {
        ...checkpoint,
        status: error instanceof WorkerError && ["session_expired", "needs_review"].includes(error.status)
          ? "paused"
          : "failed",
        updatedAt: new Date().toISOString(),
        lastError: message,
      };
      await this.publish(checkpoint);
      throw error;
    }
  }

  private async publish(checkpoint: SisterStreetRunCheckpoint) {
    await this.options.onCheckpoint?.(structuredClone(checkpoint));
  }

  private async assertSession() {
    const url = this.page.url();
    const title = await this.page.title().catch(() => "");
    const password = await this.page.locator('input[type="password"]').count().catch(() => 0);
    if (/sessione[_-]?scaduta|login|accesso/i.test(url) || /sessione\s+scaduta/i.test(title) || password) {
      throw new WorkerError(
        "La sessione SISTER non è più attiva. Il cursore della via è stato salvato: accedi di nuovo e riprendi.",
        "session_expired",
        { portal: "SISTER", action: "street-run-session" },
        true,
      );
    }
  }

  private async prepareStreet(requestedStreet: string): Promise<SisterStreetVariant[]> {
    await this.ensureSearchForm();
    const form = this.page.locator(SEARCH_FORM);
    const municipality = form.locator('select[name="comuneCat"]');
    const municipalityOptions = await readOptions(municipality);
    const bitonto = municipalityOptions.find((option) => normalizeSisterStreet(option.text) === "BITONTO");
    if (!bitonto) throw new WorkerError("Comune di Bitonto non disponibile nella ricerca SISTER", "portal_error", { portal: "SISTER" }, true);
    await municipality.selectOption(bitonto.value);

    const toponym = form.locator('select[name="toponimo"]');
    const parsed = splitSisterStreetInput(requestedStreet, await readOptions(toponym));
    await toponym.selectOption(parsed.toponymValue);
    await form.locator('input[name="indirizzo"]').fill(parsed.addressText);
    const exactMode = form.locator('input[name="parIntera"][value="1"]');
    if (await exactMode.count() !== 1) {
      throw new WorkerError("Modalità di ricerca per dizione esatta non riconosciuta", "portal_error", { portal: "SISTER" }, true);
    }
    await exactMode.check();
    await clickAndWait(this.page, form.locator('input[name="ricerca"]'), "la ricerca della via");
    await this.assertSession();

    const select = this.page.locator(ADDRESS_SELECT);
    if (await select.count() !== 1) {
      throw new WorkerError(
        `Nessuna via selezionabile trovata per “${normalizeSisterStreet(requestedStreet)}”`,
        "data_incomplete",
        { portal: "SISTER", action: "street-run-address-options" },
        true,
      );
    }
    const variants = exactStreetVariants(parsed.requestedStreet, await readOptions(select));
    if (!variants.length) {
      throw new WorkerError(
        `SISTER non ha restituito una corrispondenza testuale esatta per “${parsed.requestedStreet}”`,
        "data_incomplete",
        { portal: "SISTER", action: "street-run-exact-match" },
        true,
      );
    }
    return variants;
  }

  private async readPreparedAddressList(
    requestedStreet: string,
    allowHistoryRecovery = false,
  ): Promise<SisterStreetVariant[]> {
    await this.assertSession();
    const select = this.page.locator(ADDRESS_SELECT);
    if (allowHistoryRecovery && await select.count() !== 1) {
      await this.recoverToAddressList(requestedStreet).catch(() => undefined);
    }
    if (await select.count() !== 1) {
      throw new WorkerError(
        "Prepara manualmente SISTER fino alla pagina Elenco indirizzi, poi avvia o riprendi la scansione.",
        "needs_review",
        { portal: "SISTER", action: "street-run-manual-address-list", url: this.page.url() },
        true,
      );
    }
    const normalizedRequestedStreet = normalizeSisterStreet(requestedStreet);
    const variants = exactStreetVariants(normalizedRequestedStreet, await readOptions(select));
    if (!variants.length) {
      throw new WorkerError(
        `Nell'Elenco indirizzi aperto non esiste la via esatta "${normalizedRequestedStreet}". Le vie simili non vengono usate.`,
        "needs_review",
        { portal: "SISTER", action: "street-run-exact-match" },
        true,
      );
    }
    return variants;
  }

  private async ensureSearchForm() {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await this.assertSession();
      if (await this.page.locator(`${SEARCH_FORM} input[name="indirizzo"]`).count() === 1) return;
      if (await this.page.locator(ADDRESS_SELECT).count() === 1) {
        await clickAndWait(this.page, this.page.locator(`${SEARCH_FORM} input[type="submit"]`), "il ritorno al form via");
        continue;
      }
      if (await this.page.locator(RESULTS_ROWS).count() > 0 || await this.page.getByText(NO_MATCH_PATTERN).count() > 0) {
        await this.returnToAddressList();
        continue;
      }
      await this.adapter.ensureResultsPage().catch(() => undefined);
      if (await this.page.locator(RESULTS_ROWS).count() > 0) continue;
      break;
    }
    throw new WorkerError(
      "Impossibile tornare al form di ricerca per indirizzo SISTER",
      "portal_error",
      { portal: "SISTER", action: "street-run-search-form", url: this.page.url() },
      true,
    );
  }

  private async ensureAddressList(requestedStreet: string) {
    if (await this.page.locator(ADDRESS_SELECT).count() === 1) return;
    if (this.prepareSearchAutomatically) {
      await this.prepareStreet(requestedStreet);
      return;
    }
    throw new WorkerError(
      "Elenco indirizzi SISTER non disponibile. Il checkpoint e' salvo: ripristina manualmente la pagina e riprendi.",
      "needs_review",
      { portal: "SISTER", action: "street-run-manual-address-list", url: this.page.url() },
      true,
    );
  }

  private async queryWithParachute(
    variant: SisterStreetVariant,
    civicNumber: number | null,
    requestedStreet: string,
  ): Promise<SisterStreetQueryResult> {
    let lastError: unknown = null;
    let lastRecoveryError: unknown = null;
    for (let attempt = 1; attempt <= this.maxQueryAttempts; attempt += 1) {
      const startedAt = Date.now();
      try {
        await this.ensureAddressList(requestedStreet);
        const liveOptions = exactStreetVariants(requestedStreet, await readOptions(this.page.locator(ADDRESS_SELECT)));
        const liveVariant = liveOptions.find((candidate) => candidate.key === variant.key)
          ?? liveOptions.find((candidate) => candidate.sourceId === variant.sourceId);
        if (!liveVariant) throw new Error(`Variante SISTER ${variant.sourceId} non più disponibile`);
        return await this.queryOnce(liveVariant, civicNumber, startedAt);
      } catch (error) {
        lastError = error;
        if (error instanceof WorkerError && error.status === "session_expired") throw error;
        try {
          await this.recoverToAddressList(requestedStreet);
          lastRecoveryError = null;
        } catch (recoveryError) {
          lastRecoveryError = recoveryError;
          if (recoveryError instanceof WorkerError
            && ["session_expired", "needs_review"].includes(recoveryError.status)) {
            throw recoveryError;
          }
        }
      }
    }
    const finalError = lastRecoveryError ?? lastError;
    const message = finalError instanceof Error ? finalError.message : String(finalError);
    return {
      civicNumber,
      variantKey: variant.key,
      variantSourceId: variant.sourceId,
      outcome: "failed",
      rawRecords: 0,
      acceptedProperties: 0,
      propertyKeys: [],
      ownersRead: 0,
      skippedPropertyRows: 0,
      warnings: [`${civicNumber == null ? `Variante ${variant.sourceId}` : `Civico ${civicNumber}`} non verificat${civicNumber == null ? "a" : "o"} dopo ${this.maxQueryAttempts} tentativi: ${message}`],
      elapsedMs: 0,
    };
  }

  private async queryOnce(
    variant: SisterStreetVariant,
    civicNumber: number | null,
    startedAt: number,
  ): Promise<SisterStreetQueryResult> {
    const form = this.page.locator(ADDRESS_FORM);
    await form.locator('select[name="indirizzoSel"]').selectOption(variant.value);
    await form.locator('input[name="numCivicoDal"]').fill(civicNumber == null ? "" : String(civicNumber));
    const civicTo = form.locator('input[name="numCivicoAl"]');
    if (await civicTo.count() === 1) await civicTo.fill("");
    await clickAndWait(this.page, form.locator('input[name="ricerca"]'), civicNumber == null ? `l'intera variante ${variant.sourceId}` : `il civico ${civicNumber}`);
    await this.assertSession();

    const rawRecords = await this.page.locator(RESULTS_ROWS).count();
    const explicitEmpty = await this.page.getByText(NO_MATCH_PATTERN).count() > 0;
    if (!rawRecords && !explicitEmpty) {
      throw new WorkerError(
        `Risposta SISTER non riconosciuta per ${civicNumber == null ? `la variante ${variant.sourceId} senza civico` : `il civico ${civicNumber}`}`,
        "portal_error",
        { portal: "SISTER", action: "street-run-result-structure", civicNumber, variant: variant.sourceId },
        true,
      );
    }
    if (explicitEmpty) {
      await this.returnToAddressList();
      return {
        civicNumber,
        variantKey: variant.key,
        variantSourceId: variant.sourceId,
        outcome: "empty",
        rawRecords: 0,
        acceptedProperties: 0,
        propertyKeys: [],
        ownersRead: 0,
        skippedPropertyRows: 0,
        warnings: [],
        elapsedMs: Date.now() - startedAt,
      };
    }

    const properties = await this.adapter.extractProperties();
    let ownersRead = 0;
    let skippedPropertyRows = 0;
    const acquiredPropertyKeys: string[] = [];
    const warnings: string[] = [];
    if (this.acquireOwners) {
      for (const property of properties) {
        if (this.options.isCancelled?.()) {
          await this.adapter.ensureResultsPage().catch(() => undefined);
          await this.returnToAddressList();
          return {
            civicNumber,
            variantKey: variant.key,
            variantSourceId: variant.sourceId,
            outcome: "paused",
            rawRecords: 0,
            acceptedProperties: acquiredPropertyKeys.length,
            propertyKeys: acquiredPropertyKeys,
            ownersRead,
            skippedPropertyRows,
            warnings: ["Pausa richiesta durante la lettura dei proprietari; la variante verrà ripresa in modo idempotente."],
            elapsedMs: Date.now() - startedAt,
          };
        }
        let acquired = false;
        let acquiredOwners: CadastralOwner[] = [];
        let propertyError: unknown = null;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            acquiredOwners = await this.adapter.extractOwners(property);
            ownersRead += acquiredOwners.length;
            acquired = true;
            break;
          } catch (error) {
            propertyError = error;
            if (error instanceof WorkerError && error.status === "session_expired") throw error;
            await this.adapter.ensureResultsPage().catch(() => undefined);
          }
        }
        if (!acquired) {
          skippedPropertyRows += 1;
          warnings.push(`Riga ${property.sourceRef ?? "?"} isolata: ${propertyError instanceof Error ? propertyError.message : String(propertyError)}`);
        } else {
          await this.options.onPropertyAcquired?.(variant, property, acquiredOwners);
          acquiredPropertyKeys.push(buildCadastralKey(property));
        }
      }
    }
    await this.adapter.ensureResultsPage();
    await this.returnToAddressList();
    return {
      civicNumber,
      variantKey: variant.key,
      variantSourceId: variant.sourceId,
      outcome: "found",
      rawRecords,
      acceptedProperties: properties.length,
      propertyKeys: properties.map((property) => buildCadastralKey(property)),
      ownersRead,
      skippedPropertyRows,
      warnings,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private async returnToAddressList() {
    if (await this.page.locator(ADDRESS_SELECT).count() === 1) return;
    await this.adapter.ensureResultsPage().catch(() => undefined);
    const back = this.page.locator(`${ADDRESS_FORM} input[type="submit"]`);
    await clickAndWait(this.page, back, "il ritorno all'elenco indirizzi");
    if (await this.page.locator(ADDRESS_SELECT).count() !== 1) {
      throw new WorkerError(
        "Elenco indirizzi SISTER non ripristinato",
        "portal_error",
        { portal: "SISTER", action: "street-run-return-address-list", url: this.page.url() },
        true,
      );
    }
  }

  private async recoverToAddressList(requestedStreet: string) {
    await this.assertSession();
    if (await this.page.locator(ADDRESS_SELECT).count() === 1) return;
    if (await this.page.locator(RESULTS_ROWS).count() > 0 || await this.page.getByText(NO_MATCH_PATTERN).count() > 0) {
      await this.returnToAddressList();
      return;
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
      await this.assertSession();
      if (await this.page.locator(ADDRESS_SELECT).count() === 1) return;
      if (await this.page.locator(RESULTS_ROWS).count() > 0 || await this.page.getByText(NO_MATCH_PATTERN).count() > 0) {
        await this.returnToAddressList();
        return;
      }
    }
    if (this.prepareSearchAutomatically) {
      await this.prepareStreet(requestedStreet);
      return;
    }
    throw new WorkerError(
      "SISTER non e' piu' sulla pagina Elenco indirizzi. Il checkpoint e' salvo: ripristina manualmente la pagina e riprendi.",
      "needs_review",
      { portal: "SISTER", action: "street-run-manual-address-list", url: this.page.url() },
      true,
    );
  }
}
