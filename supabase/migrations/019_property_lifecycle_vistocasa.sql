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
  'vistocasa-bitonto',
  'Vistocasa Bitonto',
  'vistocasa',
  'https://www.vistocasa.com',
  'https://www.vistocasa.com/it/ricerca.aspx?catalogoproduttoriid=56',
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
