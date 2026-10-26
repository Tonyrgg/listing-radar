# Worker V2 — tempi reali e ricerca per codice fiscale

Sessioni SISTER/Tecnocloud verificate il 26 ottobre 2026. Worker installato su
questo PC osservato nell'interfaccia: 0.34.26, fermo sulla mappa senza lavorazione
avviata. Le prove seguenti interrogano il gestionale senza salvare, creare,
unire o modificare nominativi, immobili, quote o attività.

## Confronto sul portale

Una persona privata già presente, identificata da un immobile noto. Prima di
ogni ricerca viene riletta la medesima scheda; ogni confronto usa un adattatore
nuovo per evitare la cache interna dei nominativi. Ordine **ABBAAB**, tre
esecuzioni della 0.34.26 installata e tre del candidato 0.34.27 nella stessa
sessione Chrome. Le prove prestazionali alternate sono eseguite dopo la fine
delle suite browser mirate, prima della suite completa.

| Misura per ricerca CF con rilettura del nominativo | 0.34.26 | Candidato 0.34.27 |
|---|---:|---:|
| Mediana | 10.039,680 ms | 5.348,385 ms |
| Minimo | 9.576,229 ms | 5.288,986 ms |
| Massimo | 10.266,544 ms | 6.156,614 ms |
| Richieste di documenti osservate, mediana, inclusi frame | 5 | 1 |
| Fetch/XHR osservati dalla scheda, mediana | 85 | 55 |
| Ricerche con CF e ID attesi verificati | 3/3 | 3/3 |

Differenza tra mediane: **4.691,295 ms, pari al 46,73% di questo passaggio**.
Il campione è un solo nominativo e sei ricerche: non misura l'import completo,
le scritture o tutti i possibili casi Tecnocloud. Tempi di richieste parallele
non vengono sommati come tempo del server.

## Correzione implementata

Il percorso precedente ricaricava sempre l'elenco anagrafiche prima di cercare
un proprietario, ricostruendo la shell Lightning e le richieste accessorie.
Ora riusa la barra univoca già visibile nelle liste e nelle schede di lettura,
comprese le URL reali con suffisso dopo l'ID. Finestre aperte e pulsanti Salva
visibili impediscono il riuso. Le pagine dei risultati globali non sono
riutilizzate: lo zero di una ricerca precedente non prova un nuovo esito.

Eliminati inoltre i 55 ms fissi tra i caratteri del CF: restano eventi di
tastiera reali, attesa del debounce, controllo della query inviata, rete,
spinner, stabilità dei risultati e rilettura del CF su ogni candidato.
Budget di retry, controlli sessione e verifiche delle scritture invariati.

Il primo prototipo non riconosceva il suffisso delle URL effettive e non dava
un guadagno stabile nel confronto alternato. È stato corretto prima del
confronto finale; i file del prototipo sono conservati e non costituiscono
la prova prestazionale della consegna.

## Altre osservazioni e verifiche

- Diagnostica iniziale in sola lettura: cinque snapshot e 20 contratti di rete.
- Tre ricerche sintetiche senza riscontri confermate anche con il codice
  candidato; nessuna usata per calcolare il guadagno del confronto alternato.
- Verifica positiva reale anche partendo dalla scheda di un immobile:
  proprietario e CF attesi confermati, una richiesta documento osservata.
- Lettura identità contro lettura completa di un immobile noto: 5,31 contro
  10,23 secondi nel primo campione. È una verifica dell'ottimizzazione già
  presente nella 0.34.26, non un ulteriore guadagno attribuito alla 0.34.27.
- I controlli sessione misurati richiedono circa 0,8–17 ms: non sono il collo
  di bottiglia osservato e non vengono indeboliti.
- Quattro nuove regressioni browser: dettaglio con/senza suffisso, debounce
  ritardato, mancato riuso dello zero precedente e risultato tardivo mentre
  appare inizialmente Clienti 0. Tutte passate.
- Altre 65 regressioni su adattatore e identità passate. Il conteggio non si
  somma a quello della suite completa.
- Suite completa seriale **941 test passati in 115 suite**, uscita 0,
  durata 626 secondi. Build Worker/desktop e installer 0.34.27 passati.
- Pacchetto verificato: adattatore uguale alla compilazione corrente, nessun
  file ambiente o chiave di credenziali nella configurazione. Installer
  non firmato, 99.871.906 byte, SHA-256
  `1173c341c870d8242bb0e2280b5181ddec7f833ec282a10c89f39ade1d119997`.

Stato di questa revisione: pronto per la pubblicazione della 0.34.27; l'esito
del canale e dell'aggiornamento installato è riportato dopo la consegna.

Per ripetere il controllo della ricerca vuota con tempo misurato, Worker fermo
e Chrome di lavoro aperto:

```powershell
npm.cmd --prefix worker run import-v2:calibrate-search
```

Il comando già esistente ora distingue `readOnly`, `synthetic`, `durationMs`,
`verifiedEmpty` e `matchCount`. Il tempo riguarda la chiamata all'adattatore;
esclude connessione Chrome, ripristino della scheda e acquisizione SISTER.

Le prove non acquisiscono da SISTER una nuova via e non misurano la copertura
di un nuovo lotto. I recuperi annidati restano da misurare su run con errori:
questi confronti non giustificano ridurre i tentativi o scartare nominativi.

## Evidenze e riservatezza

Cartella locale `.runtime/v2-live-2026-10-26/`: `alternating-final.json`,
`comparison-summary.json`, `baseline-provenance.json`, `empty-final.json`,
`package.json` e `worker-full-final.log`. La baseline proviene dal pacchetto
installato 0.34.26; il riepilogo salva gli hash degli adattatori confrontati.
Il codice della baseline è estratto solo nella cartella compilata ignorata
da Git, non nel programma installato.

Report senza CF, nomi, recapiti, valori dei moduli, cookie o header. I conteggi
delle richieste sono diagnostici, non attestano da soli completezza o successo
di un import. L'URL iniziale del gestionale è ripristinato al termine delle prove.
