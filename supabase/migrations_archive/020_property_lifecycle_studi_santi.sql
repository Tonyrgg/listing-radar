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
  'studi-santi-bitonto',
  'Studi Santi Immobiliare',
  'studisanti',
  'https://studisantiimmobiliare.it',
  'https://studisantiimmobiliare.it/sitemap.xml',
  '{"requestDelayMs": 1000, "missingHealthyRunThreshold": 2}'::jsonb
)
on conflict (slug) do update
set name = excluded.name,
    adapter_key = excluded.adapter_key,
    website_url = excluded.website_url,
    inventory_url = excluded.inventory_url,
    settings = excluded.settings,
    updated_at = now();

commit;
