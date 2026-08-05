-- Suddivisione immobiliare di Bitonto in 10 zone numerate.
-- I bordi adiacenti condividono gli stessi vertici e seguono, dove possibile,
-- le principali arterie stradali visibili nella cartografia.

alter table public.internal_zones
  add column if not exists zone_number smallint;

alter table public.internal_zones
  drop constraint if exists internal_zones_zone_number_check;

alter table public.internal_zones
  add constraint internal_zones_zone_number_check
  check (zone_number is null or zone_number between 1 and 99);

create unique index if not exists internal_zones_zone_number_idx
  on public.internal_zones (zone_number)
  where zone_number is not null;

create temporary table _bitonto_zone_seed (
  zone_number smallint primary key,
  match_names text[] not null,
  name text not null,
  description text not null,
  landmarks jsonb not null,
  aliases jsonb not null,
  associated_streets jsonb not null,
  color text not null,
  geometry jsonb not null
) on commit drop;

insert into _bitonto_zone_seed values
  (1, array['centro storico'], 'Centro Storico',
    'Nucleo antico e area immediatamente intorno alla Concattedrale.',
    '["Concattedrale di Bitonto", "Centro antico"]',
    '["Borgo antico", "Centro storico"]',
    '["Via Solferino", "Piazza Cattedrale"]', '#d94b43',
    $geo${"type":"Polygon","coordinates":[[
      [16.68845,41.10785],[16.69060,41.10805],[16.69205,41.10745],
      [16.69265,41.10645],[16.69135,41.10500],[16.68920,41.10475],
      [16.68755,41.10575],[16.68725,41.10695],[16.68845,41.10785]
    ]]}$geo$),
  (2, array['centro'], 'Centro',
    'Fascia centrale moderna attorno al nucleo storico.',
    '["Area commerciale centrale", "Piazza Marconi"]',
    '["Zona Centro", "Centro moderno"]',
    '["Via Giacomo Matteotti", "Via della Repubblica Italiana", "Via Giuseppe Verdi"]', '#ed8a19',
    $geo${"type":"Polygon","coordinates":[[
      [16.6837095,41.1101436],[16.6888702,41.1098363],
      [16.6914984,41.1127219],[16.6924675,41.1121912],[16.6937704,41.1114678],
      [16.6942788,41.1111928],[16.6948894,41.1111968],[16.6956379,41.1113047],
      [16.6963660,41.1115526],[16.6978900,41.1121798],[16.6989795,41.1097055],
      [16.6993116,41.1084526],[16.6990000,41.1060000],[16.6950000,41.1035000],
      [16.6888146,41.1039698],[16.6868530,41.1060458],
      [16.6848000,41.1080000],[16.6837095,41.1101436]
    ],[
      [16.68845,41.10785],[16.68725,41.10695],[16.68755,41.10575],
      [16.68920,41.10475],[16.69135,41.10500],[16.69265,41.10645],
      [16.69205,41.10745],[16.69060,41.10805],[16.68845,41.10785]
    ]]}$geo$),
  (3, array['zona villa'], 'Zona Villa',
    'Area intorno alla Villa Comunale Giovanni XXIII.',
    '["Villa Comunale Giovanni XXIII"]',
    '["Villa", "Zona Villa Comunale"]',
    '["Via Quattro Novembre", "Via Generale Francesco Planelli", "Via Dante Alighieri"]', '#5b9f58',
    $geo${"type":"Polygon","coordinates":[[
      [16.6948894,41.1111968],[16.6950569,41.1118497],[16.6944544,41.1121770],
      [16.6938292,41.1125166],[16.6931629,41.1128717],[16.6924024,41.1132770],
      [16.6917567,41.1136167],[16.6978905,41.1175404],[16.7012666,41.1134719],
      [16.7001694,41.1077744],[16.6993116,41.1084526],[16.6989795,41.1097055],
      [16.6978900,41.1121798],[16.6963660,41.1115526],[16.6956379,41.1113047],
      [16.6948894,41.1111968]
    ]]}$geo$),
  (4, array['zona stazione','stazione'], 'Zona Stazione',
    'Area della stazione e dell''asse ferroviario.',
    '["Stazione di Bitonto"]',
    '["Stazione", "Zona FS"]',
    '["Viale Italia", "Viale Europa", "Via Giacomo Matteotti", "Via Ammiraglio Vacca"]', '#3b82c4',
    $geo${"type":"Polygon","coordinates":[[
      [16.6680000,41.1120000],[16.6721111,41.1175388],[16.6736618,41.1168336],
      [16.6758510,41.1158676],[16.6781412,41.1149566],[16.6807478,41.1143678],
      [16.6848704,41.1130525],[16.6857412,41.1123485],[16.6863191,41.1118745],
      [16.6871903,41.1111638],[16.6878768,41.1106185],[16.6888702,41.1098363],
      [16.6837095,41.1101436],[16.6758830,41.1106407],[16.6686975,41.1110859],
      [16.6680000,41.1120000]
    ]]}$geo$),
  (5, array['zona santi medici'], 'Zona Santi Medici',
    'Area intorno alla Basilica dei Santi Medici.',
    '["Basilica dei Santi Medici"]',
    '["Santi Medici", "SS. Medici"]',
    '["Via Patierno", "Via Dante Alighieri", "Via Giacomo Matteotti"]', '#7652b5',
    $geo${"type":"Polygon","coordinates":[[
      [16.6848704,41.1130525],[16.6905263,41.1156606],[16.6917744,41.1160495],
      [16.6932446,41.1163866],[16.6937834,41.1165168],[16.6963513,41.1170913],
      [16.6978905,41.1175404],[16.6917567,41.1136167],[16.6924024,41.1132770],
      [16.6931629,41.1128717],[16.6938292,41.1125166],[16.6944544,41.1121770],
      [16.6950569,41.1118497],[16.6948894,41.1111968],[16.6942788,41.1111928],
      [16.6937704,41.1114678],[16.6924675,41.1121912],[16.6914984,41.1127219],
      [16.6888702,41.1098363],[16.6878768,41.1106185],[16.6871903,41.1111638],
      [16.6863191,41.1118745],[16.6857412,41.1123485],[16.6848704,41.1130525]
    ]]}$geo$),
  (6, array['zona ospedale / hospice','zona ospedale'], 'Zona Ospedale / Hospice',
    'Area nord attorno all''Hospice Aurelio Marena e agli assi di uscita.',
    '["Hospice Aurelio Marena"]',
    '["Ospedale", "Hospice", "Zona Ospedale"]',
    '["Via Patierno", "SP88"]', '#2ba5a4',
    $geo${"type":"Polygon","coordinates":[[
      [16.6905263,41.1156606],[16.6885000,41.1245000],[16.7010000,41.1235000],
      [16.7065000,41.1195000],[16.7012666,41.1134719],[16.6978905,41.1175404],
      [16.6963513,41.1170913],[16.6937834,41.1165168],[16.6932446,41.1163866],
      [16.6917744,41.1160495],[16.6905263,41.1156606]
    ]]}$geo$),
  (7, array['zona togliatti / ulivi'], 'Zona Togliatti / Ulivi',
    'Fascia residenziale nord-est lungo Togliatti e il quartiere Ulivi.',
    '["Farmacia degli Ulivi"]',
    '["Togliatti", "Ulivi", "Zona Ulivi"]',
    '["Via Palmiro Togliatti", "Via Generale Francesco Planelli", "Via Ugo La Malfa", "Via Enrico Berlinguer"]', '#d65388',
    $geo${"type":"Polygon","coordinates":[[
      [16.7012666,41.1134719],[16.7065000,41.1195000],[16.7100000,41.1165000],
      [16.7100000,41.1045000],[16.7001694,41.1077744],[16.7012666,41.1134719]
    ]]}$geo$),
  (8, array['zona traiana'], 'Zona Traiana',
    'Area occidentale e sud-occidentale lungo l''asse Traiana.',
    '["Cimitero Comunale"]',
    '["Traiana", "Zona Ovest"]',
    '["Via Traiana", "Via Ammiraglio Vacca", "SP231"]', '#9a704b',
    $geo${"type":"Polygon","coordinates":[[
      [16.6680000,41.1120000],[16.6686975,41.1110859],
      [16.6758830,41.1106407],[16.6837095,41.1101436],[16.6848000,41.1080000],
      [16.6868530,41.1060458],[16.6841983,41.1021642],[16.6770000,41.1000000],
      [16.6680000,41.1030000],[16.6680000,41.1120000]
    ]]}$geo$),
  (9, array['zona sud / megra'], 'Zona Sud / Megra',
    'Fascia meridionale sotto il centro e lungo Via Megra.',
    '["Asse meridionale di Bitonto"]',
    '["Sud", "Megra", "Zona Sud"]',
    '["Via Megra", "Via Crocifisso", "SP231"]', '#d4a80b',
    $geo${"type":"Polygon","coordinates":[[
      [16.6680000,41.1030000],[16.6770000,41.1000000],[16.6841983,41.1021642],
      [16.6868530,41.1060458],[16.6888146,41.1039698],[16.6950000,41.1035000],
      [16.6990000,41.1060000],[16.6993116,41.1084526],
      [16.7001694,41.1077744],[16.7100000,41.1045000],[16.7075000,41.1000000],
      [16.6990000,41.0980000],[16.6790000,41.0985000],[16.6680000,41.1030000]
    ]]}$geo$),
  (10, array['zona artigianale / nord-ovest','zona industriale'], 'Zona Artigianale / Nord-Ovest',
    'Area artigianale e commerciale nel quadrante nord-occidentale.',
    '["Zona Artigianale di Bitonto"]',
    '["Zona industriale", "Artigianale", "Nord-Ovest"]',
    '["Viale Europa", "Viale Italia", "SP88"]', '#66758a',
    $geo${"type":"Polygon","coordinates":[[
      [16.6680000,41.1120000],[16.6680000,41.1230000],[16.6790000,41.1245000],
      [16.6885000,41.1245000],[16.6905263,41.1156606],[16.6848704,41.1130525],
      [16.6807478,41.1143678],[16.6781412,41.1149566],[16.6758510,41.1158676],
      [16.6736618,41.1168336],[16.6721111,41.1175388],[16.6680000,41.1120000]
    ]]}$geo$);

do $$
declare
  seed _bitonto_zone_seed%rowtype;
  target_id uuid;
begin
  for seed in select * from _bitonto_zone_seed order by zone_number loop
    target_id := null;
    select zone.id into target_id
    from public.internal_zones zone
    where zone.zone_number = seed.zone_number
       or lower(trim(zone.name)) = any(seed.match_names)
    order by
      case when zone.zone_number = seed.zone_number then 0 else 1 end,
      (select count(*) from public.request_zones link where link.zone_id = zone.id) desc,
      (select count(*) from public.portfolio_properties property where property.internal_zone_id = zone.id) desc
    limit 1;

    if target_id is null then
      insert into public.internal_zones (
        zone_number, name, description, landmarks, aliases,
        associated_streets, color, geometry, is_active
      ) values (
        seed.zone_number, seed.name, seed.description, seed.landmarks, seed.aliases,
        seed.associated_streets, seed.color, seed.geometry, true
      );
    else
      update public.internal_zones
      set zone_number = seed.zone_number,
          name = seed.name,
          description = seed.description,
          landmarks = seed.landmarks,
          aliases = seed.aliases,
          associated_streets = seed.associated_streets,
          color = seed.color,
          geometry = seed.geometry,
          is_active = true,
          updated_at = now()
      where id = target_id;
    end if;
  end loop;
end $$;

-- Rimuove soltanto vecchie zone di prova non collegate a richieste o immobili.
delete from public.internal_zones zone
where zone.zone_number is null
  and lower(trim(zone.name)) in ('centro storico', 'cimitero', 'stazione', 'zona san francesco')
  and not exists (select 1 from public.request_zones link where link.zone_id = zone.id)
  and not exists (select 1 from public.portfolio_properties property where property.internal_zone_id = zone.id);

comment on column public.internal_zones.zone_number is
  'Numero operativo della suddivisione immobiliare di Bitonto mostrato nella mappa matching.';
