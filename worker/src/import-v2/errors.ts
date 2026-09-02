import type { ImportV2FailureKind, ImportV2Stage } from "./model.js";

export class ImportV2Error extends Error {
  constructor(
    message: string,
    readonly kind: ImportV2FailureKind,
    readonly options: {
      retryable?: boolean;
      global?: boolean;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = "ImportV2Error";
  }
}
export function failureFromError(error: unknown, stage: ImportV2Stage, now = new Date()): {
  kind: ImportV2FailureKind;
  message: string;
  retryable: boolean;
  global: boolean;
  stage: ImportV2Stage;
  details: Record<string, unknown>;
  occurredAt: string;
} {
  if (error instanceof ImportV2Error) {
    return {
      kind: error.kind,
      message: error.message,
      retryable: error.options.retryable ?? false,
      global: error.options.global ?? false,
      stage,
      details: error.options.details ?? {},
      occurredAt: now.toISOString(),
    };
  }
  return {
    kind: "transient_portal",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    global: false,
    stage,
    details: {},
    occurredAt: now.toISOString(),
  };
}
