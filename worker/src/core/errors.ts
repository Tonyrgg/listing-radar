import type { ErrorStatus } from "../types.js";

export class WorkerError extends Error {
  constructor(
    message: string,
    public readonly status: ErrorStatus,
    public readonly details: Record<string, unknown> = {},
    public readonly captureScreenshot = false,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}

export class SelectorConfigurationError extends WorkerError {
  constructor(portal: "SISTER" | "CRM", missing: string[]) {
    super(
      `Selettori ${portal} non configurati: ${missing.join(", ")}`,
      "needs_review",
      { portal, missing },
    );
  }
}

