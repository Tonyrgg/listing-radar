# Production baseline

Questa lineage ricostruisce un progetto Supabase vuoto senza importare dati di produzione.

- `migrations/0001_production_schema.sql` contiene lo schema finale derivato dalle migration storiche: tabelle, colonne, vincoli, indici, funzioni/RPC, trigger, RLS/policy, grant, estensione `pgcrypto`, schema Worker, CRM/matching e Property Lifecycle V2.
- `migrations/0002_production_seed.sql` contiene esclusivamente seed statici idempotenti: le 15 zone Bitonto/Palombaio/Mariotto con i metadati finali e le geometrie disponibili nella lineage (10 geometrie definite da `013`, 5 zone aggiunte da `014` senza poligono), agenti, agenzie/adapters, feature definitions, `matching_config` e il bucket Storage `property-lifecycle-visuals`.
- Le migration originali `001`–`035` sono conservate integralmente in `migrations_archive/`, nello stesso ordine e con gli stessi nomi.

## Esclusioni deliberate

- `012_seed_zona_villa_geometry.sql` è esclusa: è un backfill su dati già presenti.
- Le migration `013`/`014` sono state consolidate: nel baseline resta lo schema di `zone_number`/vincolo/indice; i dati delle 15 zone sono nel seed. È esclusa la pulizia di vecchie righe e la rinumerazione per UUID storici.
- La pulizia `duplicate_group_id` di `015` è esclusa; lo schema e `merge_listing_records` restano.
- La funzione intermedia `persist_property_lifecycle_observation_atomic` di `030` è esclusa; resta soltanto la definizione finale di `032`, con grant `service_role`.
- Nessun record reale di listing, richieste, CRM, Worker, Lifecycle, auth o storage viene ricreato.

## Verifica

La verifica completa richiede un'istanza Docker locale per `supabase db reset --local`. Non vengono eseguiti link, deploy, modifiche env o scritture su progetti remoti.
