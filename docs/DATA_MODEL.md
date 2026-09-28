# Modello dati

## Archivio mercato V2

`locations` → `properties` → `publications`/`private_publications` → `snapshots` e `events`. `agency_listings`, `evidence`, `review_queue`, `opportunities` e `building_events` rappresentano il ciclo di mercato. `opportunities` è una valutazione automatica di mercato; non è la pipeline CRM. `listings`, `listing_snapshots` e satellite sono legacy e non sono chiavi del nuovo sistema.

## Pipeline commerciale

| Tabella | Responsabilità |
|---|---|
| `acquisition_contacts` | Persone, recapiti, stato del contatto, fonti sensibili e possibili duplicati di telefono |
| `acquisition_leads` | Un'opportunità operativa con funnel, priorità e prossima azione |
| `acquisition_lead_requests` | Associazione molti-a-molti fra opportunità e richieste buyer |
| `acquisition_signals` | Notizie multiple per lead, origine, verifica e chiave idempotente |
| `acquisition_activities` | Timeline delle interazioni e variazioni importanti |
| `acquisition_appointments` | Acquisizioni fissate, dati raccolti ed esito |

`acquisition_leads.property_id` collega l'identità fisica V2. `request_id` conserva il primo collegamento buyer; `acquisition_lead_requests` consente di collegare ulteriori richieste senza duplicare il lead. `possible_duplicate_of` è solo un suggerimento; nessun merge automatico. L'indice parziale impedisce due lead non terminali per la stessa property. `event_id` e `dedupe_key` impediscono la ripetizione di segnali automatici. La vista `acquisition_today_queue` ordina la coda prima della paginazione; la funzione `acquisition_kpis` aggrega i conteggi nel database. Gli indici coprono coda, storico lead, fonte e richieste.

`property_requests` mantiene cliente, criteri, stato e match; la migration 0010 aggiunge `needs_to_sell_first`, `property_to_sell_id`, `sale_situation_notes`. Le altre entità CRM e del worker restano distinte.

Tutte le nuove tabelle hanno RLS: lettura per utenti autenticati e scrittura service role usata dalle server actions dopo `requireUser()`. Non è consentito accesso anonimo ai dati commerciali.
