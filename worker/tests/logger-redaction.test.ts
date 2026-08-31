import { describe, expect, it } from "vitest";

import { sanitizeSensitiveText } from "../src/logger.js";

describe("sanitizzazione dei messaggi operativi", () => {
  it("rimuove cookie e token dai dettagli di rete Playwright", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.firmaSegretaLunga";
    const input = [
      "apiRequestContext.get: read ECONNRESET",
      "  - cookie: JSESSIONID=sessione; LtpaToken2=valore; portaleCookie=altro",
      "  - authorization: Bearer segreto",
      `  - x-api-key: ${jwt}`,
      `https://example.test/path?access_token=${jwt}&safe=1`,
    ].join("\n");

    const sanitized = sanitizeSensitiveText(input);
    expect(sanitized).toContain("read ECONNRESET");
    expect(sanitized).toContain("cookie: [REDACTED]");
    expect(sanitized).toContain("authorization: [REDACTED]");
    expect(sanitized).toContain("x-api-key: [REDACTED]");
    expect(sanitized).toContain("access_token=[REDACTED]");
    expect(sanitized).not.toContain("sessione");
    expect(sanitized).not.toContain("firmaSegretaLunga");
  });

  it("lascia leggibile un errore senza credenziali", () => {
    expect(sanitizeSensitiveText("Pagina SISTER non riconosciuta durante il ritorno ai risultati"))
      .toBe("Pagina SISTER non riconosciuta durante il ritorno ai risultati");
  });
});
