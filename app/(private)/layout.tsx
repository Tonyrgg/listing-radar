import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth";

export default async function PrivateLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireUser();
  return <AppShell>{children}</AppShell>;
}
