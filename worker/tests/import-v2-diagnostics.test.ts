import { describe, expect, it } from "vitest";

import {
  maskDiagnosticPathname,
  safeDiagnosticHint,
  safeDiagnosticLabel,
  sanitizeDiagnosticRoute,
} from "../src/import-v2/diagnostics.js";

describe("diagnostica Import V2", () => {
  it("maschera gli identificativi e conserva soltanto i nomi dei parametri", () => {
    expect(sanitizeDiagnosticRoute(
      "https://crm.example.test/s/account/0013Y00002AbCdQ?record=RSSMRA80A01A893P&mode=view",
    )).toEqual({
      origin: "https://crm.example.test",
      pathname: "/s/account/:id",
      queryKeys: ["mode", "record"],
    });
    expect(maskDiagnosticPathname("/s/immobile/a0B3Y000001234QAAQ/view")).toBe("/s/immobile/:id/view");
  });

  it("ammette soltanto etichette tecniche note, mai testo anagrafico", () => {
    expect(safeDiagnosticLabel("Codice Fiscale")).toBe("Codice Fiscale");
    expect(safeDiagnosticLabel("Soggetti collegati (3)")).toBe("Soggetti collegati");
    expect(safeDiagnosticLabel("Mario Rossi")).toBeNull();
    expect(safeDiagnosticLabel("IM - Via Roma 10 [2] - Centro")).toBeNull();
    expect(safeDiagnosticLabel("RSSMRA80A01A893P")).toBeNull();
    expect(safeDiagnosticHint("Cerca in questo elenco...")).toBe("Cerca in questo elenco...");
    expect(safeDiagnosticHint("Cerca RSSMRA80A01A893P")).toBeNull();
  });
});
