import "server-only";

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import { getEmailAlertsConfig } from "@/lib/email-alerts/config";
import { parseAlertEmail } from "@/lib/email-alerts/parser";
import type { EmailIngestionResult } from "@/lib/email-alerts/types";
import {
  isEmailMessageProcessed,
  recordEmailMessage,
  upsertIncomingAlerts,
} from "@/lib/incoming/repository";

let activeIngestion: Promise<EmailIngestionResult> | null = null;

function initialResult(enabled: boolean): EmailIngestionResult {
  return {
    enabled,
    connected: false,
    messagesChecked: 0,
    messagesProcessed: 0,
    messagesSkipped: 0,
    incomingInserted: 0,
    incomingUpdated: 0,
    errors: [],
  };
}

function getSenderText(parsed: Awaited<ReturnType<typeof simpleParser>>) {
  return parsed.from?.text ?? "";
}

function getConnectionErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Unable to connect to IMAP.";
  }

  const imapError = error as Error & {
    response?: string;
    serverResponseCode?: string;
  };

  return imapError.response
    ? `${imapError.message}: ${imapError.response}`
    : imapError.message;
}

async function runEmailAlertIngestion(options: {
  reprocessProcessed?: boolean;
}): Promise<EmailIngestionResult> {
  const config = getEmailAlertsConfig();
  const result = initialResult(config.enabled);

  if (!config.enabled) {
    return result;
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    disableAutoIdle: true,
    clientInfo: {
      name: "Listing Radar",
      version: "0.3",
    },
  });

  try {
    await client.connect();
    result.connected = true;
    const lock = await client.getMailboxLock(config.mailbox, {
      readOnly: !config.markSeen,
    });

    try {
      const since = new Date();
      since.setDate(since.getDate() - config.lookbackDays);
      const searchResult = await client.search({ since }, { uid: true });
      const uids = Array.isArray(searchResult)
        ? searchResult.slice(-config.maxMessages).reverse()
        : [];

      for (const uid of uids) {
        result.messagesChecked += 1;
        const summary = await client.fetchOne(
          uid,
          {
            envelope: true,
            internalDate: true,
          },
          { uid: true },
        );

        if (!summary) {
          continue;
        }

        const messageId =
          summary.envelope?.messageId ?? `${config.mailbox}:${String(uid)}`;

        if (
          !options.reprocessProcessed &&
          (await isEmailMessageProcessed(messageId))
        ) {
          result.messagesSkipped += 1;
          continue;
        }

        const fetched = await client.fetchOne(
          uid,
          {
            source: true,
          },
          { uid: true },
        );

        if (!fetched || !fetched.source) {
          continue;
        }

        const parsed = await simpleParser(fetched.source);
        const subject = parsed.subject ?? summary.envelope?.subject ?? "";
        const sender = getSenderText(parsed);
        const receivedAt = (
          parsed.date ??
          (summary.internalDate ? new Date(summary.internalDate) : new Date())
        ).toISOString();

        try {
          const alerts = parseAlertEmail({
            html: parsed.html,
            text: parsed.text,
            sender,
            subject,
          });
          const persisted = await upsertIncomingAlerts(alerts, {
            messageId,
            subject,
            sender,
            receivedAt,
          });

          result.messagesProcessed += 1;
          result.incomingInserted += persisted.inserted;
          result.incomingUpdated += persisted.updated;

          await recordEmailMessage({
            messageId,
            sender,
            subject,
            receivedAt,
            status: alerts.length ? "processed" : "ignored",
            listingsFound: alerts.length,
          });

          if (config.markSeen) {
            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Email parsing failed.";
          result.errors.push({ message, messageId });
          await recordEmailMessage({
            messageId,
            sender,
            subject,
            receivedAt,
            status: "error",
            listingsFound: 0,
            errorMessage: message,
          });
        }
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    result.errors.push({
      message: getConnectionErrorMessage(error),
    });
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      } else {
        client.close();
      }
    } catch {
      client.close();
    }
  }

  return result;
}

export function ingestEmailAlerts(
  options: { reprocessProcessed?: boolean } = {},
): Promise<EmailIngestionResult> {
  if (activeIngestion) {
    return activeIngestion;
  }

  activeIngestion = runEmailAlertIngestion(options).finally(() => {
    activeIngestion = null;
  });

  return activeIngestion;
}
