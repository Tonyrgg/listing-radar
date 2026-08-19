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
  'momento-casa-bitonto',
  'Momento Casa',
  'momento',
  'https://www.trovacasa.it/agenzie-immobiliari/momento-casa-bitonto-tc-96100',
  'https://www.trovacasa.it/agenzie-immobiliari/momento-casa-bitonto-tc-96100/case-in-vendita',
  '{"requestDelayMs": 1000, "missingHealthyRunThreshold": 2, "sourceKind": "public_portal", "portal": "trovacasa", "portalPublisherId": 96100}'::jsonb
)
on conflict (slug) do update
set name = excluded.name,
    adapter_key = excluded.adapter_key,
    website_url = excluded.website_url,
    inventory_url = excluded.inventory_url,
    settings = excluded.settings,
    updated_at = now();

commit;
