import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildCadastralKey } from "../core/normalize.js";
import type { CadastralOwner, CadastralProperty, ContactMatchResult, ErrorStatus, WorkflowStep, WorkerMode } from "../types.js";

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

export class WorkerRepository {
  readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async healthCheck() {
    const { error } = await this.client.from("property_worker_jobs").select("id", { head: true, count: "exact" });
    if (error) throw new Error(`Supabase non disponibile o migration mancante: ${error.message}`);
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

  async listSavedJobs(limit = 50): Promise<JobRow[]> {
    const { data, error } = await this.client
      .from("property_worker_jobs")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Lettura archivio acquisizioni fallita: ${error.message}`);
    return (data as JobRow[]).filter((job) => Boolean(job.saved_at));
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
      const { data, error } = await this.client.from("property_worker_properties").upsert(payload, { onConflict: "job_id,municipality,sheet,parcel,subaltern" }).select("*").single();
      if (error) throw new Error(`Salvataggio immobile fallito: ${error.message}`);
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

  async logChange(jobId: string, entityType: string, identifier: string, field: string, oldValue: unknown, newValue: unknown) {
    if (String(oldValue ?? "") === String(newValue ?? "")) return;
    await this.client.from("property_worker_change_logs").insert({ job_id: jobId, entity_type: entityType, entity_identifier: identifier, field_name: field, old_value: oldValue == null ? null : String(oldValue), new_value: newValue == null ? null : String(newValue) });
  }
}
