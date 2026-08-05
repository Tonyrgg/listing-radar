import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildCadastralKey } from "../core/normalize.js";
import { normalizeCrmMandate, type CrmMandateArchiveItem, type CrmMandateDetail } from "../adapters/crm/mandates.js";
import type { CrmRequestArchiveItem, CrmRequestDetail } from "../adapters/crm/requests.js";
import type { CadastralOwner, CadastralProperty, ContactMatchResult, ErrorStatus, WorkflowStep, WorkerMode } from "../types.js";
import {
  cleanImportedPropertyAddress,
  NominatimPropertyGeocoder,
  parsePropertyAddress,
  resolvePropertyLocation,
  type PropertyLocationResolution,
  type PropertyLocationZone,
} from "./property-location.js";

export type JobRow = {
  id: string;
  mode: WorkerMode;
  status: string;
  current_step: WorkflowStep;
  last_completed_step: WorkflowStep | null;
  municipality: string | null;
  street: string | null;
  civic_number: string | null;
  sister_source_url: string | null;
  total_properties?: number;
  processed_properties?: number;
  total_people?: number;
  processed_people?: number;
  error_message?: string | null;
  error_details?: Record<string, unknown> | null;
  started_at?: string | null;
  updated_at?: string;
  completed_at?: string | null;
  saved_at?: string | null;
  import_started_at?: string | null;
  created_at?: string;
};

export type PropertyRow = {
  id: string;
  job_id: string;
  municipality: string;
  sheet: string;
  parcel: string;
  subaltern: string;
  cadastral_key: string;
  address: string | null;
  census_zone: string | null;
  category: string;
  class: string | null;
  consistency: string | null;
  cadastral_income: number | null;
  raw_payload: Record<string, unknown> | null;
  processing_status: string;
  crm_record_id: string | null;
};

export type PersonRow = {
  id: string;
  job_id: string;
  full_name: string;
  birth_place: string | null;
  birth_province: string | null;
  birth_date: string | null;
  tax_code: string | null;
  right_type: string;
  share_original: string;
  share_numerator: number | null;
  share_denominator: number | null;
  share_percentage: number | null;
  mobiles: string[];
  landlines: string[];
  emails: string[];
  raw_payload: Record<string, unknown> | null;
  processing_status: string;
  crm_record_id: string | null;
};

export type CrmRequestImportRunRow = {
  id: string;
  status: "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
  source_url: string;
  total_requests: number;
  processed_requests: number;
  failed_requests: number;
  current_external_id: string | null;
  current_title: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
};

export type CrmRequestImportItemRow = {
  id: string;
  run_id: string;
  external_crm_id: string;
  source_url: string;
  title: string | null;
  status: "pending" | "running" | "completed" | "failed";
  list_payload: CrmRequestArchiveItem | Record<string, unknown>;
  detail_payload: CrmRequestDetail | null;
  imported_request_id: string | null;
  error_message: string | null;
  attempts: number;
};

export type CrmMandateImportRunRow = {
  id: string;
  status: "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
  source_url: string;
  total_mandates: number;
  processed_mandates: number;
  failed_mandates: number;
  current_external_id: string | null;
  current_title: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
};

export type CrmMandateImportItemRow = {
  id: string;
  run_id: string;
  external_crm_id: string;
  source_url: string;
  title: string | null;
  status: "pending" | "running" | "completed" | "failed";
  list_payload: CrmMandateArchiveItem | Record<string, unknown>;
  detail_payload: CrmMandateDetail | null;
  imported_property_id: string | null;
  error_message: string | null;
  attempts: number;
};

export class WorkerRepository {
  readonly client: SupabaseClient;
  private readonly propertyGeocoder = new NominatimPropertyGeocoder();

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async healthCheck() {
    const { error } = await this.client
      .from("property_worker_jobs")
      .select("id,saved_at,import_started_at", { head: true, count: "exact" });
    if (error) {
      throw new Error(
        `Supabase non pronto: applica la migration 006_property_worker_archives.sql prima di avviare il worker. ${error.message}`,
      );
    }
  }

  async createJob(mode: WorkerMode): Promise<JobRow> {
    const { data, error } = await this.client.from("property_worker_jobs").insert({ mode, status: "ready", current_step: "ready" }).select("*").single();
    if (error) throw new Error(`Creazione job fallita: ${error.message}`);
    return data as JobRow;
  }

  async findReadyJob(mode: WorkerMode): Promise<JobRow | null> {
    const { data, error } = await this.client.from("property_worker_jobs").select("*").eq("mode", mode).eq("status", "ready").order("created_at").limit(1).maybeSingle();
    if (error) throw new Error(`Lettura coda fallita: ${error.message}`);
    return data as JobRow | null;
  }

  async getJob(id: string): Promise<JobRow> {
    const { data, error } = await this.client.from("property_worker_jobs").select("*").eq("id", id).single();
    if (error) throw new Error(`Job ${id} non trovato: ${error.message}`);
    return data as JobRow;
  }

  async listJobs(limit = 30): Promise<JobRow[]> {
    const { data, error } = await this.client
      .from("property_worker_jobs")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Lettura lavorazioni fallita: ${error.message}`);
    return data as JobRow[];
  }

  async requestArchiveHealthCheck() {
    const { error } = await this.client.from("crm_request_import_runs").select("id", { head: true, count: "exact" });
    if (error) throw new Error(`Archivio richieste non pronto: applica la migration 008_crm_request_archive_import.sql. ${error.message}`);
  }

  async createRequestImportRun(sourceUrl: string): Promise<CrmRequestImportRunRow> {
    const { data, error } = await this.client.from("crm_request_import_runs")
      .insert({ source_url: sourceUrl, status: "running" }).select("*").single();
    if (error) throw new Error(`Avvio sincronizzazione richieste fallito: ${error.message}`);
    return data as CrmRequestImportRunRow;
  }

  async latestRequestImportRun(): Promise<CrmRequestImportRunRow | null> {
    const { data, error } = await this.client.from("crm_request_import_runs")
      .select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`Lettura sincronizzazioni richieste fallita: ${error.message}`);
    return data as CrmRequestImportRunRow | null;
  }

  async latestResumableRequestImportRun(): Promise<CrmRequestImportRunRow | null> {
    const { data, error } = await this.client.from("crm_request_import_runs")
      .select("*").in("status", ["running", "failed", "cancelled", "completed_with_errors"])
      .gt("total_requests", 0).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`Lettura sincronizzazione riprendibile fallita: ${error.message}`);
    return data as CrmRequestImportRunRow | null;
  }

  async updateRequestImportRun(runId: string, values: Record<string, unknown>) {
    const { error } = await this.client.from("crm_request_import_runs").update(values).eq("id", runId);
    if (error) throw new Error(`Aggiornamento sincronizzazione richieste fallito: ${error.message}`);
  }

  async saveRequestImportItems(runId: string, items: CrmRequestArchiveItem[]) {
    if (!items.length) return;
    const { error } = await this.client.from("crm_request_import_items").upsert(items.map((item) => ({
      run_id: runId,
      external_crm_id: item.externalId,
      source_url: item.url,
      title: item.title,
      list_payload: item,
      status: "pending",
    })), { onConflict: "run_id,external_crm_id", ignoreDuplicates: true });
    if (error) throw new Error(`Salvataggio indice richieste fallito: ${error.message}`);
    await this.updateRequestImportRun(runId, { total_requests: items.length });
  }

  async listRequestImportItems(runId: string): Promise<CrmRequestImportItemRow[]> {
    const { data, error } = await this.client.from("crm_request_import_items")
      .select("*").eq("run_id", runId).order("created_at", { ascending: true });
    if (error) throw new Error(`Lettura richieste da sincronizzare fallita: ${error.message}`);
    return data as CrmRequestImportItemRow[];
  }

  async markRequestImportItem(itemId: string, values: Record<string, unknown>) {
    const { error } = await this.client.from("crm_request_import_items").update(values).eq("id", itemId);
    if (error) throw new Error(`Aggiornamento richiesta importata fallito: ${error.message}`);
  }

  async saveArchivedCrmRequest(
    itemId: string,
    detail: CrmRequestDetail,
    normalized: { client: Record<string, unknown>; request: Record<string, unknown> | null },
  ): Promise<string | null> {
    await this.markRequestImportItem(itemId, { detail_payload: detail });
    if (!normalized.request) return null;

    let clientId: string | null = null;
    const clientExternalId = normalized.client.external_crm_id;
    if (typeof clientExternalId === "string" && clientExternalId) {
      const existing = await this.client.from("clients").select("id,raw_payload").eq("external_crm_id", clientExternalId).limit(1).maybeSingle();
      if (existing.error) throw new Error(`Ricerca cliente CRM fallita: ${existing.error.message}`);
      const clientPayload = {
        ...Object.fromEntries(Object.entries(normalized.client).filter(([key, value]) => key === "raw_payload" || value !== null && value !== "")),
        raw_payload: { ...((existing.data?.raw_payload as Record<string, unknown> | null) ?? {}), ...(normalized.client.raw_payload as Record<string, unknown> ?? {}) },
      };
      const mutation = existing.data
        ? await this.client.from("clients").update(clientPayload).eq("id", existing.data.id).select("id").single()
        : await this.client.from("clients").insert(clientPayload).select("id").single();
      if (mutation.error) throw new Error(`Salvataggio cliente CRM fallito: ${mutation.error.message}`);
      clientId = String(mutation.data.id);
    }

    const externalId = String(normalized.request.external_crm_id);
    const existingRequest = await this.client.from("property_requests").select("id,client_id,raw_payload")
      .eq("external_crm_id", externalId).limit(1).maybeSingle();
    if (existingRequest.error) throw new Error(`Ricerca richiesta CRM fallita: ${existingRequest.error.message}`);
    const requestPayload = {
      ...normalized.request,
      client_id: clientId ?? existingRequest.data?.client_id ?? null,
      raw_payload: { ...((existingRequest.data?.raw_payload as Record<string, unknown> | null) ?? {}), ...(normalized.request.raw_payload as Record<string, unknown> ?? {}) },
    };
    const mutation = existingRequest.data
      ? await this.client.from("property_requests").update(requestPayload).eq("id", existingRequest.data.id).select("id").single()
      : await this.client.from("property_requests").insert(requestPayload).select("id").single();
    if (mutation.error) throw new Error(`Salvataggio richiesta CRM fallito: ${mutation.error.message}`);
    return String(mutation.data.id);
  }

  async mandateArchiveHealthCheck() {
    const { error } = await this.client.from("crm_mandate_import_runs").select("id", { head: true, count: "exact" });
    if (error) throw new Error(`Archivio incarichi non pronto: applica la migration 011_crm_mandate_archive_import.sql. ${error.message}`);
  }

  async createMandateImportRun(sourceUrl: string): Promise<CrmMandateImportRunRow> {
    const { data, error } = await this.client.from("crm_mandate_import_runs")
      .insert({ source_url: sourceUrl, status: "running" }).select("*").single();
    if (error) throw new Error(`Avvio sincronizzazione incarichi fallito: ${error.message}`);
    return data as CrmMandateImportRunRow;
  }

  async latestMandateImportRun(): Promise<CrmMandateImportRunRow | null> {
    const { data, error } = await this.client.from("crm_mandate_import_runs")
      .select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`Lettura sincronizzazioni incarichi fallita: ${error.message}`);
    return data as CrmMandateImportRunRow | null;
  }

  async latestResumableMandateImportRun(): Promise<CrmMandateImportRunRow | null> {
    const { data, error } = await this.client.from("crm_mandate_import_runs")
      .select("*").in("status", ["running", "failed", "cancelled", "completed_with_errors"])
      .gt("total_mandates", 0).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`Lettura sincronizzazione incarichi riprendibile fallita: ${error.message}`);
    return data as CrmMandateImportRunRow | null;
  }

  async updateMandateImportRun(runId: string, values: Record<string, unknown>) {
    const { error } = await this.client.from("crm_mandate_import_runs").update(values).eq("id", runId);
    if (error) throw new Error(`Aggiornamento sincronizzazione incarichi fallito: ${error.message}`);
  }

  async saveMandateImportItems(runId: string, items: CrmMandateArchiveItem[]) {
    if (!items.length) return;
    const { error } = await this.client.from("crm_mandate_import_items").upsert(items.map((item) => ({
      run_id: runId,
      external_crm_id: item.externalId,
      source_url: item.url,
      title: item.title,
      list_payload: item,
      status: "pending",
    })), { onConflict: "run_id,external_crm_id", ignoreDuplicates: true });
    if (error) throw new Error(`Salvataggio indice incarichi fallito: ${error.message}`);
    await this.updateMandateImportRun(runId, { total_mandates: items.length });
  }

  async listMandateImportItems(runId: string): Promise<CrmMandateImportItemRow[]> {
    const { data, error } = await this.client.from("crm_mandate_import_items")
      .select("*").eq("run_id", runId).order("created_at", { ascending: true });
    if (error) throw new Error(`Lettura incarichi da sincronizzare fallita: ${error.message}`);
    return data as CrmMandateImportItemRow[];
  }

  async markMandateImportItem(itemId: string, values: Record<string, unknown>) {
    const { error } = await this.client.from("crm_mandate_import_items").update(values).eq("id", itemId);
    if (error) throw new Error(`Aggiornamento incarico importato fallito: ${error.message}`);
  }

  async saveArchivedCrmMandate(
    itemId: string,
    detail: CrmMandateDetail,
    normalized: Record<string, unknown>,
  ): Promise<string> {
    await this.markMandateImportItem(itemId, { detail_payload: detail });
    const propertyExternalId = String(normalized.external_crm_id);
    const mandateExternalId = String(normalized.external_mandate_id);
    let existing = await this.client.from("portfolio_properties").select("id,address,municipality,latitude,longitude,raw_payload,internal_zone_id")
      .eq("external_crm_id", propertyExternalId).limit(1).maybeSingle();
    if (existing.error) throw new Error(`Ricerca immobile CRM fallita: ${existing.error.message}`);
    if (!existing.data) {
      existing = await this.client.from("portfolio_properties").select("id,address,municipality,latitude,longitude,raw_payload,internal_zone_id")
        .eq("external_mandate_id", mandateExternalId).limit(1).maybeSingle();
      if (existing.error) throw new Error(`Ricerca incarico CRM fallita: ${existing.error.message}`);
    }
    let internalZoneId = existing.data?.internal_zone_id ?? null;
    const previousRaw = (existing.data?.raw_payload as Record<string, unknown> | null) ?? {};
    const address = typeof normalized.address === "string" ? normalized.address : existing.data?.address ?? null;
    const municipality = typeof normalized.municipality === "string" ? normalized.municipality : existing.data?.municipality ?? "Bitonto";
    const zones = await this.listPropertyLocationZones();
    const cachedResolution = this.cachedLocationResolution(previousRaw, address, municipality);
    const locationResolution = cachedResolution ?? await resolvePropertyLocation({
      address,
      municipality,
      latitude: existing.data?.latitude == null ? null : Number(existing.data.latitude),
      longitude: existing.data?.longitude == null ? null : Number(existing.data.longitude),
    }, zones, this.propertyGeocoder);
    internalZoneId ??= locationResolution.zone_id;
    const payload = {
      ...Object.fromEntries(Object.entries(normalized).filter(([key, value]) => key !== "crm_zone_name" && (key === "raw_payload" || key === "image_urls" || value !== null && value !== ""))),
      ...(internalZoneId ? { internal_zone_id: internalZoneId } : {}),
      ...(locationResolution.latitude != null && locationResolution.longitude != null ? {
        latitude: locationResolution.latitude,
        longitude: locationResolution.longitude,
      } : {}),
      raw_payload: {
        ...previousRaw,
        ...(normalized.raw_payload as Record<string, unknown> ?? {}),
        _location_resolution: locationResolution,
      },
    };
    const mutation = existing.data
      ? await this.client.from("portfolio_properties").update(payload).eq("id", existing.data.id).select("id").single()
      : await this.client.from("portfolio_properties").insert(payload).select("id").single();
    if (mutation.error) throw new Error(`Salvataggio immobile CRM fallito: ${mutation.error.message}`);
    return String(mutation.data.id);
  }

  private async listPropertyLocationZones(): Promise<PropertyLocationZone[]> {
    const { data, error } = await this.client.from("internal_zones")
      .select("id,zone_number,name,geometry,associated_streets")
      .eq("is_active", true)
      .not("zone_number", "is", null)
      .not("geometry", "is", null)
      .order("zone_number", { ascending: true });
    if (error) throw new Error(`Lettura perimetri immobiliari fallita: ${error.message}`);
    return (data ?? []) as PropertyLocationZone[];
  }

  private cachedLocationResolution(
    rawPayload: Record<string, unknown>,
    address: string | null,
    municipality: string,
  ): PropertyLocationResolution | null {
    const candidate = rawPayload._location_resolution;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const cached = candidate as Partial<PropertyLocationResolution>;
    const current = parsePropertyAddress(address, municipality).normalizedAddress;
    if (cached.normalized_address !== current || typeof cached.status !== "string") return null;
    return cached as PropertyLocationResolution;
  }

  async backfillPortfolioPropertyLocations(
    onProgress?: (progress: { index: number; total: number; address: string | null; resolution: PropertyLocationResolution }) => void,
  ) {
    const [{ data: properties, error: propertiesError }, zones] = await Promise.all([
      this.client.from("portfolio_properties")
        .select("id,address,municipality,latitude,longitude,internal_zone_id,raw_payload")
        .order("created_at", { ascending: true }),
      this.listPropertyLocationZones(),
    ]);
    if (propertiesError) throw new Error(`Lettura incarichi fallita: ${propertiesError.message}`);

    const summary = { total: properties?.length ?? 0, resolved: 0, streetMatched: 0, outsideMunicipality: 0, outsideZones: 0, notFound: 0, errors: 0 };
    for (const [index, property] of (properties ?? []).entries()) {
      const rawPayload = (property.raw_payload as Record<string, unknown> | null) ?? {};
      let normalizedAddress = cleanImportedPropertyAddress(property.address, property.municipality ?? "Bitonto");
      if (typeof rawPayload.mandateExternalId === "string" && rawPayload.mandateExternalId) {
        const normalized = normalizeCrmMandate(rawPayload as CrmMandateDetail);
        normalizedAddress = normalized.address ?? normalizedAddress;
      }
      const resolution = await resolvePropertyLocation({
        address: normalizedAddress,
        municipality: property.municipality ?? "Bitonto",
        latitude: property.latitude == null ? null : Number(property.latitude),
        longitude: property.longitude == null ? null : Number(property.longitude),
      }, zones, this.propertyGeocoder);
      const internalZoneId = property.internal_zone_id ?? resolution.zone_id;
      const update = {
        address: normalizedAddress,
        ...(resolution.latitude != null && resolution.longitude != null ? { latitude: resolution.latitude, longitude: resolution.longitude } : {}),
        ...(internalZoneId ? { internal_zone_id: internalZoneId } : {}),
        raw_payload: { ...rawPayload, _location_resolution: resolution },
      };
      const { error } = await this.client.from("portfolio_properties").update(update).eq("id", property.id);
      if (error) throw new Error(`Aggiornamento posizione incarico fallito: ${error.message}`);

      if (resolution.status === "resolved") summary.resolved += 1;
      else if (resolution.status === "street_match") summary.streetMatched += 1;
      else if (resolution.status === "outside_municipality") summary.outsideMunicipality += 1;
      else if (resolution.status === "outside_zones") summary.outsideZones += 1;
      else if (resolution.status === "error") summary.errors += 1;
      else summary.notFound += 1;
      onProgress?.({ index: index + 1, total: summary.total, address: normalizedAddress, resolution });
    }
    return summary;
  }

  async listSavedJobs(limit = 50): Promise<JobRow[]> {
    const { data, error } = await this.client
      .from("property_worker_jobs")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Lettura archivio acquisizioni fallita: ${error.message}`);
    const recoverableStatuses = new Set([
      "saved", "running", "paused", "needs_review", "session_expired",
      "portal_error", "data_incomplete", "failed",
    ]);
    return (data as JobRow[]).filter((job) =>
      job.status !== "completed" && (Boolean(job.saved_at) || recoverableStatuses.has(job.status)),
    );
  }

  async listCompletedJobs(limit = 30): Promise<JobRow[]> {
    const { data, error } = await this.client
      .from("property_worker_jobs")
      .select("*")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Lettura import completati fallita: ${error.message}`);
    return data as JobRow[];
  }

  async saveAcquisition(jobId: string) {
    await this.updateJob(jobId, {
      status: "saved",
      saved_at: new Date().toISOString(),
      import_started_at: null,
      error_message: null,
      error_details: null,
    });
  }

  async markImportStarted(jobId: string) {
    await this.updateJob(jobId, { import_started_at: new Date().toISOString() });
  }

  async listJobScreenshotPaths(jobId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from("property_worker_steps")
      .select("screenshot_path")
      .eq("job_id", jobId);
    if (error) throw new Error(`Lettura screenshot del job fallita: ${error.message}`);
    return (data ?? [])
      .map((row) => row.screenshot_path)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
  }

  async deleteJob(jobId: string): Promise<void> {
    const { data, error } = await this.client
      .from("property_worker_jobs")
      .delete()
      .eq("id", jobId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Annullamento job fallito: ${error.message}`);
    if (!data) throw new Error(`Job ${jobId} non trovato o già eliminato`);
  }

  async setJobContext(jobId: string, context: { municipality: string; street: string | null; civicNumber: string | null; sourceUrl: string }) {
    await this.updateJob(jobId, {
      municipality: context.municipality, street: context.street, civic_number: context.civicNumber,
      sister_source_url: context.sourceUrl, started_at: new Date().toISOString(), status: "running",
      error_message: null, error_details: null,
    });
  }

  async updateJob(jobId: string, values: Record<string, unknown>) {
    const { error } = await this.client.from("property_worker_jobs").update(values).eq("id", jobId);
    if (error) throw new Error(`Aggiornamento job fallito: ${error.message}`);
  }

  async beginStep(jobId: string, step: WorkflowStep): Promise<string> {
    await this.updateJob(jobId, { current_step: step, status: "running" });
    const { data, error } = await this.client.from("property_worker_steps").insert({ job_id: jobId, step_name: step, status: "running" }).select("id").single();
    if (error) throw new Error(`Avvio step fallito: ${error.message}`);
    return String(data.id);
  }

  async completeStep(jobId: string, stepId: string, step: WorkflowStep, nextStep: WorkflowStep, output: Record<string, unknown> = {}) {
    const now = new Date().toISOString();
    const { error: stepError } = await this.client.from("property_worker_steps").update({ status: "completed", output_data: output, completed_at: now }).eq("id", stepId);
    if (stepError) throw new Error(`Completamento step fallito: ${stepError.message}`);
    await this.updateJob(jobId, {
      last_completed_step: step,
      current_step: nextStep,
      status: step === "completed" ? "completed" : "running",
      completed_at: step === "completed" ? now : null,
    });
  }

  async failStep(jobId: string, stepId: string | null, status: ErrorStatus, message: string, details: Record<string, unknown>, screenshotPath: string | null) {
    if (stepId) await this.client.from("property_worker_steps").update({ status, error_message: message, output_data: details, screenshot_path: screenshotPath, completed_at: new Date().toISOString() }).eq("id", stepId);
    await this.updateJob(jobId, { status, error_message: message, error_details: details });
  }

  async insertProperties(jobId: string, properties: CadastralProperty[]): Promise<PropertyRow[]> {
    const rows: PropertyRow[] = [];
    for (const property of properties) {
      const payload = {
        job_id: jobId, municipality: property.municipality, sheet: property.sheet,
        parcel: property.parcel, subaltern: property.subaltern, cadastral_key: buildCadastralKey(property),
        address: property.address, census_zone: property.censusZone, category: property.category,
        class: property.class, consistency: property.consistency, cadastral_income: property.cadastralIncome,
        raw_payload: property.rawPayload, processing_status: "extracted",
      };
      const { data, error } = await this.client
        .from("property_worker_properties")
        .upsert(payload, { onConflict: "job_id,municipality,sheet,parcel,subaltern" })
        .select("*")
        .single();
      if (error) {
        throw new Error(
          `Salvataggio immobile isolato per lavorazione fallito. Non verrà riutilizzato un record di un altro job. Verifica la migration 006_property_worker_archives.sql: ${error.message}`,
        );
      }
      if (data.job_id !== jobId) {
        throw new Error("Integrità archivio violata: l'immobile restituito appartiene a un'altra lavorazione.");
      }
      rows.push(data as PropertyRow);
    }
    await this.updateJob(jobId, { total_properties: rows.length });
    return rows;
  }

  async insertOwner(jobId: string, propertyId: string, owner: CadastralOwner): Promise<PersonRow> {
    let existingQuery = this.client.from("property_worker_people").select("*").eq("job_id", jobId);
    if (owner.taxCode) existingQuery = existingQuery.eq("tax_code", owner.taxCode);
    else {
      existingQuery = existingQuery.eq("full_name", owner.fullName);
      existingQuery = owner.birthDate ? existingQuery.eq("birth_date", owner.birthDate) : existingQuery.is("birth_date", null);
    }
    const { data: existing } = await existingQuery.limit(1).maybeSingle();
    let person = existing as PersonRow | null;
    if (!person) {
      const { data, error } = await this.client.from("property_worker_people").insert({
        job_id: jobId, full_name: owner.fullName, birth_place: owner.birthPlace,
        birth_province: owner.birthProvince, birth_date: owner.birthDate, tax_code: owner.taxCode,
        right_type: owner.rightType, share_original: owner.shareOriginal,
        share_numerator: owner.shareNumerator, share_denominator: owner.shareDenominator,
        share_percentage: owner.sharePercentage, raw_payload: owner.rawPayload, processing_status: "extracted",
      }).select("*").single();
      if (error) throw new Error(`Salvataggio titolare fallito: ${error.message}`);
      person = data as PersonRow;
    }
    const { error: ownershipError } = await this.client.from("property_worker_ownerships").upsert({
      property_id: propertyId, person_id: person.id, right_type: "Proprietà",
      share_percentage: owner.sharePercentage, processing_status: "extracted",
    }, { onConflict: "property_id,person_id" });
    if (ownershipError) throw new Error(`Salvataggio comproprietà fallito: ${ownershipError.message}`);
    return person;
  }

  async updateContacts(personId: string, contacts: ContactMatchResult, rawPayload: Record<string, unknown> | null) {
    const { error } = await this.client.from("property_worker_people").update({
      mobiles: contacts.mobiles, landlines: contacts.landlines, emails: contacts.emails,
      processing_status: "contacts_matched",
      raw_payload: { ...(rawPayload ?? {}), contact_match: { matchedRows: contacts.matchedRows, whatsapp: contacts.whatsapp, overflowPhones: contacts.overflowPhones, notes: contacts.notes } },
    }).eq("id", personId);
    if (error) throw new Error(`Aggiornamento recapiti fallito: ${error.message}`);
  }

  async updatePersonProcessing(personId: string, values: Record<string, unknown>) {
    const { error } = await this.client.from("property_worker_people").update(values).eq("id", personId);
    if (error) throw new Error(`Aggiornamento nominativo fallito: ${error.message}`);
  }

  async updatePropertyProcessing(propertyId: string, values: Record<string, unknown>) {
    const { error } = await this.client.from("property_worker_properties").update(values).eq("id", propertyId);
    if (error) throw new Error(`Aggiornamento immobile fallito: ${error.message}`);
  }

  async updateOwnership(ownershipId: string, values: Record<string, unknown>) {
    const { error } = await this.client.from("property_worker_ownerships").update(values).eq("id", ownershipId);
    if (error) throw new Error(`Aggiornamento collegamento fallito: ${error.message}`);
  }

  async removePropertyFromJob(jobId: string, propertyId: string) {
    const [job, graph] = await Promise.all([this.getJob(jobId), this.loadGraph(jobId)]);
    const property = graph.properties.find((row) => row.id === propertyId);
    if (!property) throw new Error("Immobile non appartenente alla lavorazione");
    const relatedPersonIds = [...new Set(graph.ownerships
      .filter((ownership) => ownership.property_id === propertyId)
      .map((ownership) => ownership.person_id))];

    const { error: propertyError } = await this.client
      .from("property_worker_properties")
      .delete()
      .eq("id", propertyId)
      .eq("job_id", jobId);
    if (propertyError) throw new Error(`Rimozione immobile fallita: ${propertyError.message}`);

    const removedPersonIds: string[] = [];
    for (const personId of relatedPersonIds) {
      const { data: remainingOwnerships, error: ownershipError } = await this.client
        .from("property_worker_ownerships")
        .select("id")
        .eq("person_id", personId)
        .limit(1);
      if (ownershipError) throw new Error(`Controllo collegamenti nominativo fallito: ${ownershipError.message}`);
      if (!remainingOwnerships?.length) {
        const { error: personError } = await this.client
          .from("property_worker_people")
          .delete()
          .eq("id", personId)
          .eq("job_id", jobId);
        if (personError) throw new Error(`Rimozione nominativo fallita: ${personError.message}`);
        removedPersonIds.push(personId);
      }
    }

    const remaining = await this.loadGraph(jobId);
    await this.updateJob(jobId, {
      total_properties: remaining.properties.length,
      total_people: remaining.people.length,
      processed_properties: Math.min(job.processed_properties ?? 0, remaining.properties.length),
      processed_people: Math.min(job.processed_people ?? 0, remaining.people.length),
    });
    return { propertyId, removedPersonIds, remainingProperties: remaining.properties.length };
  }

  async rewindLegacyPropertySearch(jobId: string) {
    const [people, properties, ownerships] = await Promise.all([
      this.client.from("property_worker_people").update({ crm_record_id: null, processing_status: "normalized" }).eq("job_id", jobId),
      this.client.from("property_worker_properties").update({ crm_record_id: null, processing_status: "normalized" }).eq("job_id", jobId),
      this.loadGraph(jobId),
    ]);
    if (people.error || properties.error) throw new Error("Impossibile preparare il job per la nuova ricerca nominativo-immobile");
    if (ownerships.ownerships.length) {
      const { error } = await this.client.from("property_worker_ownerships")
        .update({ crm_link_id: null, processing_status: "extracted" })
        .in("id", ownerships.ownerships.map((ownership) => ownership.id));
      if (error) throw new Error("Impossibile ripristinare il controllo comproprietari");
    }
    await this.updateJob(jobId, {
      current_step: "person_searched",
      last_completed_step: "data_normalized",
      status: "running",
      error_message: null,
      error_details: { migration: "person-correlated-property-flow" },
    });
  }

  async loadGraph(jobId: string) {
    const [properties, people] = await Promise.all([
      this.client.from("property_worker_properties").select("*").eq("job_id", jobId).order("created_at", { ascending: true }),
      this.client.from("property_worker_people").select("*").eq("job_id", jobId),
    ]);
    if (properties.error || people.error) throw new Error("Impossibile ricostruire il job persistito");
    const propertyRows = (properties.data as PropertyRow[]).sort((left, right) => {
      const leftOrder = Number(left.raw_payload?.sourceOrder ?? left.raw_payload?.rowIndex);
      const rightOrder = Number(right.raw_payload?.sourceOrder ?? right.raw_payload?.rowIndex);
      if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder)) return leftOrder - rightOrder;
      if (Number.isFinite(leftOrder)) return -1;
      if (Number.isFinite(rightOrder)) return 1;
      return 0;
    });
    const peopleRows = people.data as PersonRow[];
    let ownershipRows: Array<Record<string, unknown>> = [];
    if (propertyRows.length && peopleRows.length) {
      const ownerships = await this.client
        .from("property_worker_ownerships")
        .select("*")
        .in("property_id", propertyRows.map((row) => row.id))
        .in("person_id", peopleRows.map((row) => row.id));
      if (ownerships.error) throw new Error("Impossibile ricostruire le comproprietà del job persistito");
      ownershipRows = ownerships.data as Array<Record<string, unknown>>;
    }
    return {
      properties: propertyRows,
      people: peopleRows,
      ownerships: ownershipRows as Array<Record<string, unknown> & {
        id: string;
        property_id: string;
        person_id: string;
        share_percentage: number | null;
        processing_status: string;
        crm_link_id: string | null;
      }>,
    };
  }

  async logChange(jobId: string, entityType: string, identifier: string, field: string, oldValue: unknown, newValue: unknown, source = "SISTER") {
    if (String(oldValue ?? "") === String(newValue ?? "")) return;
    await this.client.from("property_worker_change_logs").insert({ job_id: jobId, entity_type: entityType, entity_identifier: identifier, field_name: field, old_value: oldValue == null ? null : String(oldValue), new_value: newValue == null ? null : String(newValue), source });
  }
}
