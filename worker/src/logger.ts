import pino from "pino";

export function maskTaxCode(value: string | null | undefined): string {
  if (!value) return "-";
  return value.length <= 6 ? "***" : `${value.slice(0, 3)}***${value.slice(-3)}`;
}

export function maskContact(value: string | null | undefined): string {
  if (!value) return "-";
  if (value.includes("@")) {
    const [name, domain] = value.split("@");
    return `${name?.slice(0, 2) ?? ""}***@${domain ?? "***"}`;
  }
  return value.length <= 4 ? "***" : `***${value.slice(-4)}`;
}

/**
 * Playwright includes request headers in some network error messages. Those
 * strings also reach the desktop activity log, outside Pino's key-based
 * redaction, so sanitize both header lines and common token shapes before a
 * message is persisted or shown.
 */
export function sanitizeSensitiveText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(
      /(^|\r?\n)(\s*(?:-\s*)?)(cookie|authorization|proxy-authorization|x-api-key|apikey)(\s*:\s*)[^\r\n]*/gi,
      "$1$2$3$4[REDACTED]",
    )
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_TOKEN]")
    .replace(/([?&](?:access_token|refresh_token|token|apikey|api_key|key)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/\b(JSESSIONID|LtpaToken2|SIAMPE|SIAMPELB|portaleCookie|tokenPriority)=([^;\s]+)/gi, "$1=[REDACTED]");
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "SUPABASE_SERVICE_ROLE_KEY",
      "serviceRoleKey",
      "cookie",
      "cookies",
      "token",
      "access_token",
      "refresh_token",
      "password",
      "credentials",
    ],
    censor: "[REDACTED]",
  },
  base: { app: "property-data-worker" },
});
