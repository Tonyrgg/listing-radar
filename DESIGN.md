---
name: Listing Radar
description: Archivio privato di intelligence immobiliare.
source: src/styles/tokens.css
verify: npm run design:check
---

# Design di Listing Radar

## Riferimento approvato, 10 novembre 2026

La registrazione fornita dall’utente, Registrazione 2026-11-10 220051.mp4,
sostituisce i precedenti riferimenti di impaginazione. Il riferimento è
l’interfaccia interna di Avistador, osservata nel video, con tema scuro richiesto
per Listing Radar. La priorità è una consultazione compatta su monitor d’ufficio.

## Struttura

- Navigazione stabile da 204 px, richiudibile a 56 px. Una label per destinazione.
- Intestazione compatta, senza titoli e descrizioni duplicati.
- Registro: filtri in una colonna da 216 px, risultati in una tabella vera.
- Una colonna per dato: immobile, zona, richiesto, €/m², giorni, ribassi, fonte,
  stato. Foto piccola. Indice solo nella vista che ordina i segnali.
- Opportunità usa le stesse righe del registro e aggiunge la motivazione.
- Notizie: elenco di situazioni apribili. Titolo, descrizione breve, luogo, data
  e tipo di fonte precedono le prove e le azioni di valutazione.
- Dossier: contenuto principale e colonna destra da 260–300 px. Foto e sintesi
  affiancate, poi storico prezzi, pubblicazioni, posizione, prove e documenti.
- Azioni, verifiche aperte, motivi, ultimi eventi e fonti nella colonna destra.
- Niente griglie di pannelli equivalenti o contenitori annidati per ogni dato.

## Gerarchia

Titoli pagina 20 px; titoli dossier 18 px; corpo 13–14 px; metadati 12–13 px.
Valori numerici allineati a destra nelle tabelle. Righe da circa 56 px, invece
di schede a tutta altezza. Separatori sottili e superfici piatte.
I controlli mobili principali mantengono 44 px di altezza.

## Colore e forma

Tema scuro predefinito per i nuovi accessi, rispettando le preferenze già salvate.
Canvas antracite, superfici appena distinte, testo chiaro e accento verde tenue.
Palette in src/styles/tokens.css, composizione in src/styles/radar-workspace.css.
Raggi piccoli. Niente gradienti, ombre decorative, bordi colorati laterali.
Gli stati usano testo e forma oltre al colore.

## Regole sui dati

La compattezza non elimina la provenienza. I prezzi sono richiesti.
I giorni distinguono monitoraggio da anzianità pubblica dimostrabile.
L’indice ordina indizi e non è una probabilità.
Non si inventa un grafico da un prezzo singolo; prezzi discordanti non si
fondono in una serie. Un’area geografica non identifica la singola unità.
Le azioni disponibili corrispondono al prodotto esistente, senza simulare
telefonate, mandati o dati comparabili non presenti.

## Responsive

A 1024 px il registro conserva le colonne e scorre dentro la propria regione.
A 390 px i filtri partono chiusi; la pagina non scorre orizzontalmente.
Il dossier diventa una colonna, con azioni accessibili e verifiche ancora
consultabili. I contenuti secondari si aprono con controlli espliciti.

## Verifica

Controllo TypeScript, ESLint sui componenti modificati, test sui modelli e sulla
rappresentazione delle prove, sincronizzazione token e controllo contrasto.
Ispezione delle schermate locali a 1600, 1024 e 390 px.
La pubblicazione richiede un passaggio separato dall’anteprima locale.
