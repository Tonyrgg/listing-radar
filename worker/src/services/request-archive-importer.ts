import type { Page } from "playwright";

import { collectCrmRequestArchive, extractCrmRequestDetail, normalizeCrmRequest } from "../adapters/crm/requests.js";
import type { WorkerConfig } from "../config.js";
import { connectToRequestArchiveChrome } from "./chrome.js";
import { WorkerRepository, type CrmRequestImportRunRow } from "./repository.js";

export type RequestArchiveImportEvent =
  | { type: "index"; page: number; discovered: number }
  | { type: "progress"; runId: string; index: number; total: number; title: string; externalId: string; failed: number }
  | { type: "complete"; run: CrmRequestImportRunRow };

export function requestItemsStillToProcess<T extends { status: string }>(items: T[]) {
  return items.filter((item) => item.status !== "completed");
}

async function openAndExtractRequestDetail(page: Page, sourceUrl: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(sourceUrl, { waitUntil: "commit", timeout: 45_000 });
      return await extractCrmRequestDetail(page);
    } catch (error) {
      lastError = error;
      if (attempt === 0) await page.goto("about:blank", { waitUntil: "commit", timeout: 10_000 }).catch(() => undefined);
    }
  }
  throw lastError;
}

export class RequestArchiveImporter {
  constructor(
    private readonly config: WorkerConfig,
    private readonly repository: WorkerRepository,
    private readonly options: {
      onEvent?: (event: RequestArchiveImportEvent) => void | Promise<void>;
      isCancelled?: () => boolean;
    } = {},
  ) {}

  async run(resumeRunId?: string): Promise<CrmRequestImportRunRow> {
    await this.repository.requestArchiveHealthCheck();
    const chrome = await connectToRequestArchiveChrome(this.config.CHROME_CDP_URL);
    const context = chrome.archivePage.context();
    let listPage: Page | null = null;
    let detailPage: Page | null = null;
    let run: CrmRequestImportRunRow | null = null;
    try {
      if (resumeRunId) {
        const candidate = await this.repository.latestResumableRequestImportRun();
        if (!candidate || candidate.id !== resumeRunId) throw new Error("Sincronizzazione da riprendere non trovata");
        run = candidate;
        await this.repository.updateRequestImportRun(run.id, {
          status: "running", error_message: null, completed_at: null, current_external_id: null, current_title: null,
        });
      } else {
        run = await this.repository.createRequestImportRun(chrome.archivePage.url());
        listPage = await context.newPage();
        await listPage.goto(chrome.archivePage.url(), { waitUntil: "domcontentloaded", timeout: 30_000 });
        const index = await collectCrmRequestArchive(listPage, {
          isCancelled: this.options.isCancelled,
          onPage: (page, discovered) => this.options.onEvent?.({ type: "index", page, discovered }),
        });
        if (this.options.isCancelled?.()) {
          await this.repository.updateRequestImportRun(run.id, { status: "cancelled", completed_at: new Date().toISOString() });
          return { ...run, status: "cancelled" };
        }
        if (!index.length) throw new Error("Nessuna richiesta trovata nella pagina archivio");
        await this.repository.saveRequestImportItems(run.id, index);
        run = { ...run, total_requests: index.length };
      }

      const allItems = await this.repository.listRequestImportItems(run.id);
      const itemsToProcess = requestItemsStillToProcess(allItems);
      const items = allItems;
      const completed = items.filter((item) => item.status === "completed").length;
      let processed = completed;
      let failed = 0;
      detailPage = await context.newPage();
      for (const item of itemsToProcess) {
        if (this.options.isCancelled?.()) {
          await this.repository.updateRequestImportRun(run.id, {
            status: "cancelled", processed_requests: processed, failed_requests: failed,
            current_external_id: null, current_title: null, completed_at: new Date().toISOString(),
          });
          return { ...run, status: "cancelled", processed_requests: processed, failed_requests: failed };
        }
        await this.repository.markRequestImportItem(item.id, {
          status: "running", error_message: null, attempts: item.attempts + 1, started_at: new Date().toISOString(),
        });
        await this.repository.updateRequestImportRun(run.id, { current_external_id: item.external_crm_id, current_title: item.title });
        await this.options.onEvent?.({
          type: "progress", runId: run.id, index: processed + failed + 1, total: items.length,
          title: item.title ?? item.external_crm_id, externalId: item.external_crm_id, failed,
        });
        try {
          const detail = await openAndExtractRequestDetail(detailPage, item.source_url);
          const requestId = await this.repository.saveArchivedCrmRequest(item.id, detail, normalizeCrmRequest(detail));
          processed += 1;
          await this.repository.markRequestImportItem(item.id, {
            status: "completed", imported_request_id: requestId, error_message: null, completed_at: new Date().toISOString(),
          });
        } catch (error) {
          failed += 1;
          await this.repository.markRequestImportItem(item.id, {
            status: "failed", error_message: error instanceof Error ? error.message : String(error), completed_at: new Date().toISOString(),
          });
          await detailPage.close().catch(() => undefined);
          detailPage = await context.newPage();
        }
        await this.repository.updateRequestImportRun(run.id, { processed_requests: processed, failed_requests: failed });
      }

      const status = failed ? "completed_with_errors" : "completed";
      const completedAt = new Date().toISOString();
      await this.repository.updateRequestImportRun(run.id, {
        status, processed_requests: processed, failed_requests: failed,
        current_external_id: null, current_title: null, completed_at: completedAt,
      });
      const result = { ...run, status, processed_requests: processed, failed_requests: failed, completed_at: completedAt } as CrmRequestImportRunRow;
      await this.options.onEvent?.({ type: "complete", run: result });
      return result;
    } catch (error) {
      if (run) await this.repository.updateRequestImportRun(run.id, {
        status: "failed", error_message: error instanceof Error ? error.message : String(error), completed_at: new Date().toISOString(),
      }).catch(() => undefined);
      throw error;
    } finally {
      await detailPage?.close().catch(() => undefined);
      await listPage?.close().catch(() => undefined);
      await chrome.browser.close().catch(() => undefined);
    }
  }
}
