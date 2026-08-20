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
  'futura-immobiliare-bitonto',
  'Futura Immobiliare Bitonto',
  'futura',
  'https://www.futurabitonto.it',
  'https://www.futurabitonto.it/web/immobili.asp?language=ita&pagref=88306&tipo_contratto=V',
  '{"requestDelayMs": 1000, "missingHealthyRunThreshold": 2, "sourceKind": "agency_website"}'::jsonb
)
on conflict (slug) do update
set name = excluded.name,
    adapter_key = excluded.adapter_key,
    website_url = excluded.website_url,
    inventory_url = excluded.inventory_url,
    settings = excluded.settings,
    updated_at = now();

commit;
