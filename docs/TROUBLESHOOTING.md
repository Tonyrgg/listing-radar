# Diagnostica

- **Tabella `acquisition_*` assente**: applicare `0010_acquisition_os.sql` nell'ambiente previsto tramite migration; verificare lo storico migrazioni. Non creare tabelle manualmente.
- **Supabase locale non parte**: controllare Docker Desktop e `npx supabase status`. Il precedente blocco sul socket `dockerInference` si è risolto senza azzerare volumi o immagini. Non eseguire `db reset` sul volume locale storico o su un progetto remoto.
- **Migration locali divergenti**: il volume storico usa versioni `001`–`032`, mentre il repository attuale usa la baseline `0001`–`0010`. Usare un progetto locale nuovo e isolato per testare la baseline; non riparare la history o resettare il volume storico alla cieca.
- **Test dopo `db reset` non vedono le tabelle**: PostgreSQL può essere pronto mentre PostgREST usa ancora la vecchia cache. Riavviare il container REST del solo progetto di validazione, verificarne la salute, poi lanciare i test.
- **Notizia privata automatica assente**: controllare prima `private_publications`, poi `events` (`PRIVATE_PUBLICATION_NEW`, `PRIVATE_PRICE_DROP` ecc.), poi `acquisition_signals`. Controllare log del job Lifecycle; un crawler fallito non dimostra rimozione.
- **Lead duplicato**: per una property V2 è attivo un indice univoco. Per indirizzi manuali confrontare `possible_duplicate_of` e collegare la property solo dopo verifica certa.
- **Lead non appare in Oggi**: controllare stato terminale, `next_action_at`, priorità A e pagina corrente (50 risultati per pagina). Senza prossima azione un lead aperto deve apparire.
- **Contatto bloccato**: verificare `do_not_contact`, `contact_status='blocked'` e `contact_review_required`; la revisione è esplicita nella scheda.
- **Errore salvataggio**: server actions registrano contesto e messaggio DB con prefisso `[acquisition]`. Controllare log server e RLS/configurazione service role senza stampare segreti.
- **Worker**: consultare `worker/README.md` e i checkpoint del job. Il worker desktop non partecipa al funnel commerciale web.
# Diario universale

- Se `/logbook` segnala una relazione o vista mancante, verificare che la
  migration `0011_universal_logbook.sql` sia applicata al database della web
  app. Non usare `db reset` sul volume storico o sul Cloud.
- Se la vista è leggibile in `psql` come amministratore ma la web app dà
  «permission denied», verificare i grant `service_role` della migration e che
  il client server stia usando `SUPABASE_SERVICE_ROLE_KEY`.
- Se una chiamata non compare nell'immobile, controllare che il lead abbia
  `property_id` V2. Un indirizzo solo testuale non identifica automaticamente
  una proprietà fisica.
- Se un match buyer non genera evento, verificare `score >= 90` e
  `classification = compatible`; i ricalcoli successivi restano silenziosi.
- Se un'azione manca dalla coda Oggi, controllare `next_action_at`,
  `action_completed_at` e il fuso `Europe/Rome`.
