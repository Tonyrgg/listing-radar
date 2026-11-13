# Worker 0.34.40 — arbitraggio centrale senza confronti manuali

Il blocco osservato riguardava sette differenze nell'orario `at` di eventi
`units/<key>/journal/<event-id>/at`. Erano eventi con identità uguale riletti
su postazioni diverse. Il risolutore percorreva un array usando l'identificativo
dell'evento come indice JavaScript, perciò segnalava erroneamente dato cambiato.

La modalità online usa adesso una politica esplicita server: unisce cambiamenti
indipendenti e dati aggiunti, mentre nei cambiamenti concorrenti sul medesimo
campo conserva il valore centrale già confermato. Entrambe le proposte restano
come traccia risolta; non serve una decisione manuale per avviare. Gli eventi
identici con orari differenti conservano deterministicamente il primo orario.
I cursori della coda Sister e le iscrizioni concorrenti sono record coerenti,
senza mescolare campo per campo due esecuzioni diverse. Il risolutore legacy
sa ora attraversare gli array per identificativo, ma online non apre il dialogo.

La revisione atomica del server resta obbligatoria. Uno scrittore con revisione
vecchia riceve 40001, rilegge e ricalcola le sue modifiche. Fatti di acquisizione,
prove CRM e cronologia conservano le protezioni già presenti; i confronti sui
dati CRM restano verifiche operative distinte dai vecchi conflitti di trasporto.

La migrazione 0093 archivia i sette confronti esistenti, preservando proposte e
percorsi. Il trigger applica la stessa politica alle proposte di vecchi Worker,
così la lettura incrementale distribuisce la chiusura senza interventi manuali.
La migrazione non modifica immobili, proprietari, checkpoint o selezioni di coda.
Backup completo dei record conservato nella directory runtime prima del recupero.

Applicata e registrata online: revisione 699 → 700, sette archiviati, zero aperti.
Riconciliazione della copia di casa con backup: revisione 701, 2.712 immobili,
pending=false, conflicts=0. Via Gorizia 88; tracciato Via Giotto 65.
La ricezione sulle altre due postazioni non è osservata direttamente.

Verifiche: 50 test in sette suite, inclusa convergenza di tre postazioni,
conservazione delle proposte, ripresa e risoluzione per ID. PostgreSQL locale
isolato con 6.000 immobili e 10.200 record: migrazione di confronti esistenti,
normalizzazione di una proposta da vecchio client e contenuto immobili invariato;
rollback, revisioni, concorrenza e paginazione conservati. Compilazione desktop.

La sincronizzazione automatica della 0.34.39 rimane attiva dopo ogni commit.
Una rete assente conserva le modifiche locali fino alla conferma del server.
Le modifiche concorrenti allo stesso dato adottano il valore centrale: la proposta
non applicata resta nell'audit, non viene silenziosamente distrutta.
