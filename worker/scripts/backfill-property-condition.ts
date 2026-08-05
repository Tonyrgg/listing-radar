import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeCrmMandate, type CrmMandateDetail } from "../src/adapters/crm/mandates.js";
import { loadConfig } from "../src/config.js";
import { WorkerRepository } from "../src/services/repository.js";

const config = loadConfig();
const repository = new WorkerRepository(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
const { data: properties, error } = await repository.client.from("portfolio_properties")
  .select("id,condition,description,raw_payload")
  .order("created_at", { ascending: true });
if (error) throw new Error(`Lettura incarichi fallita: ${error.message}`);

const backupDirectory = path.resolve("..", ".backups");
const backupPath = path.join(backupDirectory, "portfolio-property-state-before-2026-08-05.json");
await mkdir(backupDirectory, { recursive: true });
await writeFile(backupPath, JSON.stringify({ capturedAt: new Date().toISOString(), properties }, null, 2), "utf8");

const summary = { total: properties?.length ?? 0, updated: 0, descriptions: 0, conditions: {} as Record<string, number> };
for (const property of properties ?? []) {
  const raw = property.raw_payload as CrmMandateDetail | null;
  if (!raw?.fields || !raw.mandateExternalId) continue;
  const normalized = normalizeCrmMandate(raw);
  const condition = typeof normalized.condition === "string" ? normalized.condition : property.condition;
  const description = typeof normalized.description === "string" && normalized.description.trim()
    ? normalized.description
    : property.description;
  const { error: updateError } = await repository.client.from("portfolio_properties").update({ condition, description }).eq("id", property.id);
  if (updateError) throw new Error(`Aggiornamento stato incarico fallito: ${updateError.message}`);
  summary.updated += 1;
  if (description) summary.descriptions += 1;
  const conditionKey = condition ?? "missing";
  summary.conditions[conditionKey] = (summary.conditions[conditionKey] ?? 0) + 1;
}

console.log(JSON.stringify({ ...summary, backupPath }, null, 2));
