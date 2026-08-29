import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  EMPTY_BROWSER_CONNECTION_STABILITY,
  detectBrowserConnections,
  stabilizeBrowserConnections,
  unreachableBrowserConnections,
} from "../src/desktop/connection-detection.js";

describe("rilevamento tempestivo dei collegamenti desktop", () => {
  it("riconosce SISTER e gestionale anche quando titolo e URL cambiano percorso", () => {
    const checks = detectBrowserConnections([
      { type: "page", title: "Servizi catastali", url: "https://sister3.agenziaentrate.gov.it/Visure/SceltaLink.do" },
      { type: "page", title: "Tecnocloud", url: "https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/home" },
    ], "valore-configurato-non-piu-presente", "altro-valore-obsoleto");

    expect(checks.map(({ id, ok, state }) => ({ id, ok, state }))).toEqual([
      { id: "chrome", ok: true, state: "ready" },
      { id: "sister", ok: true, state: "ready" },
      { id: "crm", ok: true, state: "ready" },
    ]);
  });

  it("distingue una scheda aperta con accesso richiesto da un programma irraggiungibile", () => {
    const checks = detectBrowserConnections([
      { type: "page", title: "SISTER accesso", url: "https://sister3.agenziaentrate.gov.it/login" },
    ], "sister3.agenziaentrate.gov.it", "crmimmobiliarelightning");

    expect(checks.find((check) => check.id === "sister")).toMatchObject({ ok: false, state: "login", detail: "Scheda aperta, completa l'accesso" });
    expect(checks.find((check) => check.id === "crm")).toMatchObject({ ok: false, state: "missing", detail: "Scheda non aperta" });
    expect(unreachableBrowserConnections("connessione rifiutata")[0]).toMatchObject({ id: "chrome", state: "unreachable" });
  });

  it("usa polling rapido separato e ricontrolla subito dopo l'apertura di Chrome", () => {
    const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");

    expect(main).toContain("scheduleBrowserChecks(ready ? 10_000 : 2_000)");
    expect(main).toContain("scheduleBrowserChecks(250)");
    expect(main).toContain("Promise.all([");
  });

  it("non trasforma un singolo campione CDP fallito in un errore visibile", () => {
    const ready = detectBrowserConnections([
      { type: "page", title: "SISTER", url: "https://sister3.agenziaentrate.gov.it/Visure/SceltaLink.do" },
      { type: "page", title: "Gestionale", url: "https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/home" },
    ], "sister", "crmimmobiliarelightning");
    const stable = stabilizeBrowserConnections(EMPTY_BROWSER_CONNECTION_STABILITY, ready);
    const firstFailure = stabilizeBrowserConnections(stable, unreachableBrowserConnections("timeout transitorio"));
    expect(firstFailure.confirmed.every((check) => check.ok)).toBe(true);
    expect(firstFailure.pendingFailureCount).toBe(1);

    const confirmedFailure = stabilizeBrowserConnections(firstFailure, unreachableBrowserConnections("altro dettaglio"));
    expect(confirmedFailure.confirmed.find((check) => check.id === "chrome")).toMatchObject({ ok: false, state: "unreachable" });
  });

  it("accetta immediatamente il recupero dopo un errore confermato", () => {
    const failed = stabilizeBrowserConnections(
      stabilizeBrowserConnections(EMPTY_BROWSER_CONNECTION_STABILITY, unreachableBrowserConnections("offline")),
      unreachableBrowserConnections("offline"),
    );
    const ready = detectBrowserConnections([
      { type: "page", title: "SISTER", url: "https://sister3.agenziaentrate.gov.it/Visure/SceltaLink.do" },
      { type: "page", title: "Gestionale", url: "https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/home" },
    ], "sister", "crmimmobiliarelightning");
    expect(stabilizeBrowserConnections(failed, ready).confirmed.every((check) => check.ok)).toBe(true);
  });

  it("non lascia che un errore transitorio del keep-alive sovrascriva una scheda SISTER pronta", () => {
    const renderer = readFileSync(new URL("../src/desktop/renderer/renderer.js", import.meta.url), "utf8");
    expect(renderer).toContain('keep?.ok || keep?.sessionExpired');
    expect(renderer).not.toContain('![' + '"waiting", "disabled"' + '].includes(keep?.statusLabel)');
  });
});
