import { randomUUID } from "node:crypto";

import { WorkerError } from "../core/errors.js";
import type { AcquisitionReview } from "../types.js";
import type { AcquisitionReviewDecision, AssistedDecision, MergeDecision, PromptController, PromptResponse } from "../services/prompts.js";

export type DesktopPrompt = {
  id: string;
  kind: "acquisition" | "acquisition-review" | "decision" | "merge" | "manual";
  title: string;
  summary: string;
  review?: AcquisitionReview;
};

type PendingPrompt = {
  prompt: DesktopPrompt;
  resolve: (value: PromptResponse) => void;
  reject: (error: Error) => void;
};

export class DesktopPromptController implements PromptController {
  private pending: PendingPrompt | null = null;
  private manualRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly publish: (prompt: DesktopPrompt | null) => void) {}

  private request(kind: DesktopPrompt["kind"], title: string, summary: string, review?: AcquisitionReview) {
    if (this.pending) throw new WorkerError("È già presente una conferma in attesa", "needs_review");
    return new Promise<PromptResponse>((resolve, reject) => {
      const prompt = { id: randomUUID(), kind, title, summary, ...(review ? { review } : {}) } satisfies DesktopPrompt;
      this.pending = { prompt, resolve, reject };
      this.publish(prompt);
      if (kind === "manual") {
        this.manualRetryTimer = setTimeout(() => {
          if (this.pending?.prompt.id === prompt.id) this.respond(prompt.id, undefined);
        }, 60_000);
        this.manualRetryTimer.unref?.();
      }
    });
  }

  async waitForAcquisition(): Promise<void> {
    await this.request(
      "acquisition",
      "Acquisisci i risultati SISTER",
      "Completa manualmente Comune, via e civico. Quando visualizzi “Elenco immobili indirizzo”, continua da qui.",
    );
  }

  async confirmSave(summary: string): Promise<AssistedDecision> {
    return await this.request("decision", "Controlla prima di procedere", summary) as AssistedDecision;
  }

  async reviewAcquisition(review: AcquisitionReview): Promise<AcquisitionReviewDecision> {
    return await this.request(
      "acquisition-review",
      "Controlla i dati acquisiti",
      `${review.properties.length} immobili pronti per il confronto con il gestionale.`,
      review,
    ) as AcquisitionReviewDecision;
  }

  async confirmMerge(summary: string): Promise<MergeDecision> {
    return await this.request("merge", "Merge pronto per la conferma", summary) as MergeDecision;
  }

  async waitForManualEdit(): Promise<void> {
    await this.request("manual", "Modifica manuale in corso", "Completa la modifica nel gestionale, poi conferma per continuare.");
  }

  respond(promptId: string, value: PromptResponse) {
    if (!this.pending || this.pending.prompt.id !== promptId) throw new Error("Conferma non più valida");
    const { resolve } = this.pending;
    if (this.manualRetryTimer) clearTimeout(this.manualRetryTimer);
    this.manualRetryTimer = null;
    this.pending = null;
    this.publish(null);
    resolve(value);
  }

  cancel(message = "Lavorazione messa in pausa") {
    if (!this.pending) return;
    const { reject } = this.pending;
    if (this.manualRetryTimer) clearTimeout(this.manualRetryTimer);
    this.manualRetryTimer = null;
    this.pending = null;
    this.publish(null);
    reject(new WorkerError(message, "paused"));
  }

  close() {
    if (this.manualRetryTimer) clearTimeout(this.manualRetryTimer);
    this.manualRetryTimer = null;
    this.publish(null);
  }
}
