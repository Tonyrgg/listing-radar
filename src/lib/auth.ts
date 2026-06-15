import "server-only";

import { redirect } from "next/navigation";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export function isAuthRequired() {
  return process.env.AUTH_REQUIRED === "true" || process.env.NODE_ENV === "production";
}

export async function getCurrentUser() {
  if (!isAuthRequired()) return null;
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function requireUser() {
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
}
