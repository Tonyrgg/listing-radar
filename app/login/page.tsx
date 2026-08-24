import { Radar } from "lucide-react";
import { redirect } from "next/navigation";

import { PendingSubmitButton } from "@/components/loading-controls";
import { login } from "@/app/login/actions";
import { getCurrentUser, isAuthRequired } from "@/lib/auth";

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Accesso" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!isAuthRequired()) redirect("/dashboard");
  if (await getCurrentUser()) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--lr-canvas)] px-4">
      <section className="w-full max-w-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-[var(--lr-accent-soft)] text-[var(--lr-accent)]">
            <Radar aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--lr-ink-3)]">
              Listing Radar
            </p>
            <h1 className="text-xl font-semibold text-[var(--lr-ink)]">
              Accesso privato
            </h1>
          </div>
        </div>
        <form action={login} className="mt-8 space-y-5 border-t border-[var(--lr-line-quiet)] pt-6">
          <label className="block space-y-2 text-sm">
            <span className="font-medium text-[var(--lr-ink)]">Email</span>
            <input name="email" type="email" autoComplete="email" required className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-surface)] px-3 text-[var(--lr-ink)]" />
          </label>
          <label className="block space-y-2 text-sm">
            <span className="font-medium text-[var(--lr-ink)]">Password</span>
            <input name="password" type="password" autoComplete="current-password" required className="h-11 w-full rounded-md border border-[var(--lr-line)] bg-[var(--lr-surface)] px-3 text-[var(--lr-ink)]" />
          </label>
          {error ? (
            <p className="text-sm text-[var(--lr-danger)]">
              {error === "account" ? "Questo account non è autorizzato." : "Email o password non corrette."}
            </p>
          ) : null}
          <PendingSubmitButton type="submit" pendingLabel="Accesso" className="h-11 w-full rounded-md bg-[var(--lr-accent)] px-4 text-sm font-semibold text-[var(--lr-accent-ink)]">
            Entra
          </PendingSubmitButton>
        </form>
      </section>
    </main>
  );
}
