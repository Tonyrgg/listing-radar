import { AppShellFrame } from "@/components/app-shell-frame";
import { isAuthRequired } from "@/lib/auth";
import { readFlash } from "@/lib/flash";

export async function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const flash = await readFlash();

  return (
    <AppShellFrame showLogout={isAuthRequired()} flash={flash}>
      {children}
    </AppShellFrame>
  );
}
