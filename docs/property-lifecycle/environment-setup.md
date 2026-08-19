# Listing Radar environment setup

This repository is prepared for future Property Lifecycle Radar work. This document covers local tooling only; it does not authorize production database changes or real-estate crawling.

## Current environment

- Node.js: 25.0.0 was available during bootstrap. Supabase CLI requires Node.js 20 or newer.
- Package manager: npm 11.6.2, selected from the existing `package-lock.json`.
- Framework: Next.js 16.2.9 with the App Router.
- Database tooling: Supabase CLI 2.115.0, installed as a repository-local development dependency.
- Browser tooling: `@playwright/test` with Chromium installed.
- Image tooling: `sharp` and `exifr` installed for image decoding, dimensions/metadata, and EXIF inspection.

The local Docker CLI is installed, but Docker Desktop's Linux engine was not running during bootstrap. Local Supabase services therefore cannot start until Docker Desktop (or another compatible container runtime) is running.

## Install dependencies

From the repository root:

```powershell
npm.cmd install
```

PowerShell execution policy on the bootstrap machine blocks the `npm.ps1` shim, so `npm.cmd` is the reliable equivalent there. The same scripts are available through `npm run` in environments without that policy restriction.

## Start the application

```powershell
npm.cmd run dev
```

The existing Vercel project configuration is preserved in `.vercel/`; no production deployment or configuration was changed.

## Local Supabase

The existing migration SQL was preserved. Three duplicate numeric prefixes were normalized to unique ordered filenames (`0021_map_zones.sql`, `0031_property_worker.sql`, and `0041_requests_matching.sql`) so the Supabase migration history can be applied deterministically. Migration `014_property_zone_metadata.sql` was made compatible with a fresh local database while preserving existing geometry and rows.

Optional local analytics/Vector is disabled in `supabase/config.toml`; it is not needed by the application and its Docker log collector is unstable on this host. No automatic seed file is configured; `supabase/seed_requests_matching.sql` remains an explicit development fixture.

Start local services after Docker Desktop is running:

```powershell
npm.cmd run supabase:start
```

Stop them with:

```powershell
npm.cmd run supabase:stop
```

When running locally, the non-secret service URLs are:

- API/REST: `http://127.0.0.1:54321`
- PostgreSQL: `127.0.0.1:54322` (credentials are intentionally not documented)
- Studio: `http://127.0.0.1:54323`
- Mailpit: `http://127.0.0.1:54324`

The CLI prints local development credentials when starting; never copy those values into documentation, logs, or commits.

Reset the local database only:

```powershell
npm.cmd run supabase:reset
```

Future migrations belong in `supabase/migrations/`. Generate local database types after local Supabase is running with `npm.cmd run supabase:types`; redirect the output to a deliberately reviewed file if the project later adopts generated types.

This repository is not linked to a remote Supabase project by this bootstrap. Authentication and selection of a safe DEV/STAGING project are manual steps for a future task. Do not run `db push` against production.

## Playwright

Run the Chromium smoke test with:

```powershell
npm.cmd run test:e2e
```

The smoke test uses a local data URL and does not visit or scrape a real-estate site. Chromium can be reinstalled with `npx.cmd playwright install chromium` if the local browser cache is removed.

## Tests and quality checks

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:unit
npm.cmd run test:integration
npm.cmd run test:e2e
npm.cmd run build
```

The HTTP and image readiness smoke tests live under `tests/integration/`. The existing worker has its own package and test suite; run `npm.cmd test --prefix worker` when changing worker code.

## Known limitations and manual actions

- Docker Desktop's Linux engine must be started before local Supabase can be used.
- No remote Supabase project was linked and no Supabase login was performed. A future task must authenticate and explicitly select a safe DEV/STAGING project if remote operations are needed.
- Existing `.env.local` and Vercel configuration were inspected only for presence/shape; their values were not printed or changed.
- The repository had a pre-existing uncommitted change in `src/components/sidebar-nav.tsx`; it was preserved.
