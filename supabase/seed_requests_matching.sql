-- SOLO SVILUPPO: eseguire manualmente dopo 004_requests_matching.sql.
insert into public.internal_zones (name, description, landmarks, aliases, associated_streets)
values
  ('Zona Villa','Area intorno alla villa comunale','["Villa comunale"]','["Villa"]','["Via 4 Novembre"]'),
  ('Zona Stazione','Collegamenti ferroviari','["Stazione"]','["Stazione centrale"]','["Via della Repubblica"]'),
  ('Zona Ospedale','Area del presidio sanitario','["Ospedale"]','["Ospedale civile"]','[]'),
  ('Centro Storico','Nucleo antico','["Cattedrale"]','["Centro","Borgo antico"]','[]'),
  ('Zona San Francesco','Quadrante San Francesco','["Chiesa San Francesco"]','["San Francesco"]','["Via Borgo San Francesco"]')
on conflict do nothing;

insert into public.property_requests
  (title, contract_type, property_types, status, priority, budget_ideal, budget_max,
   monthly_rent_ideal, monthly_rent_max, internal_sqm_min, internal_sqm_ideal,
   internal_sqm_max, rooms_min, rooms_ideal, bedrooms_min, bathrooms_min, notes)
values
  ('Famiglia cerca 4 vani','sale','["apartment"]','active','high',150000,180000,null,null,90,105,125,4,4,3,2,'Zona tranquilla'),
  ('Prima casa con balcone','sale','["apartment","ground_floor"]','active','normal',100000,125000,null,null,65,80,95,3,3,2,1,null),
  ('Affitto vicino stazione','rent','["apartment"]','active','urgent',null,null,500,600,45,60,75,2,2,1,1,'Disponibilità rapida'),
  ('Casa indipendente','sale','["independent_house","townhouse"]','active','normal',180000,220000,null,null,100,130,170,4,5,3,2,null),
  ('Richiesta anonima centro','sale','["apartment","penthouse"]','draft','low',90000,110000,null,null,55,70,85,2,3,1,1,null);

insert into public.portfolio_properties
  (title, contract_type, property_type, municipality, address, internal_zone_id,
   price, monthly_rent, internal_sqm, commercial_sqm, rooms, bedrooms, bathrooms,
   floor, building_floors, condition, availability_status, mandate_status)
values
  ('Quadrivani Zona Villa','sale','apartment','Bitonto','Via 4 Novembre',
    (select id from public.internal_zones where name='Zona Villa' limit 1),168000,null,108,124,4,3,2,2,5,'good','available_now','active'),
  ('Trivani senza ascensore','sale','apartment','Bitonto','Via Matteotti',
    (select id from public.internal_zones where name='Zona Stazione' limit 1),118000,null,78,90,3,2,1,3,3,'habitable','available_now','active'),
  ('Bilocale in affitto','rent','apartment','Bitonto','Via della Repubblica',
    (select id from public.internal_zones where name='Zona Stazione' limit 1),null,550,58,67,2,1,1,1,4,'good','available_now','active'),
  ('Casa indipendente con cortile','sale','independent_house','Bitonto','Via Palombaio',
    null,210000,null,140,170,5,3,2,0,2,'renovated','available_at_deed','active'),
  ('Attico Centro Storico','sale','penthouse','Bitonto','Piazza Cattedrale',
    (select id from public.internal_zones where name='Centro Storico' limit 1),135000,null,82,105,3,2,1,4,4,'to_renovate','future_availability','active'),
  ('Appartamento San Francesco','sale','apartment','Bitonto','Via Borgo San Francesco',
    (select id from public.internal_zones where name='Zona San Francesco' limit 1),98000,null,72,83,3,2,1,1,4,'habitable','available_now','active');

-- I match demo vengono prodotti dal pulsante "Ricalcola match", usando lo stesso
-- motore server-side impiegato in produzione.
