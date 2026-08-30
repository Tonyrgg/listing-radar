-- Lettura dell'archivio V2 in una sola andata e ritorno.
--
-- Ogni elenco di case ricostruiva la stessa scheda con quattro ondate di query
-- in fila: le proprietà, poi gli incarichi di agenzia e le pubblicazioni
-- private, poi le agenzie e le publication, e infine gli snapshot. L'ultima
-- ondata era la più cara: chiedeva fino a duemila snapshot per ogni blocco di
-- settantacinque publication — cioè tutta la storia dei prezzi — per usarne
-- soltanto il più recente. Su mille case significava scaricare decine di
-- migliaia di righe per mostrarne sessanta, a ogni singola visita.
--
-- `lifecycle_property_hydration` fa lo stesso lavoro dentro Postgres e
-- restituisce una riga per casa: le agenzie che la tengono, l'ultimo snapshot,
-- l'ultima pubblicazione privata e quante ne sono ancora attive. La scelta fra
-- snapshot e privato resta in TypeScript, dov'è testata.
--
-- La funzione riceve gli id in POST: sparisce anche il batch da settantacinque,
-- che esisteva solo per non sforare la lunghezza della URI in GET.

-- `agency_listings` si interroga per property_id a ogni idratazione, ma
-- l'indice esisteva solo su (agency_id, state): era una scansione piena.
create index if not exists agency_listings_property_idx
  on public.agency_listings (property_id);

-- Le opportunità si leggono per casa nella scheda e nell'archivio.
create index if not exists opportunities_property_idx
  on public.opportunities (property_id, detected_at desc);

create or replace function public.lifecycle_property_hydration(p_ids uuid[])
returns table (
  property_id uuid,
  agency_refs jsonb,
  latest_snapshot jsonb,
  latest_private jsonb,
  active_private_count integer
)
language sql
stable
as $$
  with wanted as (
    select distinct pid from unnest(p_ids) as elenco(pid)
  ),
  refs as (
    select
      al.property_id as pid,
      jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'slug', a.slug,
          'name', a.name,
          'listingId', al.id,
          'state', al.state,
          'reference', al.agency_reference,
          'firstSeenAt', al.first_seen_at,
          'lastSeenAt', al.last_seen_at
        )
        order by al.last_seen_at desc, al.id
      ) as refs
    from public.agency_listings al
    join public.agencies a on a.id = al.agency_id
    where al.property_id = any(p_ids)
    group by al.property_id
  ),
  snap as (
    select distinct on (al.property_id)
      al.property_id as pid,
      jsonb_build_object(
        'title', s.title,
        'price_amount', s.price_amount,
        'surface_sqm', s.surface_sqm,
        'rooms', s.rooms,
        'observed_at', s.observed_at
      ) as snapshot
    from public.agency_listings al
    join public.publications p on p.agency_listing_id = al.id
    join public.snapshots s on s.publication_id = p.id
    where al.property_id = any(p_ids)
    order by al.property_id, s.observed_at desc
  ),
  priv as (
    select
      pp.property_id as pid,
      (array_agg(
        jsonb_build_object(
          'title', pp.title,
          'price_amount', pp.price_amount,
          'surface_sqm', pp.surface_sqm,
          'rooms', pp.rooms,
          'last_seen_at', pp.last_seen_at
        )
        order by pp.last_seen_at desc, pp.id
      ))[1] as latest,
      (count(*) filter (where pp.state = 'ACTIVE'))::integer as active_count
    from public.private_publications pp
    where pp.property_id = any(p_ids)
    group by pp.property_id
  )
  select
    wanted.pid,
    coalesce(refs.refs, '[]'::jsonb),
    snap.snapshot,
    priv.latest,
    coalesce(priv.active_count, 0)
  from wanted
  left join refs on refs.pid = wanted.pid
  left join snap on snap.pid = wanted.pid
  left join priv on priv.pid = wanted.pid;
$$;

comment on function public.lifecycle_property_hydration(uuid[]) is
  'Idratazione di un elenco di PROPERTY: agenzie, ultimo snapshot, ultima pubblicazione privata e privati attivi, in una sola richiesta.';

grant execute on function public.lifecycle_property_hydration(uuid[]) to authenticated, service_role;

-- «Di chi ti puoi fidare oggi», senza scaricare l'inventario.
--
-- La scheda delle fonti conta gli incarichi per stato, e per farlo si portava
-- a casa una riga per ogni incarico di ogni agenzia, più mille controlli di
-- salute e mille run di sincronizzazione, per tenere di ciascuno soltanto il
-- più recente. È una domanda da tre numeri per agenzia: ora la risponde
-- Postgres, e torna una riga per agenzia.

create or replace function public.lifecycle_agency_overview()
returns table (
  id uuid,
  slug text,
  name text,
  website_url text,
  enabled boolean,
  active_count integer,
  exited_count integer,
  sold_count integer,
  latest_health jsonb,
  latest_run jsonb
)
language sql
stable
as $$
  with conteggi as (
    select
      al.agency_id,
      (count(*) filter (where al.state = 'ACTIVE'))::integer as active_count,
      (count(*) filter (
        where al.state in (
          'EXIT_PENDING',
          'CLOSED_SWITCHED',
          'CLOSED_TO_PRIVATE',
          'CLOSED_WITHDRAWN',
          'OFF_MARKET_NO_SALE_EVIDENCE'
        )
      ))::integer as exited_count,
      (count(*) filter (where al.state = 'CLOSED_SOLD'))::integer as sold_count
    from public.agency_listings al
    group by al.agency_id
  ),
  salute as (
    select distinct on (h.agency_id)
      h.agency_id,
      jsonb_build_object('state', h.state, 'checked_at', h.checked_at) as latest
    from public.adapter_health h
    order by h.agency_id, h.checked_at desc
  ),
  corse as (
    select distinct on (r.agency_id)
      r.agency_id,
      jsonb_build_object(
        'status', r.status,
        'started_at', r.started_at,
        'finished_at', r.finished_at,
        'discovered_count', r.discovered_count,
        'in_scope_count', r.in_scope_count,
        'excluded_count', r.excluded_count,
        'error_count', r.error_count
      ) as latest
    from public.sync_runs r
    order by r.agency_id, r.started_at desc
  )
  select
    a.id,
    a.slug,
    a.name,
    a.website_url,
    a.enabled,
    coalesce(conteggi.active_count, 0),
    coalesce(conteggi.exited_count, 0),
    coalesce(conteggi.sold_count, 0),
    salute.latest,
    corse.latest
  from public.agencies a
  left join conteggi on conteggi.agency_id = a.id
  left join salute on salute.agency_id = a.id
  left join corse on corse.agency_id = a.id
  order by a.name;
$$;

comment on function public.lifecycle_agency_overview() is
  'Riepilogo per agenzia: incarichi contati per stato, ultimo controllo di salute e ultima sincronizzazione.';

grant execute on function public.lifecycle_agency_overview() to authenticated, service_role;

-- Le due letture «più recente per agenzia» reggono su questi ordini.
create index if not exists adapter_health_agency_checked_idx
  on public.adapter_health (agency_id, checked_at desc);

create index if not exists sync_runs_agency_started_idx
  on public.sync_runs (agency_id, started_at desc);

-- I segnaposti del Territorio, già uniti alla loro posizione.
--
-- La mappa chiedeva duemila case e duemila posizioni e le univa nel browser,
-- per poi buttare via ogni casa senza coordinate: due elenchi interi mandati
-- via rete per disegnarne una parte. L'unione la fa Postgres, e torna solo
-- quello che si può davvero mettere sulla mappa.

create or replace function public.map_property_pins()
returns table (
  id uuid,
  address text,
  price_amount numeric,
  surface_sqm numeric,
  latitude double precision,
  longitude double precision,
  raw_text text,
  street_name text,
  street_number text,
  municipality text
)
language sql
stable
as $$
  select
    p.id,
    p.canonical_attributes->>'address',
    case
      when jsonb_typeof(p.canonical_attributes->'priceAmount') = 'number'
      then (p.canonical_attributes->>'priceAmount')::numeric
    end,
    case
      when jsonb_typeof(p.canonical_attributes->'surfaceSqm') = 'number'
      then (p.canonical_attributes->>'surfaceSqm')::numeric
    end,
    l.latitude,
    l.longitude,
    l.raw_text,
    l.street_name,
    l.street_number,
    l.municipality
  from public.properties p
  join public.locations l on l.id = p.primary_location_id
  where p.identity_status <> 'MERGED'
    and l.latitude is not null
    and l.longitude is not null;
$$;

comment on function public.map_property_pins() is
  'Case osservate con una posizione risolta, pronte da disegnare sulla mappa.';

grant execute on function public.map_property_pins() to authenticated, service_role;

-- Quante case somigliano a ogni richiesta.
--
-- La pagina delle richieste si portava a casa tutti gli abbinamenti
-- compatibili — quasi duemila righe, in pagine da mille una dopo l'altra —
-- per contarli per richiesta. È un conteggio: torna una riga per richiesta.

create or replace function public.matching_compatible_counts()
returns table (request_id uuid, compatible_count integer)
language sql
stable
as $$
  select m.request_id, count(*)::integer
  from public.request_property_matches m
  where m.classification = 'compatible'
  group by m.request_id;
$$;

comment on function public.matching_compatible_counts() is
  'Abbinamenti compatibili contati per richiesta.';

grant execute on function public.matching_compatible_counts() to authenticated, service_role;

create index if not exists request_property_matches_classification_idx
  on public.request_property_matches (classification, request_id);
