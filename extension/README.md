# Listing Radar Importer

Estensione Chrome privata per importare i dati visibili della scheda annuncio
attualmente aperta.

## Installazione

1. Aprire `chrome://extensions`.
2. Attivare **Modalita sviluppatore**.
3. Selezionare **Carica estensione non pacchettizzata**.
4. Scegliere la cartella `extension`.

Al primo avvio l'URL proposto e
`https://listing-radar-mu.vercel.app`. Inserire come token lo stesso valore
configurato in `EXTENSION_API_TOKEN` su Vercel.

L'estensione usa solo la scheda attiva, salva la configurazione in
`chrome.storage.local` e invia i dati a `POST /api/import/browser`.

Raccoglie fino a 30 URL di foto pubbliche da metadati strutturati, immagini
responsive, lazy loading e gallerie visibili.

Per Idealista, Immobiliare.it, Subito e Casa.it usa un adattatore dedicato alla
struttura della pagina. Se un portale cambia markup o non viene riconosciuto,
l'estensione continua con il parser generico e registra in `raw_payload` quale
parser e stato usato.

Dopo un aggiornamento dei file, premere **Ricarica** sulla scheda
dell'estensione in `chrome://extensions`, poi aggiornare la pagina
dell'annuncio prima di importarla.

La versione 0.5.0 aggiunge parser piu robusti per Idealista, Immobiliare.it,
Casa.it e Subito, usando anche le sezioni testuali della pagina quando il markup
visuale cambia. Mostra inoltre i campi principali non rilevati. Nella
configurazione si
puo inoltre attivare l'import automatico: viene eseguito soltanto quando la
pagina e stata aperta da **Nuovi arrivi** e contiene l'identificativo
`listing-radar` nel frammento URL.
