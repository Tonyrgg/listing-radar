<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Listing Radar repository rules

Prima di intervenire, leggere `docs/PROJECT-ONBOARDING.md`: contiene architettura, runtime, flussi, regole operative, quality gate e procedure di rilascio dell'intero progetto.

- Never expose or commit secrets. Treat every `.env*` file except `.env.example` as sensitive.
- Never destructively mutate production Supabase. Use the local Supabase project or an explicitly approved DEV/STAGING project.
- Database changes must use migrations in `supabase/migrations/`; do not edit production tables manually.
- Property Lifecycle V2 e' stato promosso il 25 agosto 2026: e' l'archivio di riferimento.
  Il Listing Radar legacy e' in dismissione e sara' rimosso, tabelle comprese. Non
  costruire funzioni nuove sopra `listings` e le sue tabelle satellite.
- Dai portali entrano solo gli annunci che non sono di agenzia: le agenzie le legge V2
  dai loro siti. La regola scarta cio' che e' riconosciuto come agenzia e tiene privato
  e incerto, perche' un privato quasi mai si dichiara tale.
- Never infer disappearance from a failed crawler or source.
- Prefer deterministic evidence over inference.
- Always run relevant regression tests after changes.
- When worker changes are committed and pushed for delivery, also bump the worker version,
  publish the corresponding GitHub worker release, and verify the update channel. A source
  push alone does not deliver the desktop worker. Do not reuse an already published version.
- Respect the geographic scope Bitonto / Palombaio / Mariotto for future operational data.
- Use direct HTTP when possible; use Playwright only where it is useful.
- Keep source-specific crawler logic isolated in adapters.
- Human-confirmed values must not be silently overwritten.
