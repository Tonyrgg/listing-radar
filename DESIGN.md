---
name: Listing Radar
description: CRM operativo privato per completare e valutare annunci immobiliari.
source: src/styles/tokens.css
verify: npm run design:check
colors:
  canvas: "#0e1411"
  surface: "#1f2823"
  raised: "#2e3831"
  line: "#6d746e"
  line-quiet: "#454e47"
  ink: "#f1f4ef"
  ink-2: "#b7c2ba"
  ink-3: "#96a29b"
  accent: "#74c495"
  accent-ink: "#0d1410"
  warn: "#e6b655"
  danger: "#f08872"
  info: "#84b9db"
typography:
  page:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  section:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  record:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 650
    lineHeight: 1.35
  body:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  meta:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0.09em"
rounded:
  control: "6px"
  container: "10px"
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

**Creative North Star: "La Sala Operativa"**

Listing Radar deve sembrare uno spazio di lavoro privato, calmo e sempre sotto
controllo. La densità serve a ridurre i passaggi: la coda corrente domina, i
segnali di acquisizione restano visibili e le statistiche non competono con la
prossima azione.

Il sistema rifiuta l'estetica da dashboard promozionale. Niente decorazioni
gratuite, pannelli analitici equivalenti o score tecnici privi di una
motivazione leggibile.

**Key Characteristics:**
- Una sola cosa grida per schermata; tutto il resto sussurra in modo leggibile.
- Grafite verdastra in scuro, carta in chiaro: due temi, gli stessi token.
- Un solo accento salvia, riservato al passo successivo.
- Azioni esplicite, foto reali e motivazioni comprensibili.
- Target interattivi di almeno 44 pixel e focus sempre visibile.

## The single source

Tutti i valori di questo documento vivono in **`src/styles/tokens.css`**.

Quel file viene copiato in `worker/src/desktop/renderer/tokens.css` e in
`extension/tokens.css` da `npm run design:sync`. Le copie non si modificano a
mano: `npm run design:check` fallisce se divergono, e lo stesso controllo gira
nei test (`tests/design-system.test.ts`).

Un valore di colore scritto dentro un componente è un errore, non una scorciatoia.

## Colors

La palette usa superfici grafite verdastre, testo caldo e un accento salvia
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
- **Stato**: `--lr-warn`, `--lr-danger`, `--lr-info` e il neutro. Significano
  «ecco come stanno le cose».

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

**Display e Body:** Geist (con fallback Arial e sans-serif).

**Character:** Una singola famiglia sans mantiene il CRM tecnico ma non freddo.
Peso, dimensione e contrasto creano la gerarchia; il viewport non modifica la
dimensione dei caratteri.

### Scale — sei gradini, nessuna eccezione
- **Page** 28 px · titolo di pagina, uno solo per schermata.
- **Section** 20 px · titoli di pannello e prima azione.
- **Record** 16 px · titolo di un annuncio, di una richiesta, di un immobile.
- **Body** 14 px · testo corrente. È il default del prodotto.
- **Meta** 13 px · date, fonti, contesto.
- **Label** 11 px · occhielli in maiuscoletto, con tracking positivo.

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
Pillole compatte con cinque toni. Comunicano stato o categoria e portano sempre
una forma oltre al colore. Non sostituiscono mai un pulsante.

### Cards
Un raggio, un bordo, nessuna ombra. `CardHeader` porta titolo, metadato e al
massimo un'azione.

### Stripe
La banda laterale da 3 px indica l'urgenza di una riga senza consumare
l'accento. È il segnale che permette di lasciare la struttura identica fra uno
stato e l'altro.

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
