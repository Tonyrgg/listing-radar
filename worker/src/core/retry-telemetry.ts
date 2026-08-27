export type RetryTelemetryStatus = "running" | "waiting" | "succeeded" | "exhausted";

export type RetryTelemetry = {
  operation: string;
  attempt: number;
  maximumAttempts: number;
  status: RetryTelemetryStatus;
  nextRetryAt: string | null;
};

export type RetryOperationOptions = {
  operation: string;
  maximumAttempts?: number;
  delayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onTelemetry?: (telemetry: RetryTelemetry) => void | Promise<void>;
};

export async function runWithRetryTelemetry<T>(
  action: (attempt: number) => Promise<T>,
  options: RetryOperationOptions,
): Promise<T> {
  const maximumAttempts = Math.max(1, Math.trunc(options.maximumAttempts ?? 3));
  const delayMs = Math.max(0, Math.trunc(options.delayMs ?? 3_000));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    await options.onTelemetry?.({
      operation: options.operation, attempt, maximumAttempts, status: "running", nextRetryAt: null,
    });
    try {
      const result = await action(attempt);
      await options.onTelemetry?.({
        operation: options.operation, attempt, maximumAttempts, status: "succeeded", nextRetryAt: null,
      });
      return result;
    } catch (error) {
      lastError = error;
      const retryable = attempt < maximumAttempts && (options.shouldRetry?.(error, attempt) ?? true);
      if (!retryable) {
        await options.onTelemetry?.({
          operation: options.operation, attempt, maximumAttempts, status: "exhausted", nextRetryAt: null,
        });
        throw error;
      }
      const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
      await options.onTelemetry?.({
        operation: options.operation, attempt: attempt + 1, maximumAttempts, status: "waiting", nextRetryAt,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
