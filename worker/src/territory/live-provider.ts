import { CloudIdentityMemory } from "./cloud-memory.js";
import { ImportV2Error } from "../import-v2/errors.js";
import type { TerritoryStore } from "./store.js";
import type { TecnocloudV2Port } from "../import-v2/ports.js";
import { connectToChrome, connectToCrmChrome, type ChromeTabs, type CrmChromeTab } from "../services/chrome.js";
import { SisterStreetRun, hasRetryableAcquisitionRecords, prepareStreetAcquisitionRetry, type SisterStreetRunCheckpoint } from "../services/sister-street-run.js";
import { TecnocloudUiV2Port } from "../import-v2/tecnocloud-ui-port.js";
import { buildPlan } from "../import-v2/identity.js";
import { ExcelContactsAdapter } from "../adapters/excel/index.js";
import type { SourceProperty } from "../import-v2/model.js";
import { latest, unitKey, type Street } from "./model.js";
import type { ScanSink, TerritoryProvider } from "./providers.js";
import type { StreetPropertyFilters } from "../core/network-exploration.js";
import { runSettings } from "./run-options.js";
import { sisterSource, reusableSisterSource } from "./sister-memory.js";
import { sourceProblem } from "./quarantine.js";

export type LiveConfig = { cdpUrl: string; sisterTabMatch: string; crmTabMatch: string; contactsExcelPath?: string; allowedCadastralKeys: string[]; allowedTaxCodes: string[]; allowCreate: boolean };
export type LiveBrowserConfig = Pick<LiveConfig, "cdpUrl" | "sisterTabMatch" | "crmTabMatch">;
export function validateLiveConfig(value: LiveConfig, workBrowser?: LiveBrowserConfig): LiveConfig {
  // A different CDP port alone does not authorise real writes. The allowlist is empty by default.
  const url = new URL(value.cdpUrl);
  const expected = new URL(workBrowser?.cdpUrl ?? "http://127.0.0.1:9223");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.port !== expected.port || url.pathname !== "/") throw new Error(workBrowser ? "Worker V2 deve usare il Chrome di lavoro configurato nell’app." : "Il laboratorio usa solo Chrome locale sulla porta 9223. Il Chrome quotidiano sulla 9222 è escluso.");
  if (!value.sisterTabMatch || !value.crmTabMatch || !Array.isArray(value.allowedCadastralKeys) || !Array.isArray(value.allowedTaxCodes) || typeof value.allowCreate !== "boolean") throw new Error("Configurazione di prova incompleta: servono immobili, intestatari e scelta sulle nuove schede");
  if (![...value.allowedCadastralKeys, ...value.allowedTaxCodes].every(v => typeof v === "string" && v.trim().length > 0)) throw new Error("Lista delle schede di prova non valida");
  return { ...value, allowedCadastralKeys: value.allowedCadastralKeys.map(v => v.trim().toUpperCase()), allowedTaxCodes: value.allowedTaxCodes.map(v => v.trim().toUpperCase()) };
}

/** Opt-in bridge to existing adapters. No stable config, Supabase client or job queue. */
export class LiveProvider implements TerritoryProvider {
  readonly origin = "live" as const;
  private tabsPromise: Promise<ChromeTabs> | null = null;
  private crmPromise: Promise<CrmChromeTab> | null = null;
  private config: LiveConfig;
  private memory: CloudIdentityMemory | null = null;
  private readonly submittedActivities = new Set<string>();
  constructor(config: LiveConfig, private readonly paused: () => boolean, private readonly workBrowser?: LiveBrowserConfig, private readonly writeAccess: "test" | "operational" = "test", private readonly store?: TerritoryStore) {
    if (writeAccess === "operational" && !workBrowser) throw new Error("La modalità operativa richiede il Chrome di lavoro affidato dal desktop");
    this.config = validateLiveConfig(config, workBrowser);
  }
  configure(config: LiveConfig) { this.config = validateLiveConfig(config, this.workBrowser); this.endOperation(); }
  beginOperation(_operation: "scan" | "compare" | "apply") { this.submittedActivities.clear(); this.memory = this.store ? new CloudIdentityMemory(this.store.read()) : null; }
  rememberCloud(state: import("./model.js").TerritoryState) { this.memory?.flush(state); }
  endOperation() {
    this.memory = null;
    const connection = this.tabsPromise; this.tabsPromise = null;
    const crm = this.crmPromise; this.crmPromise = null;
    void connection?.then(tabs => tabs.browser.close()).catch(() => undefined);
    void crm?.then(tabs => tabs.browser.close()).catch(() => undefined);
  }
  async resetConnection() {
    const connection = this.tabsPromise; this.tabsPromise = null;
    const crm = this.crmPromise; this.crmPromise = null;
    await connection?.then(tabs => tabs.browser.close()).catch(() => undefined);
    await crm?.then(tabs => tabs.browser.close()).catch(() => undefined);
  }
  private tabs() { return this.tabsPromise ??= connectToChrome(this.config.cdpUrl, this.config.sisterTabMatch, this.config.crmTabMatch).catch(error => {
    this.tabsPromise = null;
    throw new ImportV2Error(error instanceof Error ? error.message : "Chrome non raggiungibile", "global_portal", { global: true, retryable: true });
  }); }
  private crmTabs() { return this.crmPromise ??= connectToCrmChrome(this.config.cdpUrl, this.config.crmTabMatch).catch(error => {
    this.crmPromise = null;
    throw new ImportV2Error(error instanceof Error ? error.message : "Tecnocloud non raggiungibile", "global_portal", { global: true, retryable: true });
  }); }
  canWrite(key: string, source?: SourceProperty) {
    if (this.writeAccess === "operational") {
      try {
        if (!source || source.municipality.trim().toUpperCase() !== "BITONTO" || unitKey(source) !== key) return false;
        buildPlan(source); return true;
      } catch { return false; }
    }
    return this.config.allowedCadastralKeys.includes(key) && Boolean(source && source.owners.length && source.owners.every(owner => this.config.allowedTaxCodes.includes(owner.taxCode.trim().toUpperCase())));
  }
  authorizeWrite(source: SourceProperty, kind: "create" | "update") {
    if (source.municipality.trim().toUpperCase() !== "BITONTO" || !this.canWrite(unitKey(source), source)) throw new Error(this.writeAccess === "operational" ? "Identità catastale o intestatari incompleti, oppure immobile fuori dal Comune di Bitonto" : "Immobile o intestatari fuori dalle schede concordate");
    if (this.writeAccess === "test" && kind === "create" && !this.config.allowCreate) throw new Error("Il collaudo concordato ammette solo aggiornamenti di schede esistenti");
  }
  async port(): Promise<TecnocloudV2Port> {
    const base = new TecnocloudUiV2Port((await this.crmTabs()).crmPage, false, { isInterruptionRequested: this.paused, cadastralLookupOnly: true, recoverReadLoading: true, submittedActivities: this.submittedActivities });
    this.memory ??= this.store ? new CloudIdentityMemory(this.store.read()) : null;
    return this.memory?.port(base) ?? base;
  }
  async candidates(_street: Street, source: SourceProperty) {
    const port = await this.port(); await port.assertSession();
    return { rows: await port.findPropertiesByCadastralIdentity(buildPlan(source)), complete: true };
  }
  async scan(street: Street, runId: string, checkpoint: unknown, sink: ScanSink, save: (checkpoint: unknown) => Promise<void>, paused: () => boolean, filters?: StreetPropertyFilters, options = runSettings()) {
    if (street.needsReview) throw new Error("Via ufficiale da verificare prima dell'acquisizione");
    const tabs = await this.tabs();
    let contacts: ExcelContactsAdapter | null = null;
    if (this.config.contactsExcelPath) { contacts = new ExcelContactsAdapter(this.config.contactsExcelPath); await contacts.load(); }
    const prior = checkpoint as SisterStreetRunCheckpoint | undefined;
    let portfolioAnomaly = false;
    const readThisRun = new Set<string>();
    const runner = new SisterStreetRun(tabs.sisterPage, {
      acquireOwners: true, includeAllOwners: true, expandAllOwners: options.expandOwnerProperties, expandCoOwners: true,
      // The street inventory includes dwellings and category C (e.g. garages).
      filters: prior?.runSettings?.filters ?? prior?.filters ?? filters ?? { residentialOnly: false },
      strategy: "bulk_exact_variants", prepareSearchAutomatically: true, keepAcquisition: true,
      // Live is SISTER acquisition here, never a CRM write or a stable worker job.
      mode: "live", importJobId: runId, isCancelled: paused, onCheckpoint: save,
      reuseProperty: async (property, portfolio) => {
        if (!this.store || property.municipality.trim().toUpperCase() !== "BITONTO") return false;
        const row = sisterSource(property, [], runId);
        let key: string; try { key = unitKey(row); } catch { return false; }
        if (!options.reuseAcquiredProperties && !readThisRun.has(key)) return false;
        const state = this.store.read();
        const source = reusableSisterSource(state, row);
        if (!source) return false;
        // Enabling portfolios on a street previously read without them must
        // still visit its owners, even though the property's own data is known.
        if (!portfolio && options.expandOwnerProperties && !latest(state.units[key]!).portfoliosExpanded) return false;
        await sink(source, { portfolio, reused: true, ownersComplete: true }); return true;
      },
      onExpandedPropertyAcquired: options.expandOwnerProperties ? async (property, owners, error) => {
        if (property.municipality.trim().toUpperCase() !== "BITONTO") return;
        const source = sisterSource(property, owners, runId, contacts);
        if (error) source.acquisitionError = error;
        const problem = sourceProblem(source);
        if (problem) portfolioAnomaly = true;
        await sink(source, { portfolio: true, ownersComplete: !error && owners.length > 0 });
        if (!problem) readThisRun.add(unitKey(source));
      } : undefined,
      onPropertyAcquired: async (_variant, property, owners) => {
        if (property.municipality.trim().toUpperCase() !== "BITONTO") throw new Error("Risultato SISTER fuori dal Comune di Bitonto");
        const source = sisterSource(property, owners, runId, contacts);
        await sink(source, { ownersComplete: owners.length > 0, portfoliosExpanded: options.expandOwnerProperties && !portfolioAnomaly });
        if (!sourceProblem(source)) readThisRun.add(unitKey(source));
      },
    });
    const result = await runner.run(street.sisterName, prior && hasRetryableAcquisitionRecords(prior) ? prepareStreetAcquisitionRetry(prior) : prior);
    return result.status === "completed" && !result.lastError;
  }
}
