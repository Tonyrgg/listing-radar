import { redirect } from "next/navigation";

import { PendingSubmitButton } from "@/components/loading-controls";
import { login } from "@/app/login/actions";
import { Campo, Testo, buttonClass } from "@/components/ui/primitives";
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
    <main className="grid min-h-screen place-items-center bg-[var(--lr-canvas)] px-4 py-10">
      <section className="w-full max-w-sm rounded-[var(--lr-radius-container)] border border-[var(--lr-line)] bg-[var(--lr-surface)] p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center">
            <span
              aria-hidden="true"
              className="block size-10 bg-contain bg-center bg-no-repeat"
              style={{ backgroundImage: 'url("/brand/listing-radar-icon.png")' }}
            />
          </span>
          <div>
            <p className="text-[length:var(--lr-text-label)] font-[650] uppercase tracking-[var(--lr-tracking-label)] text-[var(--lr-ink-3)]">
              Listing Radar
            </p>
            <h1 className="text-[length:var(--lr-text-section)] font-[650] tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
              Accesso privato
            </h1>
          </div>
        </div>
        <form action={login} className="mt-6 space-y-4 border-t border-[var(--lr-line-quiet)] pt-5">
          <Campo label="Email">
            <Testo name="email" type="email" autoComplete="email" required />
          </Campo>
          <Campo label="Password">
            <Testo name="password" type="password" autoComplete="current-password" required />
          </Campo>
          {error ? (
            <p
              role="alert"
              className="rounded-[var(--lr-radius-control)] border border-[var(--lr-danger)] bg-[var(--lr-danger-soft)] px-3 py-2 text-[length:var(--lr-text-body)] text-[var(--lr-danger)]"
            >
              {error === "account"
                ? "Questo account non è autorizzato ad accedere a Listing Radar."
                : "Email o password non corrette. Controlla e riprova."}
            </p>
          ) : null}
          <PendingSubmitButton type="submit" pendingLabel="Accesso" className={buttonClass("primary", { block: true })}>
            Entra
          </PendingSubmitButton>
        </form>
      </section>
    </main>
  );
}
