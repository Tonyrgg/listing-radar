import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function hasFlag(name: string) {
  return process.argv.includes(name);
}

export function optionValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Valore mancante per ${name}`);
  return value;
}

export function requireApplyConfirmation() {
  return hasFlag("--apply");
}

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono obbligatorie con --apply");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function chunks<T>(items: T[], size = 250): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("Dimensione batch non valida");
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}
