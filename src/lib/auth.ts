import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Chi sta usando il programma.
 *
 * Serve solo l'identità: un id per firmare le correzioni manuali e l'indirizzo
 * per il controllo dell'account autorizzato.
 */
export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

export function isAuthRequired() {
  return process.env.AUTH_REQUIRED === "true" || process.env.NODE_ENV === "production";
}

/**
 * L'utente della richiesta, chiesto una volta sola.
 *
 * Prima ogni pagina protetta pagava due chiamate al server di autenticazione:
 * una nel guscio dell'app e una nella pagina, entrambe con il database
 * dall'altra parte della rete. Adesso `getClaims()` verifica il token in
 * locale con la chiave pubblica del progetto — una richiesta di rete solo
 * quando il token sta per scadere — e `cache` di React fa sì che tutte le
 * domande della stessa richiesta ricevano la stessa risposta.
 */
export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  if (!isAuthRequired()) return null;

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) return null;

  return {
    id: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : null,
  };
});

export const requireUser = cache(async (): Promise<AuthenticatedUser | null> => {
  if (!isAuthRequired()) return null;
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  const allowedEmail = process.env.AUTH_ALLOWED_EMAIL?.trim().toLowerCase();

  if (allowedEmail && user.email?.toLowerCase() !== allowedEmail) {
    const supabase = await getSupabaseServerClient();
    await supabase.auth.signOut();
    redirect("/login?error=account");
  }

  return user;
});
