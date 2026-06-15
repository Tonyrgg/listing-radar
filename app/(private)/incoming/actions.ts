"use server";

import { revalidatePath } from "next/cache";

import { ingestEmailAlerts } from "@/lib/email-alerts/ingest";
import { requireUser } from "@/lib/auth";

export type RefreshEmailState = {
  ok: boolean | null;
  message: string;
};

export async function refreshIncomingEmails(
  _previousState: RefreshEmailState,
): Promise<RefreshEmailState> {
  void _previousState;

  await requireUser();

  const result = await ingestEmailAlerts();
  revalidatePath("/incoming");
  revalidatePath("/dashboard");

  if (!result.enabled) {
    return {
      ok: false,
      message: "La lettura email non e configurata.",
    };
  }

  if (!result.connected || result.errors.length > 0) {
    return {
      ok: false,
      message:
        result.errors[0]?.message ?? "Connessione alla casella email non riuscita.",
    };
  }

  return {
    ok: true,
    message: `${result.messagesChecked} email controllate, ${result.incomingInserted} nuovi arrivi aggiunti.`,
  };
}
