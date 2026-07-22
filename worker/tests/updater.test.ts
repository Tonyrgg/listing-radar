import { describe, expect, it, vi } from "vitest";

import { DesktopUpdater } from "../src/desktop/updater.js";

describe("aggiornamenti desktop", () => {
  it("non tenta aggiornamenti nella versione di sviluppo", async () => {
    const onState = vi.fn();
    const updater = new DesktopUpdater({
      currentVersion: "1.0.0", packaged: false, supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "service-role-key-not-real", updateDirectory: "C:\\Temp\\Updates",
      isWorkerActive: () => false, quitApp: vi.fn(), onState,
    });
    expect(updater.snapshot()).toMatchObject({ status: "unavailable", currentVersion: "1.0.0" });
    await expect(updater.check()).resolves.toMatchObject({ status: "unavailable" });
    await expect(updater.download()).rejects.toThrow("app installata");
  });

  it("confronta correttamente le versioni numeriche", async () => {
    const { compareVersions } = await import("../src/desktop/updater.js");
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.0", "2.0.0")).toBe(-1);
  });
});
