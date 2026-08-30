-- Completa numerazione e metadati delle zone immobiliari disegnate manualmente.
-- Preserva la geometry esistente e riusa le righe già presenti per numero o UUID.

begin;

alter table public.internal_zones
  drop constraint if exists internal_zones_zone_number_check;

alter table public.internal_zones
  add constraint internal_zones_zone_number_check
  check (zone_number is null or zone_number between 1 and 99);

-- Libera prima i numeri precedenti, compresi quelli rimasti su record storici,
-- per evitare collisioni con l'indice univoco durante la rinumerazione atomica.
update public.internal_zones
set zone_number = null
where id = any(array[
  'bde7477d-a226-43e2-a24e-9b06123caf2e',
  'd41616cb-df7d-4644-b182-2a345165f806',
  'f5e5cbd9-48ce-4ce3-9a14-693adc1917c5',
  'd7ab3544-c080-4344-b141-df0f1af4854b',
  '93c50d24-5a3b-4d20-ad4a-926bdca84a15',
  '07874ea3-ea40-4b3d-b5cf-1396e43078dd',
  '6bdc519c-9ce9-484c-bea9-716d96401af2',
  'f0e9407d-e8e4-43fe-a30d-046b9bb83e2b',
  '529908dd-8ba9-4b72-90c2-d29a479c5254',
  '47bfbe4b-9e74-4614-bab7-182f294e4647',
  'bda9b75c-5748-441d-996d-f25349d165dd',
  'b135fe31-62e6-4258-a070-05ad2fbc835f',
  '7f9688ea-cbdc-4e77-a088-19d374d5d751',
  'e0624fda-989f-4462-8892-9bb4fe123047',
  '4fc4027d-bfbe-4123-9b6d-cff113f3a5af',
  '720761c2-a33a-4184-a6cd-c43c1f509ba3',
  '9eb14ba6-b4f6-483a-9239-649a92d2f66f',
  'bc31f94f-338f-4143-9ede-540a163a63f8'
]::uuid[]);

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

comment on column public.internal_zones.zone_number is
  'Numero univoco della zona immobiliare mostrato su mappa, card e matching.';

commit;
