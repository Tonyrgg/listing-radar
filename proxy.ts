import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Il rinnovo della sessione, pagato solo quando serve davvero.
 *
 * Questo filtro gira davanti a ogni richiesta — comprese le navigazioni fra
 * pagine e i precaricamenti dei link — e prima chiedeva l'utente al server di
 * autenticazione ogni volta: un viaggio di rete di un decimo di secondo prima
 * ancora che la pagina cominciasse a lavorare, moltiplicato per ogni clic.
 *
 * Adesso fa due cose in meno: salta le richieste che non portano nessun
 * cookie di sessione (non c'è niente da rinnovare) e verifica il token con
 * `getClaims()`, che di norma lo controlla in locale con la chiave pubblica
 * del progetto e chiama la rete soltanto quando la sessione sta per scadere.
 */
const COOKIE_SESSIONE = /^sb-.*-auth-token/;

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (request.nextUrl.pathname.startsWith("/api/property-worker/")) return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return response;

  /* Senza cookie di sessione non c'è nessuna sessione da tenere viva: la
   * pagina protetta reindirizzerà da sé al login. */
  const haSessione = request.cookies
    .getAll()
    .some((cookie) => COOKIE_SESSIONE.test(cookie.name));

  if (!haSessione) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: [
    /* Fuori dal filtro tutto ciò che non è una pagina: file statici, immagini
     * ottimizzate, icone e manifest non hanno una sessione da rinnovare. */
    "/((?!_next/static|_next/image|favicon.ico|brand/|.*\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|woff2?)$).*)",
  ],
};
