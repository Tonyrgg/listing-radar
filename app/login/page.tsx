import { Radar } from "lucide-react";
import { redirect } from "next/navigation";

import { login } from "@/app/login/actions";
import { getCurrentUser, isAuthRequired } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!isAuthRequired()) redirect("/dashboard");
  if (await getCurrentUser()) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--surface-canvas)] px-4">
      <section className="w-full max-w-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]">
            <Radar aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-subtle)]">
              Listing Radar
            </p>
            <h1 className="text-xl font-semibold text-[var(--ink-strong)]">
              Accesso privato
            </h1>
          </div>
        </div>
        <form action={login} className="mt-8 space-y-5 border-t border-[var(--line-soft)] pt-6">
          <label className="block space-y-2 text-sm">
            <span className="font-medium text-[var(--ink-strong)]">Email</span>
            <input name="email" type="email" autoComplete="email" required className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-panel)] px-3 text-[var(--ink-strong)]" />
          </label>
          <label className="block space-y-2 text-sm">
            <span className="font-medium text-[var(--ink-strong)]">Password</span>
            <input name="password" type="password" autoComplete="current-password" required className="h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface-panel)] px-3 text-[var(--ink-strong)]" />
          </label>
          {error ? (
            <p className="text-sm text-[var(--status-error)]">
              {error === "account" ? "Questo account non e autorizzato." : "Email o password non corrette."}
            </p>
          ) : null}
          <button type="submit" className="h-11 w-full rounded-md bg-[var(--surface-accent)] px-4 text-sm font-semibold text-[var(--button-ink)]">
            Entra
          </button>
        </form>
      </section>
    </main>
  );
}
