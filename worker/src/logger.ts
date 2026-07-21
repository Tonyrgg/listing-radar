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
