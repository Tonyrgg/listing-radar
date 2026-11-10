import { Radar, MapPin, FileText, Search } from "lucide-react";
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
  if (!isAuthRequired()) redirect("/intelligence");
  if (await getCurrentUser()) redirect("/intelligence");
  const { error } = await searchParams;

  return (
    <main className="lr-workspace lr-auth-screen"><aside className="lr-auth-intro"><div className="lr-brand"><span className="lr-brand-symbol"><Radar size={24}/></span><span><strong>Listing Radar</strong><small>COREIMMOBILIARE</small></span></div><div><p className="lr-auth-eyebrow">BITONTO · PALOMBAIO · MARIOTTO</p><h2>Il tuo archivio immobiliare.</h2><p>Immobili, cambiamenti e documenti del territorio, con le prove a portata di mano.</p><ul><li><Search size={18}/> Confronta immobili e prezzi osservati</li><li><FileText size={18}/> Leggi le trasformazioni documentate</li><li><MapPin size={18}/> Collega le informazioni ai luoghi</li></ul></div><small>Uno spazio di lavoro privato.</small></aside><div className="lr-auth-form">
      <section className="w-full max-w-sm">
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
      </section></div>
    </main>
  );
}
