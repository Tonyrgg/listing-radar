function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function getEmailAlertsConfig() {
  const host = process.env.EMAIL_IMAP_HOST?.trim() ?? "";
  const user = process.env.EMAIL_IMAP_USER?.trim() ?? "";
  const password = process.env.EMAIL_IMAP_PASSWORD?.trim() ?? "";

  return {
    enabled:
      readBoolean(process.env.EMAIL_ALERTS_ENABLED, false) &&
      Boolean(host && user && password),
    host,
    port: readPositiveInteger(process.env.EMAIL_IMAP_PORT, 993),
    secure: readBoolean(process.env.EMAIL_IMAP_SECURE, true),
    user,
    password,
    mailbox: process.env.EMAIL_IMAP_MAILBOX?.trim() || "INBOX",
    lookbackDays: readPositiveInteger(process.env.EMAIL_ALERT_LOOKBACK_DAYS, 7),
    maxMessages: readPositiveInteger(process.env.EMAIL_ALERT_MAX_MESSAGES, 50),
    markSeen: readBoolean(process.env.EMAIL_MARK_SEEN, false),
  };
}
