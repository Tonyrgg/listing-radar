import { matchesWorkerPortal } from "../core/browser-page-matching.js";

export type BrowserPageDescriptor = {
  title?: string;
  url?: string;
  type?: string;
};

export type BrowserConnectionCheck = {
  id: "chrome" | "sister" | "crm";
  label: string;
  ok: boolean;
  detail: string;
  state: "ready" | "missing" | "login" | "unreachable";
};

export type BrowserConnectionStability = {
  confirmed: BrowserConnectionCheck[];
  pendingFailureSignature: string | null;
  pendingFailureCount: number;
};

export const EMPTY_BROWSER_CONNECTION_STABILITY: BrowserConnectionStability = {
  confirmed: [],
  pendingFailureSignature: null,
  pendingFailureCount: 0,
};

const LOGIN_PATTERN = /(login|signin|accesso|autenticazione|logout-success|sessione[_-]?scaduta)/i;

function portalCheck(
  id: "sister" | "crm",
  label: string,
  page: BrowserPageDescriptor | undefined,
): BrowserConnectionCheck {
  if (!page) return { id, label, ok: false, detail: "Scheda non aperta", state: "missing" };
  if (LOGIN_PATTERN.test(page.url ?? "")) {
    return { id, label, ok: false, detail: "Scheda aperta, completa l'accesso", state: "login" };
  }
  return { id, label, ok: true, detail: page.title?.trim() || "Scheda pronta", state: "ready" };
}

export function detectBrowserConnections(
  pages: BrowserPageDescriptor[],
  sisterMatch: string,
  crmMatch: string,
): BrowserConnectionCheck[] {
  const visiblePages = pages.filter((page) => page.type === "page" || !page.type);
  const sisterPage = visiblePages.find((page) => matchesWorkerPortal(page, sisterMatch, "sister"));
  const crmPage = visiblePages.find((page) => matchesWorkerPortal(page, crmMatch, "crm"));
  return [
    { id: "chrome", label: "Chrome", ok: true, detail: `${visiblePages.length} schede aperte`, state: "ready" },
    portalCheck("sister", "SISTER", sisterPage),
    portalCheck("crm", "Gestionale", crmPage),
  ];
}

export function unreachableBrowserConnections(detail: string): BrowserConnectionCheck[] {
  return [
    { id: "chrome", label: "Chrome", ok: false, detail, state: "unreachable" },
    { id: "sister", label: "SISTER", ok: false, detail: "Chrome non raggiungibile", state: "unreachable" },
    { id: "crm", label: "Gestionale", ok: false, detail: "Chrome non raggiungibile", state: "unreachable" },
  ];
}

function failureSignature(checks: BrowserConnectionCheck[]) {
  return checks
    .filter((check) => !check.ok)
    .map((check) => `${check.id}:${check.state}`)
    .sort()
    .join("|");
}

/**
 * Chrome's local debugging endpoint can disappear for a single sample while a
 * tab navigates or Chrome is busy. Keep the last fully ready state until the
 * same failure is observed twice; genuine recovery is accepted immediately.
 */
export function stabilizeBrowserConnections(
  state: BrowserConnectionStability,
  candidate: BrowserConnectionCheck[],
  confirmationSamples = 2,
): BrowserConnectionStability {
  const candidateReady = candidate.length === 3 && candidate.every((check) => check.ok);
  if (candidateReady) {
    return { confirmed: candidate, pendingFailureSignature: null, pendingFailureCount: 0 };
  }

  const confirmedReady = state.confirmed.length === 3 && state.confirmed.every((check) => check.ok);
  if (!confirmedReady) {
    return { confirmed: candidate, pendingFailureSignature: null, pendingFailureCount: 0 };
  }

  const signature = failureSignature(candidate);
  const pendingFailureCount = signature === state.pendingFailureSignature
    ? state.pendingFailureCount + 1
    : 1;
  if (pendingFailureCount < confirmationSamples) {
    return {
      confirmed: state.confirmed,
      pendingFailureSignature: signature,
      pendingFailureCount,
    };
  }
  return { confirmed: candidate, pendingFailureSignature: null, pendingFailureCount: 0 };
}
