import { cookies } from "next/headers";

import { AppShellFrame } from "@/components/app-shell-frame";
import { isAuthRequired } from "@/lib/auth";
import { readNow } from "@/lib/clock";
import { readFlash } from "@/lib/flash";

export async function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /* Il segno cambia a ogni disegno mandato dal server: è così che il segnale
   * di attesa capisce che la cosa attesa è arrivata. Come l'ora, entra nella
   * pagina insieme ai dati e non a metà del disegno. */
  const [flash, segnoDiDisegno, biscotti] = await Promise.all([
    readFlash(),
    readNow(),
    cookies(),
  ]);

  /* La barra laterale sapeva com'era solo dopo il primo disegno, perché la sua
   * preferenza viveva in `localStorage`: a ogni apertura la pagina nasceva
   * stretta e poi saltava larga. Adesso la preferenza arriva col disegno. */
  const barraAperta = biscotti.get("listing-radar-sidebar")?.value === "expanded";

  return (
    <AppShellFrame
      showLogout={isAuthRequired()}
      flash={flash}
      segnoDiDisegno={segnoDiDisegno}
      barraAperta={barraAperta}
    >
      {children}
    </AppShellFrame>
  );
}
