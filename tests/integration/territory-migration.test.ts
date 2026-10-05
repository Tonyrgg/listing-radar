import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { it } from "vitest";

it("Territory memory enforces ownership, RLS, atomic revisions and transactional audit", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; grant usage on schema auth to authenticated, anon, service_role;
      create function auth.uid() returns uuid language sql stable as $$ select (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claims', true)::jsonb->>'role' $$;`);
    await db.exec(await readFile(path.resolve("supabase/migrations/0013_territory_lab_sync.sql"), "utf8"));
    await db.exec(await readFile(path.resolve("supabase/tests/territory_lab_sync.sql"), "utf8"));
  } finally { await db.close(); }
}, 30000);
