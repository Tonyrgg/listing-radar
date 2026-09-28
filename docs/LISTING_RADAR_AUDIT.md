# Audit Listing Radar — 28 settembre 2026

Audit del codice, della baseline versionata e di un'istanza Supabase locale isolata. Docker è operativo. La migration `0010` è applicata e testata nell'istanza isolata e, il 28 settembre 2026, è stata applicata anche al progetto Cloud collegato. La history Cloud riporta `0001`–`0010`; API tabelle, coda e KPI rispondono `200`. Il volume locale storico, con dati e vecchia numerazione migration, non è stato modificato.

| ID | Area | Gravità | Problema / causa | Soluzione | Stato |
|---|---|---|---|---|---|
| A01 | Operatività | HIGH | La dashboard «Oggi» mostrava movimenti mercato ma non follow-up e acquisizioni; assente modello CRM acquisizione | Pipeline, coda e azioni dedicate | Verificato in browser locale |
| A02 | Dati | HIGH | `opportunities` V2 rappresenta score di mercato, non un lead commerciale | Entità separate collegate a `properties`/`events` | Verificato in Supabase locale |
| A03 | Privati | HIGH | Il bridge V2 non produceva eventi per prima pubblicazione e ribasso privato | Trigger idempotenti su `private_publications` | Verificato in Supabase locale |
| A04 | Buyer | MEDIUM | `property_requests` non registrava necessità di vendere prima | Campi e azione nella scheda richiesta | Verificato nel test migration locale |
| A05 | Compliance | HIGH | Nessuno stato di revisione contatto per fonti sensibili nella nuova pipeline | Flag, blocco transizione e revisione esplicita | Implementato e testato per le regole di blocco |
| A06 | Documentazione | MEDIUM | README descriveva ancora MVP mock/legacy | README e documenti aggiornati | Risolto |
| A07 | Test UI | LOW | 2 test design preesistenti fallivano: contrasto e occhiello Portafoglio | Corretti token minimi, controllo dei due temi ed etichetta | Risolto |
| A08 | Collaudo DB | HIGH | Docker Desktop si arrestava sul socket locale `dockerInference`; 24 test integrazione saltati | Docker tornato operativo, progetto Supabase isolato con migration `0001`–`0010`, 30 test Lifecycle e 1 test acquisizioni live passati | Risolto per ambiente di validazione |
| A09 | KPI | MEDIUM | Limite query di 1000 righe falsava i conteggi; i rapporti periodo non sono conversioni di coorte | Aggregazioni SQL senza limite righe; rapporti periodo documentati | Conteggi corretti in codice, coorti aperte |
| A10 | Automazioni | MEDIUM | I motori non FSBO richiedono ancora Quick Add manuale; foto/documenti non integrati | Estendere solo dopo validazione V1 | Aperto |
| A11 | Worker test | MEDIUM | Ricerca cliente su schermata ambigua attendeva oltre il timeout; altri test browser superano talvolta il limite di 5 secondi anche in seriale | Errore ritentabile anticipato, test mirato 11/11; restano timeout ambientali nella suite completa | Parzialmente risolto |
| A12 | Storico | MEDIUM | I trigger operano sulle nuove osservazioni; le vecchie pubblicazioni private non vengono convertite retroattivamente in lead | Backfill guidato dopo controllo duplicati e volumi | Aperto |
| A13 | Dipendenze | CRITICAL | Next.js 16.2.9 e dipendenze transitive mostravano avvisi critical/high in `npm audit` | Aggiornato Next.js e pacchetto ESLint a 16.3.6, applicati fix compatibili; `npm audit` ora 0 vulnerabilità | Risolto |
| A14 | Coda Oggi | HIGH | Limite di 300 righe prima dell'ordinamento: lead urgenti potevano restare fuori vista | Vista SQL ordinata e paginazione a 50 righe | Verificato in DB e browser locali |
| A15 | Contatti | HIGH | Un'attività telefonica poteva aggirare i flag di blocco; un nuovo segnale successione non proteggeva sempre un contatto già collegato | Controllo condiviso su stati e attività, marcatura fonte sensibile | Regole verificate; UI live da confermare dopo rilascio |
| A16 | Buyer-to-Seller | MEDIUM | Località forzata a Bitonto e secondo buyer non collegabile al lead esistente | Scelta località e tabella di collegamento molti-a-molti | Verificato in DB locale |
| A17 | Segnali V2 | MEDIUM | Retry di un evento deduplicato poteva produrre attività duplicata; località automatica sempre Bitonto | Timeline solo dopo inserimento segnale e località da `locations` | Verificato in PGlite e Supabase locale |
| A18 | Mobile | MEDIUM | Nomi fonte lunghi allargavano le righe dell'archivio oltre lo schermo | Testo fonte troncato nei componenti condivisi | Risolto; test browser mobile verde |
| A19 | Test integrazione | MEDIUM | Test coda assumeva assenza di job precedenti; fixture acquisizioni gareggiava con i conteggi Lifecycle | Priorità esplicita e suite acquisizioni opt-in separata | Risolto; suite locali verdi |
| A20 | Rilascio Cloud | HIGH | La history Cloud conteneva `0001`–`0009`, ma non `0010`; l'API Cloud restituiva `PGRST205` per le nuove tabelle | Migration `0010` applicata e verificata; resta il rilascio della web app | Parzialmente risolto |
| A21 | Autenticazione E2E | MEDIUM | Il percorso browser acquisizioni è stato verificato con auth disattivata nell'istanza locale; non è stato eseguito un login reale su Cloud | Verifica login e permessi nel collaudo del rilascio | Aperto |

## Copertura dell'ispezione

Esaminati route App Router e API, `proxy.ts`, auth/server actions, Supabase RLS e migration 0001–0010, adapter e read model Lifecycle V2, bridge privati, richieste/match, worker/job, configurazione Vercel, script scheduler Windows, documenti e suite test. Lo schema operativo confermato è Supabase/PostgreSQL; nessun uso Neon trovato. `listings`, snapshot e action legacy rimangono per la transizione, ma non sono base del nuovo modello. Nessuna cancellazione è stata eseguita sul volume storico o su Cloud; `db reset` è stato usato esclusivamente sul progetto di validazione creato da zero.

Verifiche correnti: `lint`, `typecheck`, build web e compilazione worker verdi; 319/319 test unitari web verdi; 30/30 test integrazione base e 1/1 test acquisizioni live verdi, eseguiti in sequenza su Supabase locale isolato; 4/4 test browser Acquisition/Lifecycle verdi. Il test PGlite verifica inoltre trigger, ribasso, deduplicazione, località, richieste buyer multiple, paginazione della coda, KPI oltre 1000 segnali, appuntamento e `WON`. `design:check` verde; `npm audit` web e worker production con 0 vulnerabilità. I test browser worker mirati passano; la suite completa worker ha timeout sotto carico. La migration `0010` è applicata sul Cloud; il deploy web è ancora pendente.
