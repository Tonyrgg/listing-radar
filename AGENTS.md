<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Listing Radar repository rules

- Never expose or commit secrets. Treat every `.env*` file except `.env.example` as sensitive.
- Never destructively mutate production Supabase. Use the local Supabase project or an explicitly approved DEV/STAGING project.
- Database changes must use migrations in `supabase/migrations/`; do not edit production tables manually.
- Preserve the current Listing Radar until V2 is validated.
- Never infer disappearance from a failed crawler or source.
- Prefer deterministic evidence over inference.
- Always run relevant regression tests after changes.
- Respect the geographic scope Bitonto / Palombaio / Mariotto for future operational data.
- Use direct HTTP when possible; use Playwright only where it is useful.
- Keep source-specific crawler logic isolated in adapters.
- Human-confirmed values must not be silently overwritten.
