import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Reuse the web app's Supabase configuration, then allow worker-local overrides.
dotenv.config({ path: path.resolve(workerRoot, "..", ".env.local"), quiet: true });
dotenv.config({ path: path.resolve(workerRoot, ".env"), override: true, quiet: true });

const booleanFromEnv = z
  .string()
  .default("true")
  .transform((value) => ["1", "true", "yes", "on"].includes(value.toLowerCase()));

const optionalUrlFromEnv = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().url().optional(),
);

const configSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CHROME_CDP_URL: z.string().url().default("http://127.0.0.1:9222"),
  CONTACTS_EXCEL_PATH: z.string().min(1),
  WORKER_MODE: z.enum(["assisted", "automatic"]).default("assisted"),
  WORKER_DRY_RUN: booleanFromEnv,
  ERROR_SCREENSHOT_DIR: z.string().min(1),
  ERROR_SCREENSHOT_RETENTION_DAYS: z.coerce.number().int().min(1).default(14),
  SISTER_TAB_MATCH: z.string().min(1),
  CRM_TAB_MATCH: z.string().min(1),
  SISTER_KEEPALIVE_ENABLED: booleanFromEnv,
  SISTER_KEEPALIVE_MIN_SECONDS: z.coerce.number().int().min(30).max(3_600).default(60),
  SISTER_KEEPALIVE_MAX_SECONDS: z.coerce.number().int().min(30).max(3_600).default(90),
  SISTER_KEEPALIVE_URL: optionalUrlFromEnv,
}).superRefine((value, context) => {
  if (value.SISTER_KEEPALIVE_MAX_SECONDS < value.SISTER_KEEPALIVE_MIN_SECONDS) {
    context.addIssue({
      code: "custom",
      path: ["SISTER_KEEPALIVE_MAX_SECONDS"],
      message: "deve essere maggiore o uguale a SISTER_KEEPALIVE_MIN_SECONDS",
    });
  }
});

export type WorkerConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Configurazione worker non valida:\n- ${issues.join("\n- ")}`);
  }
  return result.data;
}
