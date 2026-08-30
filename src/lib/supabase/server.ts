import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

/**
 * Un client per richiesta, non uno per domanda.
 *
 * Ogni `createServerClient` porta con sé la sua copia della sessione: crearne
 * uno nuovo a ogni chiamata significava rileggere e rivalidare il token tante
 * volte quante erano le funzioni che lo chiedevano.
 */
export const getSupabaseServerClient = cache(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Proxy refreshes cookies when Server Components cannot write them.
        }
      },
    },
  });
});
