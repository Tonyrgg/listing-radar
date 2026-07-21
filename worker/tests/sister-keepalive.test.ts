import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";

import { nextKeepAliveDelay, pingSisterSession, resolveSisterKeepAliveUrl } from "../src/services/sister-keepalive.js";

describe("SISTER keep-alive", () => {
  it("usa una pagina neutra dello stesso portale", () => {
    expect(resolveSisterKeepAliveUrl("https://sister3.agenziaentrate.gov.it/Visure/risultati.do"))
      .toBe("https://sister3.agenziaentrate.gov.it/Visure/");
  });

  it("programma il controllo tra il minimo e il massimo", () => {
    expect(nextKeepAliveDelay(120, 180, () => 0)).toBe(120_000);
    expect(nextKeepAliveDelay(120, 180, () => 0.5)).toBe(150_000);
    expect(nextKeepAliveDelay(120, 180, () => 1)).toBe(180_000);
  });

  it("riconosce il rinvio alla pagina di sessione scaduta", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue({
      status: () => 302,
      headers: () => ({ location: "/Servizi/errorFiltroSessioneScaduta.jsp" }),
      text: vi.fn(),
      dispose,
    });
    const page = {
      url: () => "https://sister3.agenziaentrate.gov.it/Visure/risultati.do",
      context: () => ({ request: { get } }),
    } as unknown as Page;

    await expect(pingSisterSession(page)).resolves.toMatchObject({ ok: false, sessionExpired: true, status: 302 });
    expect(dispose).toHaveBeenCalledOnce();
  });
});
