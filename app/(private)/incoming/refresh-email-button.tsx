"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { clsx } from "clsx";

import {
  refreshIncomingEmails,
  type RefreshEmailState,
} from "@/app/(private)/incoming/actions";

const INITIAL_REFRESH_EMAIL_STATE: RefreshEmailState = {
  ok: null,
  message: "",
};

export function RefreshEmailButton() {
  const [state, action, pending] = useActionState(
    refreshIncomingEmails,
    INITIAL_REFRESH_EMAIL_STATE,
  );

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--lr-line)] bg-[var(--lr-surface)] px-3 text-[length:var(--lr-text-body)] font-medium text-[var(--lr-ink)] transition-colors hover:bg-[var(--lr-raised)] disabled:cursor-wait disabled:opacity-60 sm:w-auto"
        >
          <RefreshCw
            aria-hidden="true"
            className={clsx("size-4", pending && "animate-spin")}
          />
          {pending ? "Ricerca in corso" : "Cerca nuovi annunci"}
        </button>
      </form>
      {state.message ? (
        <p
          className={clsx(
            "max-w-sm text-[length:var(--lr-text-meta)]",
            state.ok ? "text-[var(--lr-ok)]" : "text-[var(--lr-danger)]",
          )}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
