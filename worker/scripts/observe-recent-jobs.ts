import { loadConfig } from "../src/config.js";
import { WorkerRepository } from "../src/services/repository.js";

const config = loadConfig();
const repository = new WorkerRepository(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
const jobs = await repository.listJobs(12);
process.stdout.write(JSON.stringify(jobs.map((job) => ({
  id: job.id,
  mode: job.mode,
  status: job.status,
  currentStep: job.current_step,
  lastCompletedStep: job.last_completed_step,
  propertyCount: job.property_count,
  updatedAt: job.updated_at,
  createdAt: job.created_at,
})), null, 2));
