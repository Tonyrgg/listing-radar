import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth";
import { connection } from "next/server";

export default async function PrivateLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Le pagine autenticate dipendono dall'utente e da Supabase: non devono
  // essere eseguite durante il prerender di una Preview senza credenziali.
  await connection();
  await requireUser();
  return <AppShell>{children}</AppShell>;
}
