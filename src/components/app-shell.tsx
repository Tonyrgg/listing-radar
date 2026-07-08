import { AppShellFrame } from "@/components/app-shell-frame";
import { isAuthRequired } from "@/lib/auth";

export function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AppShellFrame showLogout={isAuthRequired()}>{children}</AppShellFrame>;
}
