import { randomUUID } from "node:crypto";
import { connectToChrome, type ChromeTabs } from "../services/chrome.js";
import { SisterStreetRun, hasRetryableAcquisitionRecords, prepareStreetAcquisitionRetry, type SisterStreetRunCheckpoint } from "../services/sister-street-run.js";
import { TecnocloudUiV2Port } from "../import-v2/tecnocloud-ui-port.js";
import { buildPlan } from "../import-v2/identity.js";
import { ExcelContactsAdapter } from "../adapters/excel/index.js";
import { isBusinessOwner } from "../core/owner-kind.js";
import type { SourceProperty, CrmPropertySummary } from "../import-v2/model.js";
import { unitKey, type Street } from "./model.js";
import type { ScanSink, TerritoryProvider } from "./providers.js";
import type { StreetPropertyFilters } from "../core/network-exploration.js";

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
  private config: LiveConfig;
  private comparing = false;
  private inventory = new Map<string, Promise<CrmPropertySummary[]>>();
  constructor(config: LiveConfig, private readonly paused: () => boolean, private readonly workBrowser?: LiveBrowserConfig) { this.config = validateLiveConfig(config, workBrowser); }
  configure(config: LiveConfig) { this.config = validateLiveConfig(config, this.workBrowser); this.endOperation(); }
  beginOperation(operation: "scan" | "compare" | "apply") { this.inventory.clear(); this.comparing = operation === "compare"; }
  endOperation() {
    this.inventory.clear(); this.comparing = false;
    const connection = this.tabsPromise; this.tabsPromise = null;
    void connection?.then(tabs => tabs.browser.close()).catch(() => undefined);
  }
  private tabs() { return this.tabsPromise ??= connectToChrome(this.config.cdpUrl, this.config.sisterTabMatch, this.config.crmTabMatch).catch(error => { this.tabsPromise = null; throw error; }); }
  canWrite(key: string, source?: SourceProperty) { return this.config.allowedCadastralKeys.includes(key) && Boolean(source && source.owners.length && source.owners.every(owner => this.config.allowedTaxCodes.includes(owner.taxCode.trim().toUpperCase()))); }
  authorizeWrite(source: SourceProperty, kind: "create" | "update") {
    if (source.municipality.trim().toUpperCase() !== "BITONTO" || !this.canWrite(unitKey(source), source)) throw new Error("Immobile o intestatari fuori dalle schede concordate");
    if (kind === "create" && !this.config.allowCreate) throw new Error("Il collaudo concordato ammette solo aggiornamenti di schede esistenti");
  }
  async port() { return new TecnocloudUiV2Port((await this.tabs()).crmPage, false, { isInterruptionRequested: this.paused }); }
  async candidates(street: Street, source: SourceProperty) {
    const port = await this.port();
    await port.assertSession();
    let reading = this.comparing ? this.inventory.get(street.id) : undefined;
    if (!reading) {
      reading = port.listPropertiesByStreet(street.name);
      if (this.comparing) this.inventory.set(street.id, reading);
    }
    // A failed inventory stays failed for this comparison, never becomes an absence.
    // Applies and subsequent runs always read again; no cache crosses a run.
    const byStreet = await reading;
    const byCadastre = await port.findPropertiesByCadastralIdentity(buildPlan(source));
    return { rows: [...byStreet, ...byCadastre], complete: true };
  }
  async scan(street: Street, runId: string, checkpoint: unknown, sink: ScanSink, save: (checkpoint: unknown) => Promise<void>, paused: () => boolean, filters?: StreetPropertyFilters) {
    if (street.needsReview) throw new Error("Via ufficiale da verificare prima dell'acquisizione");
    const tabs = await this.tabs();
    let contacts: ExcelContactsAdapter | null = null;
    if (this.config.contactsExcelPath) { contacts = new ExcelContactsAdapter(this.config.contactsExcelPath); await contacts.load(); }
    const prior = checkpoint as SisterStreetRunCheckpoint | undefined;
    const runner = new SisterStreetRun(tabs.sisterPage, {
      acquireOwners: true, includeAllOwners: true, expandAllOwners: false,
      // The street inventory includes dwellings and category C (e.g. garages).
      filters: prior?.runSettings?.filters ?? prior?.filters ?? filters ?? { residentialOnly: false },
      strategy: "bulk_exact_variants", prepareSearchAutomatically: true, keepAcquisition: true,
      // Live is SISTER acquisition here, never a CRM write or a stable worker job.
      mode: "live", importJobId: runId, isCancelled: paused, onCheckpoint: save,
      onPropertyAcquired: async (_variant, property, owners) => {
        if (property.municipality.trim().toUpperCase() !== "BITONTO") throw new Error("Risultato SISTER fuori dal Comune di Bitonto");
        const rawCells = property.rawPayload.rawCells as Record<string, unknown> | undefined;
        const raw = (...keys: string[]) => keys.map(key => rawCells?.[key] ?? property.rawPayload[key]).find(value => typeof value === "string" && value.trim()) as string | undefined;
        const source: SourceProperty = { sourcePropertyId: randomUUID(), jobId: runId, municipality: "BITONTO", fullAddress: property.address ?? "", cadastral: { urbanSection: raw("urbanSection", "sezioneUrbana", "sezione")?.trim() ?? null, sheet: property.sheet, parcel: property.parcel, parcelDenomination: raw("parcelDenomination", "denomParticella")?.trim() ?? null, subaltern: property.subaltern, income: property.cadastralIncome }, category: property.category, propertyClass: property.class, consistency: property.consistency, hasBusinessOwners: owners.some(owner => isBusinessOwner(owner.fullName, owner.taxCode)), activity: { enabled: false, description: null, contactMode: "Telefonata", status: "Da eseguire" }, owners: owners.map(owner => { const match = contacts?.findByTaxCode(owner.taxCode ?? ""); return { sourcePersonId: randomUUID(), taxCode: owner.taxCode ?? "", fullName: owner.fullName, birthDate: owner.birthDate, birthPlace: owner.birthPlace, birthProvince: owner.birthProvince, rightType: owner.rightType, sharePercentage: owner.sharePercentage, contacts: { phones: [...(match?.mobiles ?? []), ...(match?.landlines ?? [])], emails: match?.emails ?? [] } }; }) };
        await sink(source);
      },
    });
    const result = await runner.run(street.sisterName, prior && hasRetryableAcquisitionRecords(prior) ? prepareStreetAcquisitionRetry(prior) : prior);
    return result.status === "completed" && !result.lastError && result.totalSkippedPropertyRows === 0;
  }
}
