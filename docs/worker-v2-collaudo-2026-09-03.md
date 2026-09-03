# Collaudo Worker V2 — 3 settembre 2026

## Stato e limiti

Collaudo automatico locale completato sulla **0.33.5**: 465 test superati,
zero falliti e zero saltati. **Accettazione live non completata.**
Il collegamento al Chrome dell'utente non è disponibile in questa sessione;
non sono state eseguite nuove scritture su Tecnocloud o Supabase reali.
Non attribuire alle fixture una verifica delle sessioni, dei selettori live
o della persistenza Supabase.

La modalità Rete proprietari attuale esegue vie successive dal registro;
non invoca il precedente esploratore basato sui CF dei comproprietari.
Via completa e Rete proprietari condividono acquisizione e import V2,
ma la seconda richiede anche il collaudo della sequenza delle vie.

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

Prima della correzione, cinque delle sei nuove prove sulla ricerca CF
fallivano. I casi di prova sono artificiali e non identificano da soli quale
variante di pagina fosse presente sul PC di lavoro dell'utente.

## Copertura automatica

| Percorso o rischio | Prova |
| --- | --- |
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
separatamente: il test integrato parte dall'Elenco indirizzi.

## Esecuzioni finali

- `npm --prefix worker run build`: superato.
- `npm --prefix worker run desktop:compile`: superato.
- `npm --prefix worker test -- --maxWorkers=3`: 465/465 superati.
- Report JSON locale: `.runtime/worker-v0.33.5-tests-final.json`.

La prima esecuzione completa aveva 463 successi e un timeout in un test
dell'adapter precedente, con budget totale di 5 secondi e attesa intenzionale
di 3 secondi per il merge. Il problema si riproduceva anche isolando quel test.
Il suo budget è stato portato a 10 secondi per includere avvio browser,
compilazione campi e chiusura, senza cambiare le asserzioni o l'adapter.
La suite completa è stata quindi rieseguita sulla versione finale.

## Accettazione live ancora da eseguire

1. Collegare il Chrome di lavoro e accedere manualmente a SISTER/Tecnocloud.
2. Su Via Guidone, osservare l'esatto stato di ricerca quando un CF manca;
   verificare creazione, rilettura anagrafica e prosecuzione dell'immobile.
3. Verificare una scheda esistente, il merge verde dello screenshot,
   i filtri residenziali, due comproprietari e le quote finali.
4. Riprendere una lavorazione interrotta e verificare assenza di duplicati
   e stato finale del job nel database.
5. Eseguire Rete proprietari su un campione operativo concordato: la seconda
   via deve partire solo dopo il completamento dell'import della prima.
   Provare pausa/ripresa e controllo del lease su un solo worker attivo.

Registrare versione installata, job, conteggi prima/dopo, esiti e passaggi
osservati; non inserire credenziali, CF o dati personali in questo report.
