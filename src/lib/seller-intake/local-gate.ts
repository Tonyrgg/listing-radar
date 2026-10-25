import { timingSafeEqual } from 'node:crypto';

/** This delivery is local only. Enabling an env flag cannot open a production database. */
export function localIntakeReady(env: NodeJS.ProcessEnv = process.env) {
  if (env.SELLER_INTAKE_LOCAL_ENABLED !== 'true' || env.NODE_ENV === 'production') return false;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !!env.SELLER_INTAKE_OWNER_ID?.match(/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i)
      && (env.SELLER_INTAKE_TOKEN?.length ?? 0) >= 32;
  } catch { return false; }
}
export function intakeAuthorized(header: string | null, secret: string) {
  const actual = Buffer.from(header ?? ''), expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
