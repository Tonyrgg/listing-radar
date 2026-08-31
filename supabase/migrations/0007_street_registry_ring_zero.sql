-- Correzione dei vincoli sulle corone dello Street Registry.
--
-- distanceRing() e a base zero per definizione: la corona 0 sono i primi 250
-- metri dal centro, come fissato dai test di src/lib/street-registry/metrics.
-- La 0006 pretendeva invece un minimo di 1 e faceva fallire il ricalcolo sulla
-- prima via a ridosso di Piazza Cavour.
--
-- Su un database creato dalla 0006 gia corretta questa migration non cambia
-- nulla: rimuove e riscrive gli stessi vincoli.

alter table public.street_registry_streets
  drop constraint if exists street_registry_streets_city_ring_check;

alter table public.street_registry_streets
  add constraint street_registry_streets_city_ring_check
  check (city_ring is null or city_ring >= 0);

alter table public.street_registry_street_zones
  drop constraint if exists street_registry_street_zones_zone_ring_check;

alter table public.street_registry_street_zones
  add constraint street_registry_street_zones_zone_ring_check
  check (zone_ring is null or zone_ring >= 0);
