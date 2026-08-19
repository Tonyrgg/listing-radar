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
  'garofalo-immobiliare-bitonto',
  'Garofalo Immobiliare',
  'garofalo',
  'https://garofaloimmobiliare.com',
  'https://garofaloimmobiliare.com/immobili',
  '{"requestDelayMs": 1000, "missingHealthyRunThreshold": 2, "sourceKind": "agency_website", "inventoryMechanism": "flazio_public_api"}'::jsonb
)
on conflict (slug) do update
set name = excluded.name,
    adapter_key = excluded.adapter_key,
    website_url = excluded.website_url,
    inventory_url = excluded.inventory_url,
    settings = excluded.settings,
    updated_at = now();

commit;
