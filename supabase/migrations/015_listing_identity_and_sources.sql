-- One listings row now represents one physical property. Every portal advert
-- remains available in listing_sources and every observation in snapshots.

alter table public.listings
  add column if not exists property_identity_key text,
  add column if not exists identity_confidence numeric,
  add column if not exists identity_reasons jsonb not null default '[]'::jsonb,
  add column if not exists seller_classification_confidence numeric,
  add column if not exists seller_classification_reasons jsonb not null default '[]'::jsonb;

create index if not exists listings_property_identity_key_idx
  on public.listings (property_identity_key)
  where property_identity_key is not null;

alter table public.listing_sources
  add column if not exists canonical_url text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists price integer,
  add column if not exists sqm integer,
  add column if not exists rooms numeric,
  add column if not exists floor text,
  add column if not exists zone text,
  add column if not exists address_raw text,
  add column if not exists seller_type text check (seller_type in ('private', 'agency', 'unknown')),
  add column if not exists phone text,
  add column if not exists image_urls jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists listing_sources_source_external_id_idx
  on public.listing_sources (source, source_listing_id)
  where source_listing_id is not null;

create index if not exists listing_sources_source_url_idx
  on public.listing_sources (source, url);

-- Previous grouping used broad similarities and could connect unrelated homes
-- transitively. New groups are rebuilt only by the conservative matcher.
update public.listings set duplicate_group_id = null
where duplicate_group_id is not null;

create or replace function public.merge_listing_records(
  target_listing_id uuid,
  duplicate_listing_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_listing_id = duplicate_listing_id then
    return;
  end if;

  update public.listing_snapshots set listing_id = target_listing_id
    where listing_id = duplicate_listing_id;
  update public.listing_sources set listing_id = target_listing_id
    where listing_id = duplicate_listing_id;
  update public.listing_notes set listing_id = target_listing_id
    where listing_id = duplicate_listing_id;
  update public.listing_actions set listing_id = target_listing_id
    where listing_id = duplicate_listing_id;
  update public.incoming_listings set listing_id = target_listing_id
    where listing_id = duplicate_listing_id;
  update public.map_pins set listing_id = target_listing_id
    where listing_id = duplicate_listing_id;

  delete from public.listings where id = duplicate_listing_id;
end;
$$;

revoke all on function public.merge_listing_records(uuid, uuid) from public;
grant execute on function public.merge_listing_records(uuid, uuid) to service_role;
