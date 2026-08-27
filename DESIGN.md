---
name: Listing Radar
description: CRM operativo privato per completare e valutare annunci immobiliari.
source: src/styles/tokens.css
verify: npm run design:check
colors:
  canvas: "#eae0cf"
  surface: "#fffdf8"
  raised: "#ebe2d2"
  line: "#807564"
  line-quiet: "#d9cdb9"
  ink: "#16363a"
  ink-2: "#3f5c61"
  ink-3: "#52666a"
  accent: "#a7442b"
  accent-ink: "#ffffff"
  ok: "#34765e"
  warn: "#825b12"
  danger: "#af352d"
  info: "#275d82"
typography:
  page:
    fontFamily: "Instrument Sans, Segoe UI, sans-serif"
    fontSize: "2rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  section:
    fontFamily: "Instrument Sans, Segoe UI, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  record:
    fontFamily: "Instrument Sans, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 650
    lineHeight: 1.35
  body:
    fontFamily: "Instrument Sans, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  meta:
    fontFamily: "Instrument Sans, Segoe UI, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Instrument Sans, Segoe UI, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0.09em"
rounded:
  control: "10px"
  container: "16px"
  pill: "9999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "transparent"
    borderColor: "{colors.line}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  card:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.line}"
    textColor: "{colors.ink}"
    rounded: "{rounded.container}"
    padding: "16px"
  chip:
    borderColor: "{colors.line}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
---

# Design System: Listing Radar

## Overview

**Creative North Star: "Il Registro Operativo"**

Listing Radar deve sembrare uno spazio di lavoro privato, calmo e sempre sotto
controllo. La densità serve a ridurre i passaggi: la coda corrente domina, i
segnali di acquisizione restano visibili e le statistiche non competono con la
prossima azione.

Il sistema rifiuta l'estetica da dashboard promozionale. Niente decorazioni
gratuite, pannelli analitici equivalenti o score tecnici privi di una
motivazione leggibile.

**Key Characteristics:**
- Una sola cosa grida per schermata; tutto il resto sussurra in modo leggibile.
- Petrolio profondo nel worker, carta calda nel tool: due ambienti, gli stessi token.
- Un solo accento rame, riservato al passo successivo.
- Azioni esplicite, foto reali e motivazioni comprensibili.
- Target interattivi di almeno 44 pixel e focus sempre visibile.

## Impronta selezionata

Il riferimento approvato non e un catalogo di funzioni: e una grammatica
visiva. Testi, pulsanti e tabelle presenti nel mockup non autorizzano nuove
azioni. Ogni superficie mantiene soltanto dati, link e comandi gia esistenti.

### Due ambienti coordinati

- **Tool web:** carta calda `canvas`, superfici avorio, inchiostro petrolio.
  Deve sembrare editoriale, leggibile e fotografico, non una dashboard SaaS.
- **Worker:** petrolio profondo, pannelli appena piu chiari e testo crema. Deve
  sembrare una postazione concentrata e procedurale, non una seconda copia del CRM.
- **Rame:** indica il gesto successivo. Non decora titoli, icone o statistiche.
- **Bordi:** un pixel visibile definisce gruppi e controlli. Le ombre sono
  riservate a mappa, dialog, drawer e gusci realmente flottanti.

### Guscio del tool

La rail desktop chiusa e larga 84 px. Ogni destinazione ha icona da 20 px e
label breve da 11 px; la voce attiva usa una superficie rialzata con bordo,
mai un blocco scuro estraneo alla pagina. La rail puo essere riaperta per
mostrare descrizioni e ricerca completa. Su mobile le stesse destinazioni
restano scorribili e nessuna azione scompare.

### Dashboard — riferimento 2a

La prima lettura e fotografica: movimenti reali in una griglia a tre colonne,
immagine 16:9, stato sovrapposto, indirizzo, fonte e dati essenziali. Prezzo e
valori numerici usano IBM Plex Mono. Fiducia delle fonti, arrivi e opportunita
continuano a esistere sotto la parete: il redesign cambia la gerarchia, non la
copertura funzionale.

### Worker principale — riferimento 4a

Il worker usa una testata compatta da 52 px e una rail a tappe da 236 px. La
pagina mostra una sola sezione primaria per volta. Nella lavorazione dominano
la scelta della run, lo stato corrente, il contatore dei tentativi e l'azione
richiesta. Tutti i controlli universali, le long run e la rete di proprietari
restano disponibili; i pannelli inattivi non competono visivamente.

### Sincronizzazione — riferimento 5a

Richieste e incarichi sono due pannelli gemelli, affiancati quando c'e spazio.
Ognuno conserva stato, avanzamento, annullamento e nuova sincronizzazione. Il
mockup non introduce code o decisioni che il prodotto non possiede.

### Cronologia worker — riferimento 5b

Cronologia e una pagina autonoma della rail. Import conclusi e acquisizioni
salvate occupano tutta la larghezza; operazioni e diagnostica sono pannelli
secondari. Contatori, tempi e identificativi sono monospaziati. Dettagli e
azioni esistenti restano raggiungibili senza comprimere i record.

### Commerciale — riferimento 5d

La pagina apre con tre porte basate su dati reali: richieste attive,
abbinamenti disponibili e immobili in portafoglio. Ogni porta e navigabile e
mostra un numero verificabile. Sotto restano ricerca, filtri, clienti e case;
nessun bottone dimostrativo viene copiato dal riferimento.

### Territorio — riferimento 5e

La mappa e la superficie dominante e il pannello di copertura e la sua seconda
colonna. Disegno, pin, strade, case, filtri, legenda, selezione, modifica e
cancellazione restano tutti presenti. Toolbar e indicatori galleggiano sulla
mappa; la scheda laterale racconta il lavoro gia svolto e quello da fare.

## The single source

Tutti i valori di questo documento vivono in **`src/styles/tokens.css`**.

Quel file viene copiato in `worker/src/desktop/renderer/tokens.css` e in
`extension/tokens.css` da `npm run design:sync`. Le copie non si modificano a
mano: `npm run design:check` fallisce se divergono, e lo stesso controllo gira
nei test (`tests/design-system.test.ts`).

Un valore di colore scritto dentro un componente è un errore, non una scorciatoia.

## Colors

La palette usa superfici petrolio, carta calda, testo profondo e un accento rame
riservato alle azioni. Ogni coppia è verificata in sRGB contro WCAG 2.1 AA da
`scripts/check-design-contrast.mjs`.

### Surfaces
Tre livelli — canvas, superficie, rialzata — separati da salti percettibili ma
contenuti (≥ 1,2:1). La calma nasce da questa vicinanza.

### Lines
`--lr-line` è il confine di un componente e resta **≥ 3:1** sulla superficie che
lo circonda: è la linea a separare, non il riempimento (WCAG 1.4.11).
`--lr-line-quiet` divide contenuto dentro la stessa superficie ed è decorativa.

### Action vs. state
Due famiglie separate.
- **Azione**: il solo `--lr-accent`. Significa «questo è il passo successivo».
- **Stato**: `--lr-ok`, `--lr-warn`, `--lr-danger`, `--lr-info` e il neutro.
  Significano «ecco come stanno le cose».

`--lr-ok` è il verde della conferma: un collegamento pronto, una fonte letta
per intero, un import concluso, un immobile che rientra nel budget. Esiste
perché senza di lui «va tutto bene» finiva scritto in rame, e l'accento non
significava più niente.

### Data
`--lr-data-*` e `src/lib/design/map-palette.ts` servono a distinguere categorie
sulla mappa. Non appartengono né all'azione né allo stato, e non entrano
nell'interfaccia fuori dalla mappa.

### Named Rules

**The One Accent Rule.** Un solo elemento pieno d'accento per regione di
schermo. L'accento non colora occhielli, icone decorative, categorie o hover.

**The Semantic Status Rule.** Warning ed errori usano sempre i token semantici e
non dipendono soltanto dal colore: il chip porta un pallino, la riga porta una
banda laterale, il testo dice lo stato a parole.

**The Measured Palette Rule.** Nessun token entra nel sistema senza passare
`npm run design:check`. Il documento non può più divergere dal codice.

## Typography

**Display e Body:** Instrument Sans (con fallback Segoe UI e sans-serif).

**Dati:** IBM Plex Mono, limitato a prezzi, contatori, tempi, versioni e
identificativi. Non si usa per paragrafi, titoli o navigazione.

**Character:** Una singola famiglia sans mantiene il CRM tecnico ma non freddo.
Peso, dimensione e contrasto creano la gerarchia; il viewport non modifica la
dimensione dei caratteri.

### Scale — sei gradini, nessuna eccezione
- **Page** 32 px · titolo di pagina, uno solo per schermata.
- **Section** 22 px · titoli di pannello e prima azione.
- **Record** 16 px · titolo di un annuncio, di una richiesta, di un immobile.
- **Body** 14 px · testo corrente. È il default del prodotto.
- **Meta** 13 px · date, fonti, contesto.
- **Label** 11 px · occhielli in maiuscoletto, con tracking positivo.

I gradini vivono in `--lr-text-*`. Le classi di comodo di Tailwind — `text-xs`,
`text-sm`, `text-base` — non appartengono a questa scala: al loro posto si
scrive `text-[length:var(--lr-text-meta)]` e simili.

### Weights — tre, non diciotto
400 regolare · 500 medio · 650 forte. Sono i tre che l'occhio distingue.

### Named Rules

**The Operational Type Rule.** Il testo più grande appartiene solo alla pagina;
card, pannelli e righe usano titoli compatti adatti alla scansione ripetuta.

**The No Whisper Rule.** Sotto gli 11 px non si scrive niente, e l'11 px è
riservato alle etichette. Il metadato parte da 13 px.

## Elevation

Due soli livelli, dichiarati.
- **Piano**: tutto ciò che appartiene alla pagina. Nessuna ombra.
- **Flottante**: mappa, drawer, finestre di dialogo e conferme. Usa
  `--lr-floating`, e solo quello.

### Named Rules

**The Flat By Default Rule.** Ogni superficie di pagina resta piatta; hover e
focus cambiano colore o bordo senza sollevare il componente. Niente gradienti.

## Components

Un componente per ogni lavoro, e uno solo. Vivono in
`src/components/ui/primitives.tsx` e `src/components/ui/feedback.tsx`.

### Buttons
`primary` · `secondary` · `quiet` · `danger`. Altezza 44 px, 36 px in versione
compatta. Un solo `primary` per regione di schermo.

### Chips
Pillole compatte con sei toni — neutro, azione, conferma, attenzione, critico,
informativo. Comunicano stato o categoria e portano sempre una forma oltre al
colore. Non sostituiscono mai un pulsante.

### Cards
Un raggio, un bordo, nessuna ombra. `CardHeader` porta titolo, metadato e al
massimo un'azione.

I raggi sono due: `--lr-radius-control` (10 px) per controlli, chip e riquadri
interni, `--lr-radius-container` (16 px) per contenitori e pannelli flottanti.
Un raggio scritto in pixel dentro un componente è un errore, come un colore.

### Stripe
Un pallino di 8 px indica l'urgenza di una riga senza consumare l'accento.
È il segnale che permette di lasciare la struttura identica fra uno stato e
l'altro: cambia il tono del punto, non la forma della riga. Una banda laterale
creerebbe una colonna che nella parete di schede non esiste.

### Feedback
- **Riuscito**: conferma breve, con «Annulla» dove l'operazione è reversibile.
- **Fallito**: cosa è andato storto, cosa non è andato perso, cosa fare ora.
- **Vuoto**: cosa è successo e cosa succederà dopo. Mai finte barre di caricamento.
- **Irreversibile**: `ConfirmDialog` del prodotto. Mai `window.confirm`.

### Navigation
Cinque destinazioni — Oggi, Immobili, Segnali, Commerciale, Territorio — più le
impostazioni tenute separate in fondo. Ogni sezione porta dentro le proprie
sotto-pagine: nessuna pagina è raggiungibile solo da un link nel testo.

### Density
Tre densità dichiarate — coda, lista, dettaglio — scelte dalla schermata, non
subite dal singolo componente.

## Voice

Una sola voce, in italiano, per tutte e tre le superfici.

- I bottoni dicono cosa succede: «Apri e completa», «Metti da parte».
- Se una stringa è in `MAIUSCOLO_CON_UNDERSCORE`, non è pronta per l'utente:
  passa da `presentation.ts`.
- Nessun punteggio senza la frase che lo spiega.
- Gli accenti si scrivono: à è ì ò ù.

## Do's and Don'ts

### Do:
- **Do** mettere la coda da completare prima delle statistiche.
- **Do** far gridare una cosa sola per schermata.
- **Do** tenere identica la struttura di una riga fra i suoi stati.
- **Do** spiegare ogni opportunità con una motivazione comprensibile.
- **Do** confermare ogni azione riuscita, e offrire «Annulla» dove è reversibile.
- **Do** verificare sempre 390, 1024 e 1600 pixel senza overflow orizzontale.
- **Do** eseguire `npm run design:check` prima di toccare la palette.

### Don't:
- **Don't** scrivere un colore dentro un componente.
- **Don't** usare l'accento per categorie, occhielli o decorazione.
- **Don't** aprire una scheda nuova del browser per un link interno.
- **Don't** usare la finestra di conferma del browser.
- **Don't** creare griglie di metriche tutte equivalenti e prive di priorità.
- **Don't** usare dashboard decorative con gradienti, bagliori, vetro o neon.
- **Don't** mostrare pannelli pieni di score tecnici senza una motivazione.
- **Don't** nascondere il prossimo passo dietro statistiche descrittive.
- **Don't** annidare card dentro altre card o usare pannelli flottanti come
  sezioni di pagina.
