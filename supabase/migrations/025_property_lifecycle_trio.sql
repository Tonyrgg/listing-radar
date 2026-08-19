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
  'trio-casa-bitonto',
  'Trio Casa S.A.S.',
  'trio',
  'https://www.trovacasa.it/agenzie-immobiliari/trio-casa-s-a-s-bitonto-tc-92459',
  'https://www.trovacasa.it/agenzie-immobiliari/trio-casa-s-a-s-bitonto-tc-92459/case-in-vendita',
  '{"requestDelayMs": 1000, "missingHealthyRunThreshold": 2, "sourceKind": "public_portal", "portal": "trovacasa", "portalPublisherId": 92459}'::jsonb
)
on conflict (slug) do update
set name = excluded.name,
    adapter_key = excluded.adapter_key,
    website_url = excluded.website_url,
    inventory_url = excluded.inventory_url,
    settings = excluded.settings,
    updated_at = now();

commit;
