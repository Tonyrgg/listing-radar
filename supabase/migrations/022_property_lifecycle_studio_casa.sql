begin;

insert into public.agencies (
  slug,
  name,
  adapter_key,
  website_url,
  inventory_url,
  settings
)
values (
  'studio-casa-bitonto',
  'Studio Casa Bitonto',
  'studiocasa',
  'https://www.casa.it/agenzie/studio-casa-bitonto-1098672/',
  'https://www.casa.it/srp/?pId=1098672',
  '{"requestDelayMs": 1000, "missingHealthyRunThreshold": 2, "sourceKind": "public_portal"}'::jsonb
)
on conflict (slug) do update
set name = excluded.name,
    adapter_key = excluded.adapter_key,
    website_url = excluded.website_url,
    inventory_url = excluded.inventory_url,
    settings = excluded.settings,
    updated_at = now();

commit;
