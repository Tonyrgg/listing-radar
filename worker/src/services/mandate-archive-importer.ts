import type { Page } from "playwright";

import { collectCrmMandateArchive, extractCrmMandateDetail, normalizeCrmMandate, type CrmMandateArchiveItem } from "../adapters/crm/mandates.js";
import type { WorkerConfig } from "../config.js";
import { connectToMandateArchiveChrome } from "./chrome.js";
import { WorkerRepository, type CrmMandateImportRunRow } from "./repository.js";

export type MandateArchiveImportEvent =
  | { type: "index"; page: number; discovered: number }
  | { type: "progress"; runId: string; index: number; total: number; title: string; externalId: string; failed: number }
  | { type: "complete"; run: CrmMandateImportRunRow };

export function mandateItemsStillToProcess<T extends { status: string }>(items: T[]) {
  return items.filter((item) => item.status !== "completed");
}

export class MandateArchiveImporter {
  private interruptActivePages: (() => Promise<void>) | null = null;

  constructor(
    private readonly config: WorkerConfig,
    private readonly repository: WorkerRepository,
    private readonly options: {
      onEvent?: (event: MandateArchiveImportEvent) => void | Promise<void>;
      isCancelled?: () => boolean;
      isStopAfterNextImportRequested?: () => boolean;
    } = {},
  ) {}

  async interrupt() {
    await this.interruptActivePages?.();
  }

  async run(resumeRunId?: string): Promise<CrmMandateImportRunRow> {
    await this.repository.mandateArchiveHealthCheck();
    const chrome = await connectToMandateArchiveChrome(this.config.CHROME_CDP_URL);
    const context = chrome.archivePage.context();
    let listPage: Page | null = null;
    let detailPage: Page | null = null;
    let run: CrmMandateImportRunRow | null = null;
    this.interruptActivePages = async () => {
      await detailPage?.close().catch(() => undefined);
      await listPage?.close().catch(() => undefined);
      await chrome.browser.close().catch(() => undefined);
    };
    try {
      if (this.options.isCancelled?.()) throw new Error("Interrotta dall'operatore prima dell'avvio");
      if (resumeRunId) {
        const candidate = await this.repository.latestResumableMandateImportRun();
        if (!candidate || candidate.id !== resumeRunId) throw new Error("Sincronizzazione incarichi da riprendere non trovata");
        run = candidate;
        await this.repository.updateMandateImportRun(run.id, {
          status: "running", error_message: null, completed_at: null, current_external_id: null, current_title: null,
        });
      } else {
        run = await this.repository.createMandateImportRun(chrome.archivePage.url());
        listPage = await context.newPage();
        await listPage.goto(chrome.archivePage.url(), { waitUntil: "domcontentloaded", timeout: 30_000 });
        const index = await collectCrmMandateArchive(listPage, {
          isCancelled: this.options.isCancelled,
          onPage: (page, discovered) => this.options.onEvent?.({ type: "index", page, discovered }),
        });
        if (this.options.isCancelled?.()) {
          await this.repository.updateMandateImportRun(run.id, { status: "cancelled", completed_at: new Date().toISOString() });
          return { ...run, status: "cancelled" };
        }
        if (!index.length) throw new Error("Nessun incarico trovato nella pagina archivio");
        await this.repository.saveMandateImportItems(run.id, index);
        run = { ...run, total_mandates: index.length };
      }

      const allItems = await this.repository.listMandateImportItems(run.id);
      const itemsToProcess = mandateItemsStillToProcess(allItems);
      let processed = allItems.filter((item) => item.status === "completed").length;
      let failed = 0;
      detailPage = await context.newPage();
      for (const item of itemsToProcess) {
        if (this.options.isCancelled?.()) {
          await this.repository.updateMandateImportRun(run.id, {
            status: "cancelled", processed_mandates: processed, failed_mandates: failed,
            current_external_id: null, current_title: null, completed_at: new Date().toISOString(),
          });
          return { ...run, status: "cancelled", processed_mandates: processed, failed_mandates: failed };
        }
        await this.repository.markMandateImportItem(item.id, {
          status: "running", error_message: null, attempts: item.attempts + 1, started_at: new Date().toISOString(),
        });
        await this.repository.updateMandateImportRun(run.id, { current_external_id: item.external_crm_id, current_title: item.title });
        await this.options.onEvent?.({
          type: "progress", runId: run.id, index: processed + failed + 1, total: allItems.length,
          title: item.title ?? item.external_crm_id, externalId: item.external_crm_id, failed,
        });
        try {
          await detailPage.goto(item.source_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          const archiveItem: CrmMandateArchiveItem = item.list_payload && "externalId" in item.list_payload
            ? item.list_payload as CrmMandateArchiveItem
            : { externalId: item.external_crm_id, title: item.title ?? item.external_crm_id, url: item.source_url, listFields: {} };
          const detail = await extractCrmMandateDetail(detailPage, archiveItem);
          const propertyId = await this.repository.saveArchivedCrmMandate(item.id, detail, normalizeCrmMandate(detail));
          processed += 1;
          await this.repository.markMandateImportItem(item.id, {
            status: "completed", imported_property_id: propertyId, error_message: null, completed_at: new Date().toISOString(),
          });
        } catch (error) {
          failed += 1;
          await this.repository.markMandateImportItem(item.id, {
            status: "failed", error_message: error instanceof Error ? error.message : String(error), completed_at: new Date().toISOString(),
          });
        }
        await this.repository.updateMandateImportRun(run.id, { processed_mandates: processed, failed_mandates: failed });
        if (this.options.isStopAfterNextImportRequested?.()) {
          const message = "Run fermata dopo il prossimo import: il resto degli incarichi resta salvato e riprendibile.";
          await this.repository.updateMandateImportRun(run.id, {
            status: "cancelled", processed_mandates: processed, failed_mandates: failed,
            current_external_id: null, current_title: null, error_message: message, completed_at: new Date().toISOString(),
          });
          return { ...run, status: "cancelled", processed_mandates: processed, failed_mandates: failed, error_message: message };
        }
      }

      const status = failed ? "completed_with_errors" : "completed";
      const completedAt = new Date().toISOString();
      await this.repository.updateMandateImportRun(run.id, {
        status, processed_mandates: processed, failed_mandates: failed,
        current_external_id: null, current_title: null, completed_at: completedAt,
      });
      const result = { ...run, status, processed_mandates: processed, failed_mandates: failed, completed_at: completedAt } as CrmMandateImportRunRow;
      await this.options.onEvent?.({ type: "complete", run: result });
      return result;
    } catch (error) {
      if (run) {
        const cancelled = this.options.isCancelled?.() === true;
        await this.repository.updateMandateImportRun(run.id, {
          status: cancelled ? "cancelled" : "failed",
          error_message: cancelled ? "Interrotta dall'operatore" : error instanceof Error ? error.message : String(error),
          current_external_id: null,
          current_title: null,
          completed_at: new Date().toISOString(),
        }).catch(() => undefined);
        if (cancelled) return { ...run, status: "cancelled", error_message: "Interrotta dall'operatore" };
      }
      throw error;
    } finally {
      this.interruptActivePages = null;
      await detailPage?.close().catch(() => undefined);
      await listPage?.close().catch(() => undefined);
      await chrome.browser.close().catch(() => undefined);
    }
  }
}
