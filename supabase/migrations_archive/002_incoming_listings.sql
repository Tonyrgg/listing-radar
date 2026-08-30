create table public.incoming_listings (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_listing_id text,
  url text not null,
  canonical_url text,
  title text not null,
  description text,
  price integer,
  sqm integer,
  rooms numeric,
  zone text,
  image_url text,
  email_message_id text,
  email_subject text,
  email_sender text,
  email_received_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'enriched', 'dismissed', 'error')),
  listing_id uuid references public.listings(id) on delete set null,
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index incoming_listings_message_url_unique_idx
  on public.incoming_listings (email_message_id, canonical_url)
  where email_message_id is not null and canonical_url is not null;

create unique index incoming_listings_source_id_unique_idx
  on public.incoming_listings (source, source_listing_id)
  where source_listing_id is not null;

create index incoming_listings_status_received_idx
  on public.incoming_listings (status, email_received_at desc);

create trigger set_incoming_listings_updated_at
before update on public.incoming_listings
for each row
execute function public.set_updated_at();

create table public.email_ingestion_messages (
  message_id text primary key,
  sender text,
  subject text,
  received_at timestamptz,
  status text not null default 'processed'
    check (status in ('processed', 'ignored', 'error')),
  listings_found integer not null default 0,
  error_message text,
  processed_at timestamptz not null default now()
);

create index email_ingestion_messages_processed_at_idx
  on public.email_ingestion_messages (processed_at desc);

alter table public.incoming_listings enable row level security;
alter table public.email_ingestion_messages enable row level security;

create policy "authenticated select incoming_listings"
  on public.incoming_listings
  for select
  to authenticated
  using (true);

create policy "authenticated insert incoming_listings"
  on public.incoming_listings
  for insert
  to authenticated
  with check (true);

create policy "authenticated update incoming_listings"
  on public.incoming_listings
  for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated delete incoming_listings"
  on public.incoming_listings
  for delete
  to authenticated
  using (true);

create policy "authenticated select email_ingestion_messages"
  on public.email_ingestion_messages
  for select
  to authenticated
  using (true);

