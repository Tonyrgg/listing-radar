-- Separa definitivamente:
-- - map_areas: aree operative assegnate agli agenti per ricerca e contatto;
-- - internal_zones: quartieri e zone immobiliari usati da immobili, richieste e matching.

alter table public.internal_zones
  add column if not exists geometry jsonb,
  add column if not exists color text not null default '#5fbf7a';

-- I collegamenti creati in precedenza erano semanticamente errati: un'area di
-- lavoro di un agente non rappresenta il quartiere di un immobile.
alter table public.internal_zones
  drop constraint if exists internal_zones_map_area_id_fkey;

drop index if exists public.internal_zones_map_area_id_idx;

alter table public.internal_zones
  drop column if exists map_area_id;

comment on table public.map_areas is
  'Aree operative assegnate agli agenti per ricerca, chiamate e lavoro sul territorio.';

comment on table public.internal_zones is
  'Zone immobiliari usate per localizzare immobili, preferenze delle richieste e matching.';

comment on column public.internal_zones.geometry is
  'Perimetro GeoJSON della zona immobiliare, indipendente dalle aree operative degli agenti.';
