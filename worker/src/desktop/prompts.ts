import { randomUUID } from "node:crypto";

import { WorkerError } from "../core/errors.js";
import type { AssistedDecision, PromptController } from "../services/prompts.js";

export type DesktopPrompt = {
  id: string;
  kind: "acquisition" | "decision" | "manual";
  title: string;
  summary: string;
};

type PendingPrompt = {
  prompt: DesktopPrompt;
  resolve: (value: void | AssistedDecision) => void;
  reject: (error: Error) => void;
};

export class DesktopPromptController implements PromptController {
  private pending: PendingPrompt | null = null;

  constructor(private readonly publish: (prompt: DesktopPrompt | null) => void) {}

  private request(kind: DesktopPrompt["kind"], title: string, summary: string) {
    if (this.pending) throw new WorkerError("È già presente una conferma in attesa", "needs_review");
    return new Promise<void | AssistedDecision>((resolve, reject) => {
      const prompt = { id: randomUUID(), kind, title, summary } satisfies DesktopPrompt;
      this.pending = { prompt, resolve, reject };
      this.publish(prompt);
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

  async waitForManualEdit(): Promise<void> {
    await this.request("manual", "Modifica manuale in corso", "Completa la modifica nel gestionale, poi conferma per continuare.");
  }

  respond(promptId: string, value: void | AssistedDecision) {
    if (!this.pending || this.pending.prompt.id !== promptId) throw new Error("Conferma non più valida");
    const { resolve } = this.pending;
    this.pending = null;
    this.publish(null);
    resolve(value);
  }

  cancel(message = "Lavorazione messa in pausa") {
    if (!this.pending) return;
    const { reject } = this.pending;
    this.pending = null;
    this.publish(null);
    reject(new WorkerError(message, "paused"));
  }

  close() {
    this.publish(null);
  }
}
