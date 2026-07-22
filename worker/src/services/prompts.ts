import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { AcquisitionReview } from "../types.js";

export type AssistedDecision = "confirm" | "skip" | "manual" | "review";
export type AcquisitionReviewDecision = "proceed" | "save" | "cancel";
export type MergeDecision = "confirm" | "manual";
export type PromptResponse = void | AssistedDecision | AcquisitionReviewDecision | MergeDecision;

export interface PromptController {
  waitForAcquisition(): Promise<void>;
  reviewAcquisition(review: AcquisitionReview): Promise<AcquisitionReviewDecision>;
  confirmSave(summary: string): Promise<AssistedDecision>;
  confirmMerge(summary: string): Promise<MergeDecision>;
  waitForManualEdit(): Promise<void>;
  close(): void;
}

export class WorkerPrompts implements PromptController {
  private readonly rl = createInterface({ input: stdin, output: stdout });

  async waitForAcquisition(): Promise<void> {
    await this.rl.question("\nPorta SISTER sui risultati, poi premi Invio — Acquisisci risultati ");
  }

  async confirmSave(summary: string): Promise<AssistedDecision> {
    stdout.write(`\n${summary}\n`);
    const answer = (await this.rl.question("[C]onferma  [S]alta  [M]odifica manualmente  [V]erificare: ")).trim().toLowerCase();
    if (answer.startsWith("s")) return "skip";
    if (answer.startsWith("m")) return "manual";
    if (answer.startsWith("v")) return "review";
    return "confirm";
  }

  async reviewAcquisition(review: AcquisitionReview): Promise<AcquisitionReviewDecision> {
    stdout.write(`\nRiepilogo acquisizione: ${review.properties.length} immobili\n`);
    for (const property of review.properties) {
      stdout.write(`- ${property.cadastralKey} | ${property.address ?? "indirizzo assente"}\n`);
      for (const owner of property.owners) stdout.write(`  ${owner.fullName} | quota ${owner.sharePercentage ?? "?"}%\n`);
    }
    const answer = (await this.rl.question("[P]rosegui  [S]alva per dopo  [A]nnulla: ")).trim().toLowerCase();
    if (answer.startsWith("a")) return "cancel";
    if (answer.startsWith("s")) return "save";
    return "proceed";
  }

  async confirmMerge(summary: string): Promise<MergeDecision> {
    stdout.write(`\n${summary}\n`);
    const answer = (await this.rl.question("[C]onferma merge  [M]anuale: ")).trim().toLowerCase();
    return answer.startsWith("m") ? "manual" : "confirm";
  }

  async waitForManualEdit(): Promise<void> {
    await this.rl.question("Completa la modifica nel browser, poi premi Invio per proseguire. ");
  }

  close() {
    this.rl.close();
  }
}
