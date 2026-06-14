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
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--line-strong)] bg-[var(--surface-panel)] px-3 text-sm font-medium text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-wait disabled:opacity-60 sm:w-auto"
        >
          <RefreshCw
            aria-hidden="true"
            className={clsx("size-4", pending && "animate-spin")}
          />
          {pending ? "Controllo in corso" : "Controlla nuove email"}
        </button>
      </form>
      {state.message ? (
        <p
          className={clsx(
            "max-w-sm text-xs",
            state.ok ? "text-[var(--surface-accent)]" : "text-[var(--status-error)]",
          )}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
