import { describe, expect, it } from "vitest";
import { italianDayEnd, romeLocalToUtc, utcToRomeLocalInput } from "@/lib/acquisition/time";

describe("Acquisition daily queue", () => {
  it("uses the Rome day during summer time", () => {
    expect(italianDayEnd(new Date("2026-09-28T08:00:00Z")).toISOString())
      .toBe("2026-09-28T21:59:59.999Z");
  });
  it("uses the Rome day during winter time", () => {
    expect(italianDayEnd(new Date("2026-12-28T08:00:00Z")).toISOString())
      .toBe("2026-12-28T22:59:59.999Z");
  });
  it("stores user-entered local times as UTC across seasons", () => {
    expect(romeLocalToUtc("2026-09-28T10:00").toISOString()).toBe("2026-09-28T08:00:00.000Z");
    expect(romeLocalToUtc("2026-12-28T10:00").toISOString()).toBe("2026-12-28T09:00:00.000Z");
    expect(utcToRomeLocalInput("2026-09-28T08:00:00.000Z")).toBe("2026-09-28T10:00");
  });
});
