import { isSupabaseProjectRestricted } from "../services/supabase-errors.js";

type CloudResult = { error: { message: string; code?: string; status?: number } | null };

export function isTransientCloudError(error: unknown): boolean {
  if (isSupabaseProjectRestricted(error)) return false;
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = Number(record.status ?? record.code);
  if ([502, 503, 504, 520, 521, 522, 523, 524, 525, 526].includes(status)) return true;
  const message = error instanceof Error ? error.message : String(record.message ?? error);
  return /(?:\b(?:502|503|504|520|521|522|523|524|525|526)\b|SSL handshake failed|Supabase temporaneamente non raggiungibile|fetch failed|Failed to fetch|network error|ECONNRESET|ETIMEDOUT|EAI_AGAIN)/i.test(message);
}

export function cloudErrorMessage(error: { message: string; code?: string; status?: number }): string {
  if (!isTransientCloudError(error)) return error.message;
  const status = Number(error.status ?? error.code) || Number(error.message.match(/\b(5(?:02|03|04|20|21|22|23|24|25|26))\b/)?.[1]);
  return `Supabase temporaneamente non raggiungibile${status ? ` (HTTP ${status})` : ""}. Il checkpoint resta disponibile per la ripresa.`;
}

/** Retry only transient transport/gateway failures; callers must make writes idempotent. */
export async function cloudRequest<T extends CloudResult>(
  operation: () => PromiseLike<T>,
  options: { attempts?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = options.attempts ?? 5;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt += 1) {
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      if (!isTransientCloudError(error)) throw error;
      if (attempt >= attempts) throw new Error(cloudErrorMessage({ message: error instanceof Error ? error.message : String(error) }));
      await wait(Math.min(800 * 2 ** (attempt - 1), 6_400));
      continue;
    }
    if (!result.error || attempt >= attempts || !isTransientCloudError(result.error)) return result;
    await wait(Math.min(800 * 2 ** (attempt - 1), 6_400));
  }
}
