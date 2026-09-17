import type { JobRow } from "./repository.js";

export const COMPLETED_WORK_REFINEMENT_ORIGIN = "completed_lavorazione" as const;

export function refinementSourceJobId(job: Pick<JobRow, "acquisition">): string | null {
  const value = job.acquisition?.refinementSourceJobId;
  return typeof value === "string" && value.trim() ? value : null;
}

export function isCompletedWorkRefinementSeed(job: Pick<JobRow, "acquisition">): boolean {
  return job.acquisition?.refinementOrigin === COMPLETED_WORK_REFINEMENT_ORIGIN
    && Boolean(refinementSourceJobId(job));
}

export function canCreateCompletedWorkRefinement(job: JobRow): boolean {
  const engine = job.acquisition?.engine;
  const strategy = job.acquisition?.strategy;
  return job.status === "completed"
    && engine !== "rifinitura"
    && strategy !== "street_refinement"
    && Boolean(job.street?.trim())
    && !job.civic_number;
}

export function completedWorkRefinementPayload(source: JobRow, createdAt = new Date().toISOString()) {
  if (!canCreateCompletedWorkRefinement(source)) {
    throw new Error("La lavorazione non è una via completata trasformabile in rifinitura");
  }
  const street = source.street!.replace(/\s+/g, " ").trim();
  return {
    mode: source.mode,
    status: "saved",
    current_step: "ready",
    last_completed_step: null,
    municipality: source.municipality ?? "BITONTO",
    street,
    civic_number: null,
    sister_source_url: source.sister_source_url ?? "",
    total_properties: 0,
    processed_properties: 0,
    total_people: 0,
    processed_people: 0,
    saved_at: createdAt,
    import_started_at: null,
    error_message: null,
    error_details: null,
    acquisition: {
      engine: "rifinitura",
      strategy: "street_refinement",
      refinementOrigin: COMPLETED_WORK_REFINEMENT_ORIGIN,
      refinementSourceJobId: source.id,
      refinementSourceCompletedAt: source.completed_at ?? source.updated_at ?? createdAt,
      sourceSummary: {
        properties: Number(source.total_properties ?? 0),
        people: Number(source.total_people ?? 0),
      },
      street,
      refinementCloudStreet: street,
      runSettings: {
        lockedAt: createdAt,
        engine: "rifinitura",
        street,
        refinementCloudStreet: street,
        filters: { residentialOnly: false },
        expandAllOwners: false,
        keepAcquisition: true,
      },
      importOptions: {
        activityMode: "plain",
        importCoOwners: true,
        parallelCrmWindows: false,
        lockedAt: createdAt,
      },
    },
  };
}
