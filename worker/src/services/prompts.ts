import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export type AssistedDecision = "confirm" | "skip" | "manual" | "review";

export interface PromptController {
  waitForAcquisition(): Promise<void>;
  confirmSave(summary: string): Promise<AssistedDecision>;
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

  async waitForManualEdit(): Promise<void> {
    await this.rl.question("Completa la modifica nel browser, poi premi Invio per proseguire. ");
  }

  close() {
    this.rl.close();
  }
}
