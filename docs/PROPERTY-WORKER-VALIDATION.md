# Validazione funzionale del Property Data Worker

Data: 24 agosto 2026

Ambiente: locale, Chrome di lavoro via CDP, SISTER autenticato, gestionale autenticato, Supabase configurato.

Vincolo: durante questa validazione non sono stati eseguiti salvataggi reali nel gestionale.

## Esito sintetico

Il worker è stato verificato per componenti, con test automatici, controllo visuale e una prova live controllata su SISTER. La long mode non era realmente bloccata: la lettura riga per riga di un inventario molto grande richiedeva minuti e non mostrava avanzamento. Sono state corrette anche la sincronizzazione delle navigazioni, la ripresa interna della variante e il riconoscimento della pagina `Elenco indirizzi`.

## Prova live della via completa

Via preparata manualmente in SISTER: `VIA AMMIRAGLIO VACCA`.

- righe grezze restituite da SISTER: 2.157;
- immobili A/C accettati: 1.743;
- categorie non ammesse escluse: 145;
- righe prive di dati catastali escluse: 269;
- tempo di parsing bulk osservato: circa 0,6 secondi;
- prima unità letta con successo: 2 intestatari;
- pausa cooperativa: recepita prima dell'unità successiva;
- ritorno a `Elenco indirizzi`: riuscito;
- ripresa dal checkpoint: il primo immobile già concluso è stato saltato e soltanto il secondo è stato riaperto;
- scritture CRM: nessuna.

Una scansione completa dei 1.743 immobili non è stata eseguita perché avrebbe richiesto molte ore e non era necessaria per isolare il difetto. La prova controllata ha attraversato le stesse pagine e gli stessi adapter della run completa.

## Matrice delle funzioni

| Area | Verifica | Esito |
| --- | --- | --- |
| Collegamento Chrome/CDP | controllo live delle due schede aperte | PASS |
| Sessione SISTER | keep-alive, redirect di scadenza e controllo live | PASS |
| Sessione gestionale | riconoscimento live della scheda autenticata | PASS |
| Excel recapiti | file reale, colonne obbligatorie, consolidamento CF | PASS |
| Supabase worker | health check e migration richieste | PASS |
| Acquisizione SISTER singola | ordine righe, filtri A/C, record vuoti, intestatari e aziende | PASS |
| Paracadute acquisizione | pausa, skip manuale, doppio tentativo e prosecuzione | PASS |
| Via completa dry-run | query senza civico, inventario grande, avanzamento, pausa e resume | PASS |
| Via completa live | percorso di persistenza e import verificato con test; nessuna scrittura live durante l'audit | PASS (isolato) |
| Varianti omonime | solo testo esatto, duplicati SISTER conservati, vie simili escluse | PASS |
| Fallback 50 civici | arresto solo dopo 50 vuoti verificati per tutte le varianti; errori esclusi dai vuoti | PASS |
| Parsing proprietari | formati reali, comunione legale, nuda proprietà, quote e aziende | PASS |
| Quote | percentuali numeriche e massimo due decimali in UI CRM | PASS |
| Excel e recapiti | deduplica, prefisso italiano, overflow e spostamento recapiti | PASS |
| Identità nominativo | CF, nome, telefono, omonimi e fallback auditabile | PASS |
| Creazione/riuso immobile | chiave catastale, indirizzo, card incompleta e protezione duplicati | PASS |
| Comproprietari | ordine, ruolo, cliente verificato, telefono e quota | PASS |
| Attività | una per immobile; Telefonata/Da eseguire oppure Contatto diretto/Eseguito | PASS |
| Pausa/ripresa lavoro | interruzione cooperativa e checkpoint per immobile | PASS |
| Skip immobile | manuale, automatico dopo tre tentativi e conservazione soggetti condivisi | PASS |
| Archivio richieste | paginazione, dettaglio, ripresa e zone | PASS |
| Archivio incarichi | paginazione, dettaglio, normalizzazione, ripresa e localizzazione | PASS |
| Correzioni manuali | validazione appartenenza, dati catastali, persone e quote | PASS |
| Screenshot diagnostici | rimozione confinata e idempotente | PASS |
| Registro errori | sanitizzazione dei dettagli e persistenza locale | PASS |
| Updater | versioni, download a parti, riuso cache e verifica hash | PASS |
| Interfaccia | controllo JavaScript, desktop/mobile, progress, recovery e riepiloghi | PASS |

## Problemi trovati e corretti

1. **Lettura riga per riga troppo lenta.** Ogni riga SISTER attraversava separatamente il confine Playwright/browser. Ora la tabella viene letta con una singola valutazione bulk.
2. **Race condition dopo i submit SISTER.** L'attesa della navigazione iniziava dopo il clic e poteva osservare il documento precedente. Ora clic e `waitForNavigation` vengono armati insieme.
3. **Nessun avanzamento durante una variante grande.** Il renderer riceve ora fase, posizione, totale e indirizzo corrente tramite un canale dedicato, senza interrogare Supabase a ogni riga.
4. **Ripresa inefficiente.** Un checkpoint parziale riapriva gli immobili già completati. Ora conserva le chiavi acquisite e riparte dal primo elemento mancante, anche nel fallback per civico.
5. **Health check incompatibile con la long mode.** `Elenco indirizzi` era segnalato come pagina non riconosciuta. Ora il controllo distingue risultati singoli ed elenco per via completa.
6. **Controllo visuale obsoleto.** Il mock desktop non esponeva i bridge introdotti dalle nuove funzioni. È stato aggiornato e trasformato in un gate che fallisce su errori JavaScript, overflow e componenti essenziali mancanti.

## Gate eseguiti

- compilazione TypeScript worker: PASS;
- compilazione desktop Electron: PASS;
- suite worker: 21 file e 153 test PASS;
- test di regressione su 2.200 righe: PASS;
- test end-to-end locale pausa/ripresa con navigazioni reali: PASS;
- controllo live `worker:check`: PASS su Excel, Supabase locale, Chrome, SISTER e CRM;
- controllo visuale desktop e mobile: PASS, nessun errore JavaScript e nessun overflow;
- lint root: PASS;
- typecheck root: PASS;
- test root: 195 PASS e 24 integrazioni escluse dal comando unitario;
- integrazioni con Supabase locale: 29 PASS;
- Supabase DB lint locale: PASS;
- build di produzione Next.js: PASS;
- Playwright root: smoke browser PASS; tre test Lifecycle non pertinenti al worker esclusi perché `LIFECYCLE_E2E_BASE_URL` non era configurato.
- installer Windows `0.11.1`: build PASS;
- canale aggiornamenti: pubblicazione PASS;
- verifica binaria completa da canale remoto: 3 parti, 97.955.892 byte, hash e ricomposizione PASS.
