-- Idempotent static seed for a new project. No production/personal records.

begin;
-- Idempotent static seed for a new project. No production/personal records.



-- -----------------------------------------------------------------------------
-- Derived from 0021_map_zones.sql (static agents)
-- -----------------------------------------------------------------------------
insert into public.agents (name, color)
select 'Tony', '#2563eb'
where not exists (
  select 1 from public.agents where lower(name) = lower('Tony')
);

insert into public.agents (name, color)
select 'Agente 2', '#16a34a'
where not exists (
  select 1 from public.agents where lower(name) = lower('Agente 2')
);


-- -----------------------------------------------------------------------------
-- Derived from 0041_requests_matching.sql (feature definitions and matching config)
-- -----------------------------------------------------------------------------
insert into public.feature_definitions (key, label, category, field_type, sort_order)
values
  ('elevator','Ascensore','accessibilità','boolean',10),
  ('balcony','Balcone','esterni','boolean',20),
  ('terrace','Terrazzo','esterni','boolean',30),
  ('garden','Giardino','esterni','boolean',40),
  ('veranda','Veranda','esterni','boolean',50),
  ('courtyard','Cortile','esterni','boolean',60),
  ('garage','Box','pertinenze','boolean',70),
  ('parking_space','Posto auto','pertinenze','boolean',80),
  ('cellar','Cantina','pertinenze','boolean',90),
  ('storage_room','Deposito','pertinenze','boolean',100),
  ('independent_entrance','Ingresso indipendente','accesso','boolean',110),
  ('eat_in_kitchen','Cucina abitabile','interni','boolean',120),
  ('closet','Ripostiglio','interni','boolean',130),
  ('laundry_room','Lavanderia','interni','boolean',140),
  ('second_bathroom','Secondo bagno','interni','boolean',150),
  ('furnished','Arredato','dotazioni','boolean',160),
  ('accessible','Accessibile','accessibilità','boolean',170),
  ('rented_property_accepted','Immobile locato accettato','disponibilità','boolean',180),
  ('ground_floor_accepted','Piano terra accettato','piano','boolean',190),
  ('basement_accepted','Seminterrato accettato','piano','boolean',200)
on conflict (key) do nothing;

insert into public.app_settings (key, value)
values ('matching_config', '{
  "thresholds":{"compatible":85,"almostCompatible":65,"weak":40},
  "budgetTolerance":{"near":0.05,"weak":0.15},
  "commercialSqm":{"minimumFactor":1.10,"maximumFactor":1.20},
  "weights":{"propertyType":15,"zone":20,"budget":20,"internalSqm":15,"rooms":10,"floor":5,"condition":5,"availability":5}
}'::jsonb)
on conflict (key) do nothing;


-- -----------------------------------------------------------------------------
-- Derived from 013_bitonto_property_zone_system.sql (15 zone geometries)
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- Derived from 014_property_zone_metadata.sql (15 zone metadata)
-- -----------------------------------------------------------------------------
with zone_metadata (
  zone_number, id, name, description, color,
  associated_streets, aliases, landmarks
) as (values
  (1, 'bde7477d-a226-43e2-a24e-9b06123caf2e'::uuid,
    'Centro Storico',
    'Nucleo antico di Bitonto raccolto intorno alla Concattedrale, con tessuto edilizio storico, corti e viabilità prevalentemente pedonale.',
    '#e24a3b',
    '["Piazza Cattedrale", "Piazza Cavour", "Via Solferino", "Via Castelfidardo", "Via Sedile", "Via Vincenzo Rogadeo", "Via San Luca"]'::jsonb,
    '["Centro antico", "Borgo antico", "Città vecchia"]'::jsonb,
    '["Concattedrale di Maria Santissima Assunta", "Teatro Comunale Tommaso Traetta", "Galleria Nazionale Devanna", "Museo Diocesano", "Biblioteca Comunale Eustachio Rogadeo"]'::jsonb),

  (2, 'd41616cb-df7d-4644-b182-2a345165f806'::uuid,
    'Centro',
    'Fascia centrale moderna e commerciale che circonda il centro storico, servita dai principali corsi cittadini e dai servizi pubblici.',
    '#f28e2b',
    '["Corso Vittorio Emanuele II", "Piazza Aldo Moro", "Piazza Marconi", "Via Giacomo Matteotti", "Via della Repubblica Italiana", "Via Giuseppe Verdi", "Via Ammiraglio Vacca"]'::jsonb,
    '["Centro moderno", "Zona centrale", "Centro città"]'::jsonb,
    '["Municipio di Bitonto", "Monumento ai Caduti", "Piazza Marconi", "Poste Italiane", "Piazza Aldo Moro"]'::jsonb),

  (3, 'f5e5cbd9-48ce-4ce3-9a14-693adc1917c5'::uuid,
    'Zona Villa',
    'Quartiere residenziale a nord-est del centro, organizzato intorno alla Villa Comunale e a Piazza San Leone.',
    '#59a14f',
    '["Via Generale Francesco Planelli", "Via Palmiro Togliatti", "Via Donato Piepoli", "Via 25 Aprile 1945", "Via Cesare Battisti", "Piazza San Leone"]'::jsonb,
    '["Villa", "Villa Comunale", "Zona San Leone"]'::jsonb,
    '["Villa Comunale Giovanni XXIII", "Piazza San Leone", "Parrocchia San Leone Magno", "Giardini Sorelle Saracino"]'::jsonb),

  (4, 'd7ab3544-c080-4344-b141-df0f1af4854b'::uuid,
    'Zona Stazione',
    'Settore occidentale attestato sulla stazione ferroviaria e su Via Ammiraglio Vacca, con accesso rapido al centro e alla zona artigianale.',
    '#377eb8',
    '["Via Ammiraglio Vacca", "Via Ancona", "Via Antica della Chinisa", "Via Giuseppe Capaldi", "Via Nicola Angelini", "Viale Italia"]'::jsonb,
    '["Stazione", "Zona FS", "Quartiere Stazione"]'::jsonb,
    '["Stazione di Bitonto", "Bar Stazione", "Farmacia Donadio", "Centro Medico SMS"]'::jsonb),

  (5, '93c50d24-5a3b-4d20-ad4a-926bdca84a15'::uuid,
    'Zona Santi Medici',
    'Area residenziale e di servizi intorno alla Basilica dei Santi Medici e a Piazza Monsignor Aurelio Marena.',
    '#7b5dc7',
    '["Via Dante Alighieri", "Via della Repubblica Italiana", "Via Carrara", "Piazza Monsignor Aurelio Marena", "Via Santuario", "Via Giacomo Matteotti"]'::jsonb,
    '["Santi Medici", "SS. Medici", "Zona Basilica"]'::jsonb,
    '["Basilica dei Santi Medici", "Museo Archeologico De Palo-Ungaro", "Scuola Media Carmine Sylos", "Primo Circolo Nicola Fornelli"]'::jsonb),

  (6, '07874ea3-ea40-4b3d-b5cf-1396e43078dd'::uuid,
    'Zona Ospedale / Hospice',
    'Quadrante nord lungo Via Patierno, riconoscibile per l''Hospice Aurelio Marena e gli assi di uscita verso la viabilità provinciale.',
    '#18a3a7',
    '["Via Patierno", "Via Fiego", "Prima Traversa Via Patierno", "Vico Giovinazzo", "Strada Provinciale 88"]'::jsonb,
    '["Zona Ospedale", "Hospice", "Zona Patierno"]'::jsonb,
    '["Hospice Aurelio Marena", "Fondazione Opera Santi Medici", "Strada Provinciale 88"]'::jsonb),

  (7, '6bdc519c-9ce9-484c-bea9-716d96401af2'::uuid,
    'Zona Est',
    'Ampio comparto residenziale nord-orientale lungo Via Palmiro Togliatti e Via delle Fornaci, fino alla direttrice per Santo Spirito.',
    '#d84b87',
    '["Via Palmiro Togliatti", "Via delle Fornaci", "Via Sandro Pertini", "Via Falcone e Borsellino", "Via Tenente Domenico Modugno", "Strada Provinciale Bitonto-Santo Spirito"]'::jsonb,
    '["Togliatti", "Zona Ulivi", "Quartiere Ulivi", "Nord-Est"]'::jsonb,
    '["Campo Sportivo Mario Licinio", "Orto Sociale", "Tenuta De Lucci", "Asse Bitonto-Santo Spirito"]'::jsonb),

  (8, 'f0e9407d-e8e4-43fe-a30d-046b9bb83e2b'::uuid,
    'Zona Traiana',
    'Settore occidentale e sud-occidentale delimitato dall''asse di Via Traiana, con tessuto residenziale e accesso alla SP231.',
    '#9c6b43',
    '["Via Traiana", "Via Palombaio", "Via Michelangelo", "Via Chiancariello", "Via Gorizia", "Piazza Martin Luther King", "SP231"]'::jsonb,
    '["Traiana", "Zona Ovest", "Quartiere Traiana"]'::jsonb,
    '["Cimitero Comunale", "Piazza Caduti del Terrorismo", "Chiesa di Sant''Andrea Apostolo", "SP231"]'::jsonb),

  (9, '529908dd-8ba9-4b72-90c2-d29a479c5254'::uuid,
    'Zona Sud / Megra',
    'Fascia meridionale della città lungo Via Megra e Via Modugno, con accessi alla SP231 e agli assi verso Palo del Colle.',
    '#d4a514',
    '["Via Megra", "Via Modugno", "Via Burrone", "Via Chiancariello", "Via Palo del Colle", "SP231"]'::jsonb,
    '["Zona Sud", "Megra", "Sud-Megra"]'::jsonb,
    '["Liceo Classico Carmine Sylos", "Santa Maria del Popolo", "Asse SP231", "Via Megra"]'::jsonb),

  (10, '47bfbe4b-9e74-4614-bab7-182f294e4647'::uuid,
    'Zona Artigianale / Nord-Ovest',
    'Polo produttivo e commerciale nel quadrante nord-occidentale, servito dai viali principali e dalla viabilità per l''aeroporto.',
    '#64748b',
    '["Viale delle Nazioni", "Viale Europa", "Viale Giuseppe Lazzati", "Viale Italia", "Via Francia", "Via Patierno"]'::jsonb,
    '["Zona Artigianale", "Zona industriale", "Nord-Ovest", "Area produttiva"]'::jsonb,
    '["Zona Artigianale di Bitonto", "Comando Polizia Locale", "Fondazione Giovanni XXIII", "Fermata Bitonto Centrale"]'::jsonb),

  (11, 'bda9b75c-5748-441d-996d-f25349d165dd'::uuid,
    'Zona Expert',
    'Comparto residenziale e commerciale a nord-est, tra l''asse dei Santi Medici e Via Palmiro Togliatti.',
    '#315ac4',
    '["Via Giovanna da Durazzo", "Via Papa Giovanni XXIII", "Via Tenente Domenico Modugno", "Via John Fitzgerald Kennedy", "Via Donato Piepoli"]'::jsonb,
    '["Expert", "Zona commerciale Expert", "Zona Giovanni XXIII"]'::jsonb,
    '["Expert", "Unieuro", "Fermata Bitonto SS Medici", "Farmacia Manfreda"]'::jsonb),

  (12, 'b135fe31-62e6-4258-a070-05ad2fbc835f'::uuid,
    'Zona Scuole',
    'Polo scolastico e residenziale orientale concentrato tra Via Ugo La Malfa, Via Berlinguer e Via Francesco de Biase.',
    '#83a62f',
    '["Via Ugo La Malfa", "Via Enrico Berlinguer", "Via Francesco de Biase", "Via Generale Francesco Planelli", "Via Pietro Nenni", "Piazza Unità d''Italia"]'::jsonb,
    '["Scuole", "Polo scolastico", "Zona La Malfa"]'::jsonb,
    '["IISS Volta-De Gemmis", "ITES Vitale Giordano", "Liceo Galileo Galilei", "Penny Market"]'::jsonb),

  (13, '7f9688ea-cbdc-4e77-a088-19d374d5d751'::uuid,
    'Borgo San Francesco',
    'Quartiere residenziale sud-orientale tra Borgo San Francesco, Via Crocifisso e l''asse di Via Generale Planelli.',
    '#b5528c',
    '["Via Borgo San Francesco", "Via Crocifisso", "Via Generale Francesco Planelli", "Via Burrone", "Via Calatafimi", "Via Francesco de Biase"]'::jsonb,
    '["San Francesco", "Borgo S. Francesco", "Zona Crocifisso"]'::jsonb,
    '["Borgo San Francesco", "Chiesa del Crocifisso", "Piazza Monsignor Francesco Fornelli", "Chiesa di San Matteo"]'::jsonb),

  (14, 'e0624fda-989f-4462-8892-9bb4fe123047'::uuid,
    'Palombaio',
    'Frazione di Bitonto a ovest del capoluogo, con nucleo abitato raccolto intorno a Piazza Milite Ignoto e collegamento sulla SP89.',
    '#008fbd',
    '["Piazza Milite Ignoto", "Strada Provinciale Ruvo-Palombaio", "Via Senatore Sylos", "Via Valente", "Via Giacomo Puccini", "Via Casina Dentro"]'::jsonb,
    '["Frazione Palombaio", "Centro Palombaio"]'::jsonb,
    '["Centro abitato di Palombaio", "Farmacia Valente", "Delegazione comunale", "Tenuta dei Ruggero"]'::jsonb),

  (15, '4fc4027d-bfbe-4123-9b6d-cff113f3a5af'::uuid,
    'Mariotto',
    'Frazione di Bitonto posta a ovest di Palombaio, collegata al capoluogo dalla SP89 e alla viabilità verso Terlizzi e Mellitto.',
    '#8c3b78',
    '["Strada Provinciale Bitonto-Mariotto-Mellitto", "Strada Provinciale Terlizzi-Mariotto", "Via Cavour", "Via Giuseppe Garibaldi", "Via Fontana", "Via Michelangelo"]'::jsonb,
    '["Frazione Mariotto", "Mariotto centro"]'::jsonb,
    '["Centro abitato di Mariotto", "Farmacia Dott. Centrone", "Delegazione comunale", "Stazione di servizio Esso"]'::jsonb)
),
missing_zones as (
  insert into public.internal_zones (
    id, zone_number, name, description, color,
    associated_streets, aliases, landmarks, is_active
  )
  select
    metadata.id, metadata.zone_number, metadata.name, metadata.description, metadata.color,
    metadata.associated_streets, metadata.aliases, metadata.landmarks, true
  from zone_metadata metadata
  where not exists (
    select 1
    from public.internal_zones existing
    where existing.id = metadata.id
       or existing.zone_number = metadata.zone_number
  )
  returning id
)
update public.internal_zones zone
set zone_number = metadata.zone_number,
    name = metadata.name,
    description = metadata.description,
    color = metadata.color,
    associated_streets = metadata.associated_streets,
    aliases = metadata.aliases,
    landmarks = metadata.landmarks,
    updated_at = now()
from zone_metadata metadata
where zone.id = metadata.id
   or (
     zone.zone_number = metadata.zone_number
     and not exists (
       select 1 from public.internal_zones fixed where fixed.id = metadata.id
     )
   );

do $$
declare
  configured_count integer;
begin
  select count(*) into configured_count
  from public.internal_zones
  where zone_number between 1 and 15;

  if configured_count <> 15 then
    raise exception 'Aggiornamento metadati incompleto: configurate % zone su 15.', configured_count;
  end if;

  if not exists (select 1 from public.internal_zones where zone_number = 14 and lower(name) = 'palombaio')
     or not exists (select 1 from public.internal_zones where zone_number = 15 and lower(name) = 'mariotto') then
    raise exception 'Numerazione finale non valida: Palombaio e Mariotto devono essere le ultime zone.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- Derived from 016_property_lifecycle_v2_foundation.sql (initial agencies)
-- -----------------------------------------------------------------------------
insert into public.agencies (
  slug,
  name,
  adapter_key,
  website_url,
  inventory_url,
  settings
)
values
  (
    'iconacasa-bitonto',
    'Iconacasa Bitonto — Piazza Aldo Moro',
    'iconacasa',
    'https://www.iconacasa.com',
    'https://www.iconacasa.com/index.php/agenzie/companyproperties/13-iconacasa-bitonto-piazza-aldo-moro',
    '{"requestDelayMs": 1000, "missingHealthyRunThreshold": 2}'::jsonb
  ),
  (
    'puntocasa-bitonto',
    'PuntoCasa Bitonto',
    'puntocasa',
    'https://www.puntocasagroup.it',
    'https://www.puntocasagroup.it/acquista-la-tua-casa-2/',
    '{"requestDelayMs": 1000, "missingHealthyRunThreshold": 2}'::jsonb
  )
on conflict (slug) do update
set name = excluded.name,
    adapter_key = excluded.adapter_key,
    website_url = excluded.website_url,
    inventory_url = excluded.inventory_url,
    settings = excluded.settings,
    updated_at = now();


-- -----------------------------------------------------------------------------
-- Derived from 019_property_lifecycle_vistocasa.sql (agency seed)
-- -----------------------------------------------------------------------------

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



-- -----------------------------------------------------------------------------
-- Derived from 020_property_lifecycle_studi_santi.sql (agency seed)
-- -----------------------------------------------------------------------------

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



-- -----------------------------------------------------------------------------
-- Derived from 021_property_lifecycle_ad_maiora.sql (agency seed)
-- -----------------------------------------------------------------------------

insert into public.agencies (
  slug,
  name,
  adapter_key,
  website_url,
  inventory_url,
  settings
)
values (
  'ad-maiora-bitonto',
  'Ad Maiora Immobiliare',
  'admaiora',
  'https://www.admaioraimmobiliare.it',
  'https://www.admaioraimmobiliare.it/vendita/',
  '{"requestDelayMs": 1000, "missingHealthyRunThreshold": 2}'::jsonb
)
on conflict (slug) do update
set name = excluded.name,
    adapter_key = excluded.adapter_key,
    website_url = excluded.website_url,
    inventory_url = excluded.inventory_url,
    settings = excluded.settings,
    updated_at = now();



-- -----------------------------------------------------------------------------
-- Derived from 022_property_lifecycle_studio_casa.sql (agency seed)
-- -----------------------------------------------------------------------------

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



-- -----------------------------------------------------------------------------
-- Derived from 023_property_lifecycle_futura.sql (agency seed)
-- -----------------------------------------------------------------------------

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



-- -----------------------------------------------------------------------------
-- Derived from 024_property_lifecycle_garofalo.sql (agency seed)
-- -----------------------------------------------------------------------------

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



-- -----------------------------------------------------------------------------
-- Derived from 025_property_lifecycle_trio.sql (agency seed)
-- -----------------------------------------------------------------------------

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



-- -----------------------------------------------------------------------------
-- Derived from 026_property_lifecycle_momento.sql (agency seed)
-- -----------------------------------------------------------------------------

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


insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'property-lifecycle-visuals',
  'property-lifecycle-visuals',
  false,
  1048576,
  array['image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
