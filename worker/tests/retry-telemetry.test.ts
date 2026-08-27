import { describe, expect, it, vi } from "vitest";

import { runWithRetryTelemetry } from "../src/core/retry-telemetry.js";

describe("telemetria tentativi", () => {
  it("espone tentativo, attesa e riuscita", async () => {
    vi.useFakeTimers();
    const events: Array<{ status: string; attempt: number; nextRetryAt: string | null }> = [];
    let calls = 0;
    const promise = runWithRetryTelemetry(async () => {
      calls += 1;
      if (calls < 2) throw new Error("temporaneo");
      return "ok";
    }, {
      operation: "prova",
      delayMs: 1_000,
      onTelemetry: (event) => {
        events.push(event);
      },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(promise).resolves.toBe("ok");
    expect(events.map(({ status, attempt }) => [status, attempt])).toEqual([
      ["running", 1], ["waiting", 2], ["running", 2], ["succeeded", 2],
    ]);
    expect(events[1]?.nextRetryAt).not.toBeNull();
    vi.useRealTimers();
  });
});
