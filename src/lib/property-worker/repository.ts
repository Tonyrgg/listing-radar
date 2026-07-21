import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  PropertyWorkerChangeLog,
  PropertyWorkerDashboardData,
  PropertyWorkerJob,
  PropertyWorkerOwnership,
  PropertyWorkerPerson,
  PropertyWorkerProperty,
  PropertyWorkerStep,
} from "@/lib/property-worker/types";

type Row = Record<string, unknown>;

const stringArray = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const text = (value: unknown) => typeof value === "string" ? value : null;
const number = (value: unknown) => typeof value === "number" ? value : Number(value ?? 0);

function mapJob(row: Row): PropertyWorkerJob {
  return {
    id: String(row.id), mode: row.mode === "automatic" ? "automatic" : "assisted",
    status: String(row.status), currentStep: String(row.current_step), lastCompletedStep: text(row.last_completed_step),
    municipality: text(row.municipality), street: text(row.street), civicNumber: text(row.civic_number),
    sisterSourceUrl: text(row.sister_source_url), totalProperties: number(row.total_properties),
    processedProperties: number(row.processed_properties), totalPeople: number(row.total_people),
    processedPeople: number(row.processed_people), errorMessage: text(row.error_message),
    errorDetails: row.error_details && typeof row.error_details === "object" ? row.error_details as Record<string, unknown> : null,
    startedAt: text(row.started_at), updatedAt: String(row.updated_at), completedAt: text(row.completed_at), createdAt: String(row.created_at),
  };
}

function mapProperty(row: Row): PropertyWorkerProperty {
  return {
    id: String(row.id), cadastralKey: String(row.cadastral_key), address: text(row.address), category: text(row.category),
    class: text(row.class), consistency: text(row.consistency), cadastralIncome: row.cadastral_income == null ? null : number(row.cadastral_income),
    processingStatus: String(row.processing_status), crmRecordId: text(row.crm_record_id),
  };
}

function mapPerson(row: Row): PropertyWorkerPerson {
  return {
    id: String(row.id), fullName: String(row.full_name), taxCode: text(row.tax_code), birthPlace: text(row.birth_place),
    birthDate: text(row.birth_date), rightType: text(row.right_type), sharePercentage: row.share_percentage == null ? null : number(row.share_percentage),
    mobiles: stringArray(row.mobiles), landlines: stringArray(row.landlines), emails: stringArray(row.emails),
    processingStatus: String(row.processing_status), crmRecordId: text(row.crm_record_id),
  };
}

function mapOwnership(row: Row): PropertyWorkerOwnership {
  return { id: String(row.id), propertyId: String(row.property_id), personId: String(row.person_id), rightType: String(row.right_type), sharePercentage: row.share_percentage == null ? null : number(row.share_percentage), processingStatus: String(row.processing_status) };
}

function mapStep(row: Row): PropertyWorkerStep {
  return { id: String(row.id), stepName: String(row.step_name), status: String(row.status), errorMessage: text(row.error_message), screenshotPath: text(row.screenshot_path), startedAt: String(row.started_at), completedAt: text(row.completed_at) };
}

function mapChange(row: Row): PropertyWorkerChangeLog {
  return { id: String(row.id), entityType: String(row.entity_type), entityIdentifier: String(row.entity_identifier), fieldName: String(row.field_name), oldValue: text(row.old_value), newValue: text(row.new_value), source: String(row.source), createdAt: String(row.created_at) };
}

export async function getPropertyWorkerDashboard(selectedJobId?: string): Promise<PropertyWorkerDashboardData> {
  const fallback: PropertyWorkerDashboardData = { available: false, errorMessage: null, jobs: [], selectedJob: null, properties: [], people: [], ownerships: [], steps: [], changeLogs: [] };
  try {
    const supabase = await getSupabaseServerClient();
    const { data: jobRows, error } = await supabase.from("property_worker_jobs").select("*").order("updated_at", { ascending: false }).limit(100);
    if (error) return { ...fallback, errorMessage: "Applica la migration 003_property_worker.sql per attivare il modulo." };
    const jobs = (jobRows as Row[]).map(mapJob);
    const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null;
    if (!selectedJob) return { ...fallback, available: true, jobs };
    const [propertiesResult, peopleResult, stepsResult, logsResult] = await Promise.all([
      supabase.from("property_worker_properties").select("*").eq("job_id", selectedJob.id).order("created_at"),
      supabase.from("property_worker_people").select("*").eq("job_id", selectedJob.id).order("created_at"),
      supabase.from("property_worker_steps").select("*").eq("job_id", selectedJob.id).order("created_at", { ascending: false }),
      supabase.from("property_worker_change_logs").select("*").eq("job_id", selectedJob.id).order("created_at", { ascending: false }),
    ]);
    const properties = ((propertiesResult.data ?? []) as Row[]).map(mapProperty);
    const propertyIds = properties.map((property) => property.id);
    const ownershipsResult = propertyIds.length
      ? await supabase.from("property_worker_ownerships").select("*").in("property_id", propertyIds)
      : { data: [] as Row[], error: null };
    return {
      available: true, errorMessage: null, jobs, selectedJob, properties,
      people: ((peopleResult.data ?? []) as Row[]).map(mapPerson),
      ownerships: ((ownershipsResult.data ?? []) as Row[]).map(mapOwnership),
      steps: ((stepsResult.data ?? []) as Row[]).map(mapStep),
      changeLogs: ((logsResult.data ?? []) as Row[]).map(mapChange),
    };
  } catch {
    return { ...fallback, errorMessage: "Supabase non è configurato o non è raggiungibile." };
  }
}

