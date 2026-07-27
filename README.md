# Listing Radar

Listing Radar is a private Next.js CRM for an internal real-estate workflow.

Current MVP scope:

- private dashboard and archive
- mock provider architecture
- Supabase schema and service clients
- protected cron endpoint
- mock report generation
- opt-in Subito.it provider for public real-estate listing pages
- Ad Maiora local agency provider for Bitonto listings
- Futura Immobiliare and Immobiliari Riunite live providers
- local import and authorized feed providers for complete real listing data
- automatic email-alert inbox for large portals
- private Chrome extension for one-click listing enrichment
- internal Mappa Zone for territory areas, streets, pins, and activity history

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
- `/incoming`
- `/listings`
- `/listings/[id]`
- `/map`
- `/reports`
- `/settings`
- `/api/cron/scrape`
- `/api/cron/email-alerts`
- `/api/import/browser`
- `/api/map/route-snap`

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
SCRAPER_IMPORT_PATH=data/import/listings.json
SCRAPER_FEED_URL=
SCRAPER_FEED_TOKEN=
SCRAPER_FEED_AUTH_HEADER=Authorization
SCRAPER_FEED_AUTH_PREFIX=Bearer
EMAIL_ALERTS_ENABLED=false
EMAIL_IMAP_HOST=imap.gmail.com
EMAIL_IMAP_PORT=993
EMAIL_IMAP_SECURE=true
EMAIL_IMAP_USER=
EMAIL_IMAP_PASSWORD=
EMAIL_IMAP_MAILBOX=INBOX
EMAIL_ALERT_LOOKBACK_DAYS=7
EMAIL_ALERT_MAX_MESSAGES=50
EMAIL_MARK_SEEN=false
ALLOW_MANUAL_EMAIL_REFRESH_WITHOUT_AUTH=false
EXTENSION_API_TOKEN=
MAP_OVERPASS_URL=https://overpass-api.de/api/interpreter
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are optional.
- `SCRAPER_PROVIDER=mock` is the safe development default.
- `SCRAPER_PROVIDER=admaiora` reads public Bitonto sale listings from Ad Maiora Immobiliare.
- `SCRAPER_PROVIDER=futura` reads Futura Immobiliare sale listings.
- `SCRAPER_PROVIDER=immobiliaririunite` reads Immobiliari Riunite Bitonto listings.
- `SCRAPER_PROVIDER=import` reads a local JSON/CSV/TSV file.
- `SCRAPER_PROVIDER=feed` reads an authorized remote JSON/CSV/TSV feed.
- `SCRAPER_PROVIDER=subito` enables the Subito.it provider.
- `SCRAPER_PROVIDER=all` runs all enabled live website providers: Ad Maiora, Futura, and Immobiliari Riunite.
- `SCRAPER_USER_AGENT` is optional. When omitted, the scraper sends a normal declarative user agent.
- Detail requests are capped at 10 per run and delayed by at least 1500 ms.
- `EMAIL_ALERTS_ENABLED=false` keeps mailbox access disabled by default.
- `EMAIL_IMAP_PASSWORD` must be a mailbox-specific password or app password, not a shared application secret.
- `ALLOW_MANUAL_EMAIL_REFRESH_WITHOUT_AUTH=false` prevents the manual mailbox action on an unauthenticated production deployment.
- `EXTENSION_API_TOKEN` is a private random token used only by the Chrome extension.
- `MAP_OVERPASS_URL` is optional and controls the server-side OpenStreetMap road-network source used by Mappa Zone's guided street drawing.

## Local development

Install dependencies and start the app:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Supabase migration

The schema is split into:

- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/002_incoming_listings.sql`
- `supabase/migrations/002_map_zones.sql`
- `supabase/migrations/003_app_settings.sql`
- `supabase/migrations/004_listing_crm_status.sql`

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
- `incoming_listings`
- `email_ingestion_messages`
- `agents`
- `map_areas`
- `map_streets`
- `map_pins`
- `map_activity_logs`

All tables have RLS enabled. Policies allow authenticated users to `select`, `insert`, `update`, and `delete`. Anonymous public access is not enabled.

## Mappa Zone

The internal territory map is available at `/map`. It uses Leaflet,
React Leaflet, Leaflet Draw, and server-side OpenStreetMap graph routing for guided
street drawing. Map-only libraries are loaded client-side so the Next.js build
does not touch browser APIs during SSR.

Map dependencies are already in `package.json`. To reinstall them manually:

```powershell
npm.cmd install leaflet react-leaflet leaflet-draw @types/leaflet @types/leaflet-draw
```

Apply the map migration with the rest of the schema:

```powershell
supabase db push
```

Or run `supabase/migrations/002_map_zones.sql` once in the Supabase SQL editor.
The migration seeds two agents when missing:

- Tony, `#2563eb`
- Agente 2, `#16a34a`

Operational use:

1. Open `/map`.
2. Use **Area** to draw and save a polygon.
3. Use **Strada** to click street start/end/curve/intersection points and save the road-snapped line. Area polygons are hidden while this mode is active.
4. Use **Pin** and click the map to save an operational note.
5. Use **Annunci** to show or hide listing pins with exact saved coordinates; scraper and browser-extension imports now persist `latitude`/`longitude`, the badge shows geolocated listings over total listings, and zooming out groups nearby listing pins.
6. Filter by agent, visibility, status, category, priority, and follow-up date.
7. Use the sidebar tabs for Pin, Aree, Strade, and Attivita.

Pin categories:

```text
sale_lead, empty_house, follow_up, useful_doorman,
useful_administrator, owner_met, door_knocked,
interesting_building, not_interested, recheck,
rental_lead, future_sale, other
```

Area and street status values:

```text
not_started, in_progress, completed, to_recheck
```

Street-only extra status:

```text
not_useful
```

Pin status values:

```text
new, to_verify, hot, contacted, follow_up, closed, discarded
```

Pin priorities:

```text
low, medium, high, urgent
```

Privacy and source limits:

- no live GPS tracking
- no real-time user location storage
- no map scraping
- no bulk tile downloads
- guided street drawing sends a bounded area query to the configured OpenStreetMap network source
- guided street drawing routes through every clicked point in order on an undirected street graph, so one-way car restrictions are ignored
- no automatic contact or messaging workflow
- no public data exposure; RLS policies are authenticated-only

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

To exercise the Ad Maiora local provider:

```powershell
$env:SCRAPER_PROVIDER = "admaiora"
$headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/cron/scrape" -Headers $headers
```

To scrape all enabled local websites:

```powershell
$env:SCRAPER_PROVIDER = "all"
$headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/cron/scrape" -Headers $headers
```

`all` intentionally excludes:

- `mock`, because it would mix test data with real listings
- `import` and `feed`, because they require explicit input configuration
- `subito`, because the public site currently returns `Access Denied`

To import a local data file:

```powershell
Copy-Item data/import/listings.example.json data/import/listings.json
$env:SCRAPER_PROVIDER = "import"
$env:SCRAPER_IMPORT_PATH = "data/import/listings.json"
$headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/cron/scrape" -Headers $headers
```

To import an authorized remote feed:

```powershell
$env:SCRAPER_PROVIDER = "feed"
$env:SCRAPER_FEED_URL = "https://example.com/authorized-listings.json"
$env:SCRAPER_FEED_TOKEN = "optional-token"
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

When email alerts are enabled, `/api/cron/scrape` also checks the mailbox before
running the selected website providers. A dedicated endpoint is available for a
more frequent schedule:

```powershell
$headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/cron/email-alerts" -Headers $headers
```

## Email alerts and browser enrichment

The large-portal workflow is:

```text
portal alert email -> /incoming pending item -> open portal -> Chrome extension
-> complete listing in /listings
```

Configure one mailbox that receives saved-search alerts from Idealista,
Immobiliare.it, Subito, and Casa.it. For Gmail use:

```text
EMAIL_IMAP_HOST=imap.gmail.com
EMAIL_IMAP_PORT=993
EMAIL_IMAP_SECURE=true
EMAIL_IMAP_USER=your-address@example.com
EMAIL_IMAP_PASSWORD=your-app-password
```

The ingestion process reads recent messages, extracts supported detail links,
and stores preliminary entries in `/incoming`. Processed message IDs are saved
so the same email is not imported again. Messages are not marked as read unless
`EMAIL_MARK_SEEN=true`.

Generate a long random value for `EXTENSION_API_TOKEN`, restart the app, then:

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Choose **Load unpacked** and select the `extension` directory.
4. Open the extension and enter the Listing Radar URL plus
   `EXTENSION_API_TOKEN`.
5. Open an item from `/incoming`, then click the extension and **Importa**.

The extension reads JSON-LD, Open Graph metadata, and visible page content. It
does not reveal hidden phone numbers, bypass login or CAPTCHA, contact sellers,
or run automatic browsing.

The importer also collects up to 30 public listing image URLs. They are stored
with the listing snapshot and displayed in the archive and listing detail
gallery. Reload the unpacked extension from `chrome://extensions` after an
extension update.

To reprocess recent alert emails after a parser update:

```powershell
$headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/cron/email-alerts?reprocess=true" `
  -Headers $headers
```

## Windows automation

Listing Radar includes local Windows Task Scheduler scripts in
`scripts/windows`.

The default automation installs:

- `Listing Radar - Start`: starts the app at Windows logon
- `Listing Radar - Email Alerts`: checks Gmail every 10 minutes

Local agency scraping remains available through `/api/cron/scrape`, but it is
not scheduled automatically.

Install or update the tasks from PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File ".\scripts\windows\Install-ListingRadarTasks.ps1"
```

The scheduled tasks do not contain Supabase, Gmail, extension, or cron secrets.
They read `CRON_SECRET` from `.env.local` at runtime.

Check their status:

```powershell
Get-ScheduledTask -TaskName "Listing Radar*" |
  Select-Object TaskName, State

Get-ScheduledTaskInfo -TaskName "Listing Radar - Email Alerts"
```

Runtime logs and the most recent JSON responses are stored in the ignored
`.runtime` directory:

```text
.runtime/server.log
.runtime/email-alerts.log
.runtime/email-alerts.latest.json
.runtime/scrape.log
.runtime/scrape.latest.json
```

Remove the scheduled tasks:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File ".\scripts\windows\Uninstall-ListingRadarTasks.ps1"
```

The automation runs only while the Windows user is logged in. If the email task
starts while the app is stopped, it starts Listing Radar first.

The **Controlla nuove email** button in `/incoming` runs the same mailbox check
on demand and refreshes the page. It is intentionally disabled in production
until application authentication is configured.

### Running without the Windows PC

The Task Scheduler integration is only a local fallback. Turning the PC off
also stops the IMAP polling.

The production design for near-real-time ingestion is:

```text
Gmail watch -> Google Cloud Pub/Sub -> hosted webhook
-> parse new messages -> Supabase incoming_listings
```

This keeps the private dashboard local while a small cloud endpoint receives
mailbox-change notifications and persists new arrivals in Supabase. It requires
Gmail OAuth credentials, a Google Cloud Pub/Sub topic and subscription, and a
public HTTPS webhook. Gmail watches must also be renewed periodically.

## Subito provider limits

The first Subito implementation only reads public search and detail pages for:

```text
https://www.subito.it/annunci-puglia/vendita/immobili/bari/bitonto/
```

It does not contact sellers, reveal hidden phone numbers, send messages, or republish content. If Subito blocks the request or the search markup changes, the provider logs a clear issue, returns an empty array, and lets the cron complete with `completed_with_errors`.

## Import and feed formats

`SCRAPER_PROVIDER=import` and `SCRAPER_PROVIDER=feed` accept either:

- JSON array: `[{ ...listing }]`
- JSON object with `listings`: `{ "listings": [{ ...listing }] }`
- CSV or TSV with a header row

Supported field names include camelCase, snake_case, and Italian labels for the common listing fields:

```text
source, source_listing_id, url, title, description, price, sqm, rooms,
floor, zone, address_raw, seller_type, seller_name, phone,
portal_declared_date, metadata_date_published, metadata_date_modified,
first_seen_at, last_seen_at, status, note, previous_price
```

The sample template is in `data/import/listings.example.json`.

## Source strategy

The next real source should be an authorized feed/export/API rather than a blocked public scraper. Public checks show:

- Ad Maiora Immobiliare exposes public Bitonto sale listings and its `robots.txt` has no disallow for `User-agent: *`, so it is the first live local provider.
- Futura Immobiliare and Immobiliari Riunite use public Agesta listing pages; their robots files only disallow internal `/include/` and `/templates/` paths.
- Subito exposes business/gestionale paths, but the public site blocks automated scraping unless authorized.
- Immobiliare.it publishes a robots file with disallowed search/list/detail-related endpoints.
- Idealista publishes a broad robots file with many disallowed property/search variations and anti-bot-sensitive paths.

The Ad Maiora provider is the first live website provider. The import/feed providers remain the preferred path for complete real data from agency CRMs, portal integrations, paid data providers, or any source that grants explicit permission.

## Large portal strategy

For the largest boards, the production path is an official data product rather than bypassing anti-bot controls:

- idealista offers an official Search API and accepts access requests at `https://developers.idealista.com/access-request`
- Immobiliare.it offers data APIs through `https://www.immobiliare.it/insights/dati-api/`
- Immobiliare.it also documents professional listing feeds at `https://feed.immobiliare.it/integration/ii/docs/import/get-start`
- Subito lists authorized management partners at `https://info.subito.it/gestionali-autorizzati.htm`

Once credentials or an authorized export are available, they can be connected through a dedicated API provider or the existing `feed` provider.

## Deploy on Vercel

1. Push the repository to GitHub.
2. Import the project into Vercel.
3. Add all required environment variables in the Vercel project settings.
4. Apply the Supabase migration against the production database.
5. Create the only allowed user in Supabase Authentication, using email and password.
6. Set `AUTH_REQUIRED=true` and `AUTH_ALLOWED_EMAIL` to that user's email.
7. Deploy. `vercel.json` schedules the complete provider run every day at
   06:15 UTC.
8. On cron-job.org create a job every five minutes for
   `https://<dominio>/api/cron/email-alerts`, using `GET` and the custom header
   `Authorization: Bearer <CRON_SECRET>`.

Vercel sends `Authorization: Bearer <CRON_SECRET>` to its daily cron route when
`CRON_SECRET` is configured. Vercel Hobby supports only daily schedules, so the
frequent email check is delegated to cron-job.org. The same application can be
deployed with the included `Dockerfile` on any persistent Node.js host.

All privileged Supabase writes remain server-side through
`SUPABASE_SERVICE_ROLE_KEY`. Dashboard routes require a Supabase session in
production; cron and browser-import routes continue to use dedicated bearer
tokens.

## Monitoring and backups

`GET /api/health` performs a lightweight application and Supabase connectivity
check. It returns `200` when both are available and `503` when the database
cannot be reached. It does not expose credentials, records, or configuration.
Use it for an external uptime monitor every 10 or 15 minutes.

cron-job.org should also keep failure and recovery notifications enabled for
the email ingestion job. The Settings page lists recent provider runs and
scrape errors for operational diagnosis.

Create a private local JSON backup with:

```powershell
npm.cmd run backup:data
```

The command exports all Listing Radar application tables and Supabase Auth user
metadata to `.backups/`, together with a SHA-256 checksum. The directory is
ignored by Git and must not be committed or uploaded to a public repository.
Keep at least one additional encrypted copy outside the project directory.

This JSON export is intended as an application-data safety copy. For a complete
Postgres backup and restoration workflow, use `supabase db dump`; Supabase
recommends regular off-site CLI exports for Free plan projects.

## Appetite scoring

The score is calculated at read and write time. Positive and negative factors
are shown in each listing detail. Every weight can be overridden through the
`SCORE_*` variables documented in `.env.example`, without changing code.

Default deductions include agency listings, unidentified sellers, missing
price, missing surface, insufficient descriptions, and auctions. The archive
can be filtered by score and sorted by appetite, date, or price.

## Listing management

The listing detail supports manual editing, notes, workflow status, and
archiving. A manual price change creates a snapshot, preserving price history.
New imports are compared with existing listings using address, title, zone,
surface, and price; likely matches share a `duplicate_group_id`.

## Tests

Run:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

## Richieste e Matching

La sezione privata comprende:

- `/requests` e `/requests/[id]` per richieste anonime o collegate a un cliente;
- `/portfolio` e `/portfolio/[id]` per gli immobili inseriti manualmente;
- `/matching` per il confronto spiegato richiesta–immobile;
- `/zones` per le zone interne, gli alias e le vie associate;
- `/matching-settings` per feature, pesi, soglie, tolleranze e stima dei mq commerciali.

Applicare in Supabase la migration:

```text
supabase/migrations/004_requests_matching.sql
```

Il pulsante globale **Nuova richiesta rapida** apre un percorso in quattro
passaggi, utilizzabile anche senza nome o telefono. Salvando una richiesta
attiva vengono calcolati i match contro il portafoglio attivo; i criteri
obbligatori non nascondono gli immobili quasi compatibili, ma sono riportati
come conflitti con una penalità esplicita.

I dati dimostrativi sono opzionali e non vengono eseguiti in produzione:

```text
supabase/seed_requests_matching.sql
```

L'importazione dal gestionale non è ancora attiva. Il contratto
`OfficeDatabaseImporter` e un provider mock si trovano in
`src/lib/matching/importer.ts`; i record prevedono già `external_crm_id`,
`source` e `last_imported_at`.

## Project structure

```text
app/
  (private)/
    incoming/
    map/
  api/cron/scrape/
  api/cron/email-alerts/
  api/import/browser/
extension/
scripts/
  windows/
src/
  components/
    map/
  lib/
    data/
    listings/
    incoming/
    map/
    email-alerts/
    notifications/
    reports/
    scrapers/providers/
    supabase/
  types/
supabase/migrations/
```
