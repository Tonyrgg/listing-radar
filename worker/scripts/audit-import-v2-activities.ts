import { loadConfig } from "../src/config.js";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";
import type { ImportV2Checkpoint, ImportV2Plan } from "../src/import-v2/model.js";
import { connectToCrmChrome } from "../src/services/chrome.js";
import { WorkerRepository } from "../src/services/repository.js";

const jobId = process.argv[2]?.trim();
if (!jobId) throw new Error("Uso: npm run import-v2:audit-activities -- <job-id>");

const config = loadConfig();
const repository = new WorkerRepository(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
const result = await repository.client.from("property_worker_import_v2_items")
  .select("id,stage,status,plan,checkpoint")
  .eq("job_id", jobId)
  .eq("stage", "verified");
if (result.error) throw new Error(`Lettura attività Import V2 fallita: ${result.error.message}`);

const tabs = await connectToCrmChrome(config.CHROME_CDP_URL, config.CRM_TAB_MATCH);
const page = tabs.crmPage;
const originalUrl = page.url();
const port = new TecnocloudUiV2Port(page);
const audits: Array<Record<string, unknown>> = [];

try {
  for (const row of result.data ?? []) {
    const plan = row.plan as ImportV2Plan | null;
    const checkpoint = row.checkpoint as Partial<ImportV2Checkpoint> | null;
    const propertyId = checkpoint?.crmPropertyId;
    const description = plan?.source.activity.description?.trim();
    if (!propertyId || !description) {
      audits.push({ item: String(row.id).slice(0, 8), status: row.status, auditable: false });
      continue;
    }
    const responseMatches: string[] = [];
    const responseTasks: Promise<void>[] = [];
    const expected = description.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
    const inspectResponse = (response: import("playwright").Response) => {
      if (!["xhr", "fetch"].includes(response.request().resourceType())) return;
      responseTasks.push(response.text().then((body) => {
        const normalizedBody = body.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\\u00([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16))).replace(/\s+/g, " ").toUpperCase();
        if (normalizedBody.includes(expected)) responseMatches.push(new URL(response.url()).pathname);
      }).catch(() => undefined));
    };
    page.on("response", inspectResponse);
    const card = await (port as unknown as { activityCard(propertyId: string): Promise<import("playwright").Locator> }).activityCard(propertyId);
    await page.waitForTimeout(2_000);
    await Promise.all(responseTasks);
    page.off("response", inspectResponse);
    const text = (await card.innerText()).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toUpperCase();
    audits.push({
      item: String(row.id).slice(0, 8),
      status: row.status,
      auditable: true,
      expectedVisible: text.includes(expected),
      occurrenceCount: expected ? text.split(expected).length - 1 : 0,
      visibleRows: await card.locator("tbody tr:visible").count(),
      responseMatches: [...new Set(responseMatches)].length,
    });
  }
  process.stdout.write(JSON.stringify({ audited: audits.length, activities: audits }, null, 2));
} finally {
  if (page.url() !== originalUrl) {
    await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  }
  await tabs.browser.close().catch(() => undefined);
}
