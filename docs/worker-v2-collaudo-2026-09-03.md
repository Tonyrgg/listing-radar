# Collaudo Worker V2 — 3 settembre 2026

## Stato e limiti

Collaudo automatico locale completato sulla **0.33.7**: 501 test superati,
zero falliti e zero saltati. **Accettazione live parziale.**
Il Chrome di lavoro sulla porta CDP `9222` è stato collegato:
la diagnostica Tecnocloud in sola lettura e il lookup controllato del luogo di
nascita sono stati provati sul portale reale. Non sono state eseguite nuove
scritture su Tecnocloud o Supabase reali. Le fixture non provano comunque la
persistenza Supabase o i salvataggi live ancora elencati in fondo al documento.

La modalità Rete proprietari attuale esegue vie successive dal registro;
non invoca il precedente esploratore basato sui CF dei comproprietari.
Civico singolo, Via completa e Rete proprietari condividono il contratto
della coda e l'import V2. Rete proprietari richiede anche il collaudo della
sequenza delle vie.

## Coda comune — aggiornamento 0.33.6

- Estratto `services/acquisition-queue.ts`: stessi controlli per civico,
  finalizzazione delle vie, ripresa delle acquisizioni salvate e import V2.
- Corretta la validazione delle quote: si legge il collegamento a ciascun
  immobile, non la quota globale del nominativo. Un CF può appartenere a
  più immobili con quote differenti.
- La lettura dal repository non nasconde più i collegamenti a nominativi
  mancanti. Il caso incompleto viene segnalato e non può diventare una
  comproprietà parziale importata come completa.
- Prima dell'accesso CRM, il motore rifiuta catasto incompleto e quote
  mancanti, non numeriche, nulle, negative o superiori al 100%.
- Aggiunto il civico singolo al percorso integrato: esegue gli step reali
  `properties_extracted`, `owners_extracted` e `data_normalized` del runner.
- Confronto diretto dei piani prodotti dai tre percorsi sugli stessi dati
  SISTER, inclusa l'impronta usata dai checkpoint di ripresa.

Le regole di revisione dell'acquisizione restano quelle esistenti: il
civico segnala dati incompleti prima della revisione, mentre le long run
registrano l'esclusione del caso e preparano le altre righe valide.
Il controllo di completezza e il motore che importano le righe sono comuni.

## Difetti riprodotti e correzioni

- Ricerca CF: il contatore era riconosciuto soltanto come `Clienti 0 risultati`.
  Parentesi, testo contiguo e shadow root potevano produrre timeout e
  accantonamento del caso. Il nuovo riconoscimento legge i componenti.
- Uno zero provvisorio poteva essere accettato mentre la richiesta era
  ancora in corso, oppure nonostante un errore. Ora si attendono richieste,
  indicatori e stabilità del risultato; un errore di ricerca pausa il batch.
- Ricerca immobili: quattro letture senza righe valevano come assenza anche
  senza conferma del portale. Ora serve un esito visibile e non in caricamento.
- Righe già escluse dall'acquisizione potevano rientrare se solo lo stato
  della riga riportava l'esclusione. Ora viene rispettato anche quello.
- Lookup comuni: `TORINO` coincideva anche con Camagna di Torino, Mombello di
  Torino e gli altri risultati che contengono la parola. Ora nome e provincia
  devono identificare un solo record esatto; la riga sintetica di ricerca resta
  esclusa. Prima del click e dopo la selezione si attendono richieste Cloud,
  indicatori di caricamento e stabilità della conferma del lookup.
- Diagnostica live: il campo di ricerca elenco veniva contato subito dopo la
  navigazione e poteva risultare assente durante il montaggio asincrono. Ora
  viene atteso esplicitamente prima del controllo di univocità.

Prima della correzione, cinque delle sei nuove prove sulla ricerca CF
fallivano. I casi di prova sono artificiali e non identificano da soli quale
variante di pagina fosse presente sul PC di lavoro dell'utente.

## Copertura automatica

| Percorso o rischio | Prova |
| --- | --- |
| Civico singolo dai risultati SISTER fino alla rilettura CRM | Step reali del runner, parser SISTER, coda e motore V2; persistenza sostituita dalla fixture |
| Contratto comune alle tre modalità | Stessi dati SISTER → stesso piano e stessa impronta, senza un parametro modalità nell'importer |
| Quota per immobile | Nominativo condiviso con quota globale assente e quote diverse sui collegamenti; quota globale valida che non deve nascondere un collegamento invalido |
| Comproprietario mancante | Lettura del collegamento dal repository anche senza nominativi; accantonamento prima di qualsiasi accesso CRM |
| Via completa dall'elenco SISTER fino alla rilettura CRM | `import-v2-workflows.test.ts`: parser e adapter di produzione su HTML locale, conversione del grafo e motore V2 con UI adapter di produzione |
| Rete proprietari su due vie | Stesso percorso, orchestrato dalla funzione di sequenza usata dal desktop |
| CF assente → nominativo nuovo | Compilazione, salvataggio e ricerca successiva della scheda |
| Nominativo esistente e merge verde | Nomi maiuscoli aggiornati con iniziali maiuscole, recapiti esistenti conservati, Salva nel dialogo collassato distinto da quello sottostante |
| Immobile nuovo | Form, conferma indirizzo/località, salvataggio catasto, proprietario principale e quota, rilettura finale |
| Immobile già presente | Ricerca catastale, apertura scheda e nessuna creazione duplicata |
| Attività | Creazione sulla scheda e conferma nel pannello attività |
| Ripresa dopo completamento | Nuovo motore/adapter con checkpoint persistito in memoria: nessuna nuova scrittura |
| Arresto dopo il salvataggio del nominativo | Errore ricerca immobili, pausa, nuovo motore, ripresa dal checkpoint senza riscrivere la persona |
| Ricerca CF in errore | Batch fermo sul primo immobile; i successivi non sono accantonati |
| Ricerca catastale lenta | Esito differito oltre il vecchio tempo di attesa, senza estendere prematuramente alla via |
| Coda rete e pausa | Attesa import, mancato completamento, errore e pausa prima della prossima presa in carico |
| Altri casi V2 | Suite esistente: duplicati CF, comproprietari e quote, protezione aziende/usufrutto, contatti, indirizzi, filtri, merge e attività |

Le fixture integrate comprendono un proprietario al 100% per immobile.
I casi con più comproprietari sono verificati separatamente dai test del
motore e dell'adapter. La persistenza del grafo/checkpoint integrato è in
memoria; claim atomico, lease e aggiornamento delle righe Supabase non sono
provati da questa fixture. La preparazione automatica di SISTER è coperta
separatamente: le vie partono dall'Elenco indirizzi; il civico esercita gli
step di acquisizione sui risultati della ricerca del civico 10.

## Esecuzioni finali

- `npm --prefix worker run build`: superato.
- `npm --prefix worker run desktop:compile`: superato.
- `npm --prefix worker test -- --maxWorkers=3`: 492/492 superati sulla 0.33.6.
- `npm --prefix worker test`: 501/501 superati sulla 0.33.7.
- Report JSON locale: `.runtime/worker-v0.33.6-tests-final.json`.
- Prove mirate iniziali sulla coda: 75/75 superate.

## Verifiche live incrementali del 3 settembre 2026

- Collegamento effettuato al Chrome dedicato del worker su
  `http://127.0.0.1:9222`, non al profilo Chrome personale.
- Lookup luogo di nascita eseguito nel form reale con `TORINO` / `TO`: valore
  finale `TORINO`, campo `readonly`, contenitore `slds-has-selection` e menu
  risultati chiuso. Il form è stato annullato senza premere Salva.
- `npm --prefix worker run import-v2:diagnose`: 5 snapshot UI sanitizzati e
  20 contratti di rete raccolti; nessun valore anagrafico, header o cookie
  acquisito e nessuna scrittura eseguita.

Durante la precedente 0.33.5, la prima esecuzione completa aveva 463 successi e un timeout in un test
dell'adapter precedente, con budget totale di 5 secondi e attesa intenzionale
di 3 secondi per il merge. Il problema si riproduceva anche isolando quel test.
Il suo budget è stato portato a 10 secondi per includere avvio browser,
compilazione campi e chiusura, senza cambiare le asserzioni o l'adapter.
La suite completa era stata quindi rieseguita sulla versione finale 0.33.5
(465/465); sulla 0.33.6 è passata alla prima esecuzione completa.

## Accettazione live ancora da eseguire

1. Su Via Guidone, provare prima un civico singolo e poi Via completa.
   Osservare l'esatto stato di ricerca quando un CF manca;
   verificare creazione, rilettura anagrafica e prosecuzione dell'immobile.
2. Verificare una scheda esistente, il merge verde dello screenshot,
   i filtri residenziali, due comproprietari e le quote finali.
3. Riprendere una lavorazione interrotta e verificare assenza di duplicati
   e stato finale del job nel database.
4. Eseguire Rete proprietari su un campione operativo concordato: la seconda
   via deve partire solo dopo il completamento dell'import della prima.
   Provare pausa/ripresa e controllo del lease su un solo worker attivo.

Registrare versione installata, job, conteggi prima/dopo, esiti e passaggi
osservati; non inserire credenziali, CF o dati personali in questo report.
