# Listing Radar Importer

Estensione Chrome privata per importare i dati visibili della scheda annuncio
attualmente aperta.

## Installazione

1. Aprire `chrome://extensions`.
2. Attivare **Modalita sviluppatore**.
3. Selezionare **Carica estensione non pacchettizzata**.
4. Scegliere la cartella `extension`.

Al primo avvio inserire l'URL di Listing Radar e lo stesso valore configurato in
`EXTENSION_API_TOKEN`.

L'estensione usa solo la scheda attiva, salva la configurazione in
`chrome.storage.local` e invia i dati a `POST /api/import/browser`.

Raccoglie fino a 30 URL di foto pubbliche da metadati strutturati, immagini
responsive, lazy loading e gallerie visibili. Dopo un aggiornamento dei file,
premere **Ricarica** sulla scheda dell'estensione in `chrome://extensions`.
