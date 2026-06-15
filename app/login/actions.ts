"use server";

import { redirect } from "next/navigation";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) redirect("/login?error=credentials");
  redirect("/dashboard");
}

export async function logout() {
  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
