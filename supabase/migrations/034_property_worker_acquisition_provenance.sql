-- Un'acquisizione conservata deve sapere da dove viene.
--
-- Finora una ricerca salvata portava con sé il luogo e due conteggi: aprendola
-- una settimana dopo non si poteva sapere se era nata da un civico, da una via
-- o da una rete di proprietari, né con quali limiti era stata raccolta. Con tre
-- sole acquisizioni in archivio, quello che le distingue conta più di prima.
--
-- `acquisition` tiene i fattori della raccolta: il tipo di run, i parametri con
-- cui è girata, cosa ha scartato, e la modalità di attività scelta quando i
-- dati sono stati presi — che è quella con cui vanno importati, non quella
-- impostata il giorno in cui premi «Importa».

alter table public.property_worker_jobs
  add column if not exists acquisition jsonb;

comment on column public.property_worker_jobs.acquisition is
  'Provenienza e parametri della raccolta conservata: kind, settings, skipped, activityMode.';
