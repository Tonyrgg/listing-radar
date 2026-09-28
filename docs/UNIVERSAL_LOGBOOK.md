# Diario universale e cockpit operativo

## Fonte dei dati

La migration `0011_universal_logbook.sql` aggiunge la vista `universal_logbook`.
La vista legge direttamente eventi significativi di Property Lifecycle V2,
notizie commerciali non già rappresentate da un evento V2, attività,
appuntamenti, apertura opportunità, richieste buyer e attività manuali libere.
Nessuna copia dello storico è necessaria: gli eventi precedenti sono visibili
subito dopo la migration. Snapshot e `system_signal` ripetitivi restano fuori.
La chiave testuale dell'evento contiene il prefisso della tabella sorgente e
l'UUID originale; non cambia l'identità dei record storici.

`logbook_entries` serve per attività che non hanno un lead, come visite in zona,
note su una persona CRM o verifiche di un immobile. Se la persona ha un lead,
telefonate e attività ordinarie usano ancora `acquisition_activities`: un solo
inserimento alimenta Diario, persona, immobile, opportunità e mese. Il trigger
dei match buyer registra solo il primo superamento di 90/100 con classificazione
compatibile e le transizioni commerciali di stato; non registra ricalcoli
ordinari. L'ID dell'immobile del portafoglio resta nei metadata, perché non è
una `properties` V2.

Per un evento V2 collegato a `acquisition_signals.event_id`, il Diario usa il
lead associato. Se non c'è quel collegamento, trova il lead già presente sulla
stessa proprietà alla registrazione dell'evento. Non crea lead e non deduce
intenzione di vendita da un ribasso. Gli eventi automatici non inviano contatti.

## Pagine

- `/acquisition/today`: azioni scadute, oggi, Focus, zona, lead senza azione.
- `/logbook`: storico globale paginato, filtri e Quick Add.
- `/logbook/month`: mese civile di Roma, contatori calcolati e Focus mensile.
- `/acquisition/stale`: azioni scadute, assenti o senza movimento con soglie A/B/C.
- `/contacts/[id]`: scheda persona, per contatti acquisizione e clienti buyer.
- `/casa/[id]#diario`: storico della proprietà V2.
- `/acquisition/[id]`: Diario unificato dell'opportunità.
- `/cerca`: ricerca globale esistente, estesa a nome, telefono, opportunità,
  indirizzo e richiesta.

Il Focus è una scelta esplicita per mese. Il Focus precedente appare come
«Da riportare», ma non viene copiato automaticamente. La coda Oggi mostra
anche le azioni pianificate su `logbook_entries`. Completare una di queste
azioni registra `action_completed_at`; le azioni sui lead continuano a usare
la normale gestione del follow-up nel funnel.

## Sicurezza e prestazioni

La UI privata verifica la sessione nel layout e le scritture verificano
nuovamente l'utente nelle server actions. Le viste aggregate usano
`security_invoker` e sono concesse solo a `service_role`, lato server: le
tabelle CRM storiche non sono esposte direttamente al ruolo browser.
`logbook_entries` e `monthly_focus` hanno RLS; le scritture passano dalle
server actions. Il Diario usa pagine di 40 righe, schede limitate e indici
per tempo, proprietà, contatto, cliente, lead e next action.

La migration completa i grant `service_role` sulle tabelle CRM matching
importate nella baseline `0001`, necessari per clienti, richieste e match in
un progetto locale creato da zero. Non concede scritture al ruolo browser.

## Collaudo locale

Usare **solo** un progetto Supabase locale isolato. Applicare tutte le
migration da `0001` a `0011`; poi eseguire
`tests/integration/universal-logbook.sql` tramite `psql` sul database isolato.
Il test apre una transazione e termina con `ROLLBACK`. Copre ribasso,
deduplicazione, cronologia incrociata, buyer match, Focus, confini di mese,
follow-up Oggi e lead fermi. Non usare il volume locale storico né il Cloud
per il test.
