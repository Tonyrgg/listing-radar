# Listing Radar

Listing Radar is a private Next.js CRM for an internal real-estate workflow.

Current MVP scope:

- private dashboard and archive
- mock provider architecture
- Supabase schema and service clients
- protected cron endpoint
- mock report generation
- opt-in Subito.it provider for public real-estate listing pages

Out of scope in this phase:

- automatic contact workflows
- public listing publication
- automatic outbound messaging

## Stack

- Next.js 16 App Router
- TypeScript
- Tailwind CSS 4
- Supabase
- Vercel

## Routes

- `/dashboard`
- `/listings`
- `/listings/[id]`
- `/reports`
- `/settings`
- `/api/cron/scrape`

The UI falls back to realistic mock data when Supabase is not configured yet or the tables are still empty. The cron endpoint persists mock listings into Supabase when the required env vars are present.

## Required environment variables

Create `.env.local` in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
SCRAPER_PROVIDER=mock
SCRAPER_USER_AGENT=
SCRAPER_MAX_SEARCH_PAGES=1
SCRAPER_MAX_DETAIL_PAGES=10
SCRAPER_DETAIL_DELAY_MS=1500
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are optional.
- `SCRAPER_PROVIDER=mock` is the safe development default.
- `SCRAPER_PROVIDER=subito` enables the Subito.it provider.
- `SCRAPER_PROVIDER=all` runs mock and Subito in the same cron run.
- `SCRAPER_USER_AGENT` is optional. When omitted, the scraper sends a normal declarative user agent.
- Detail requests are capped at 10 per run and delayed by at least 1500 ms.

## Local development

Install dependencies and start the app:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Supabase migration

The initial schema is in [supabase/migrations/001_initial_schema.sql](/abs/path/c:/Users/ruggi/listing-radar/supabase/migrations/001_initial_schema.sql).

Apply it with the Supabase CLI if you use local or linked database workflows:

```bash
supabase db push
```

Or paste the SQL file into the Supabase SQL editor and run it once.

The migration creates:

- `listings`
- `listing_snapshots`
- `listing_sources`
- `listing_notes`
- `listing_actions`
- `reports`
- `scrape_runs`
- `scrape_errors`

All tables have RLS enabled. Policies allow authenticated users to `select`, `insert`, `update`, and `delete`. Anonymous public access is not enabled.

## Seed / cron test

The protected mock ingestion flow is the cron endpoint:

```text
POST /api/cron/scrape
GET  /api/cron/scrape
Authorization: Bearer <CRON_SECRET>
```

PowerShell example:

```powershell
$env:SCRAPER_PROVIDER = "mock"
$headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/cron/scrape" -Headers $headers
```

To exercise the Subito provider locally:

```powershell
$env:SCRAPER_PROVIDER = "subito"
$headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/cron/scrape" -Headers $headers
```

What it does:

1. creates a `scrape_runs` record
2. loads the provider selected by `SCRAPER_PROVIDER`
3. upserts listings
4. stores `listing_snapshots`
5. generates and saves a report
6. closes the run as `success`, `completed_with_errors`, or `error`
7. returns JSON results per provider
8. stores provider fetch/search/parse/upsert issues in `scrape_errors`

## Subito provider limits

The first Subito implementation only reads public search and detail pages for:

```text
https://www.subito.it/annunci-puglia/vendita/immobili/bari/bitonto/
```

It does not contact sellers, reveal hidden phone numbers, send messages, or republish content. If Subito blocks the request or the search markup changes, the provider logs a clear issue, returns an empty array, and lets the cron complete with `completed_with_errors`.

## Deploy on Vercel

1. Push the repository to GitHub.
2. Import the project into Vercel.
3. Add all required environment variables in the Vercel project settings.
4. Apply the Supabase migration against the production database.
5. Trigger `/api/cron/scrape` from a scheduler that can send the `Authorization: Bearer <CRON_SECRET>` header.

The current implementation keeps all privileged Supabase writes on the server side through `SUPABASE_SERVICE_ROLE_KEY`.

## Project structure

```text
app/
  (private)/
  api/cron/scrape/
src/
  components/
  lib/
    data/
    listings/
    notifications/
    reports/
    scrapers/providers/
    supabase/
  types/
supabase/migrations/
```
