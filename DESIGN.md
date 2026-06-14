---
name: Listing Radar
description: CRM operativo privato per completare e valutare annunci immobiliari.
colors:
  operations-canvas: "oklch(0.135 0.009 155)"
  operations-panel: "oklch(0.17 0.01 155)"
  operations-muted: "oklch(0.215 0.012 155)"
  operations-elevated: "oklch(0.245 0.013 155)"
  sage-action: "oklch(0.74 0.105 145)"
  sage-action-hover: "oklch(0.8 0.11 145)"
  sage-action-soft: "oklch(0.23 0.035 145)"
  warm-ink: "oklch(0.93 0.008 105)"
  soft-ink: "oklch(0.74 0.012 120)"
  subtle-ink: "oklch(0.58 0.012 135)"
  soft-line: "oklch(0.255 0.012 155)"
  strong-line: "oklch(0.34 0.016 155)"
  warning: "oklch(0.78 0.11 80)"
  error: "oklch(0.72 0.14 24)"
typography:
  headline:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0"
  title:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  body:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.14em"
rounded:
  control: "6px"
  panel: "8px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.sage-action}"
    textColor: "{colors.operations-panel}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.operations-panel}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  panel:
    backgroundColor: "{colors.operations-panel}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.panel}"
    padding: "20px"
  status-chip:
    backgroundColor: "{colors.sage-action-soft}"
    textColor: "{colors.sage-action}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
---

# Design System: Listing Radar

## Overview

**Creative North Star: "La Sala Operativa"**

Listing Radar deve sembrare uno spazio di lavoro privato, calmo e sempre sotto
controllo. La densita serve a ridurre i passaggi: la coda corrente domina, i
segnali di acquisizione restano visibili e le statistiche non competono con la
prossima azione.

Il sistema rifiuta l'estetica da dashboard promozionale. Niente decorazioni
gratuite, pannelli analitici equivalenti o score tecnici privi di una
motivazione leggibile.

**Key Characteristics:**
- Tema scuro grafite con un solo accento salvia operativo.
- Layout full width, gerarchia asimmetrica e alta densita controllata.
- Azioni esplicite, foto reali e motivazioni comprensibili.
- Target interattivi di almeno 44 pixel e focus sempre visibile.

## Colors

La palette usa superfici grafite verdastre, testo caldo e un accento salvia
riservato alle azioni e agli stati positivi.

### Primary
- **Salvia operativa:** azioni primarie, stato attivo, icone e collegamenti ad alta priorita.

### Neutral
- **Grafite profonda:** fondo continuo dell'applicazione.
- **Grafite pannello:** navigazione, pannelli e righe operative.
- **Inchiostro caldo:** titoli, valori e contenuto essenziale.
- **Inchiostro attenuato:** metadati, descrizioni e informazioni secondarie.

### Named Rules

**The One Accent Rule.** L'accento salvia deve restare raro e funzionale; non
deve diventare un colore decorativo di superficie.

**The Semantic Status Rule.** Warning ed errori usano sempre i token semantici e
non dipendono soltanto dal colore: testo o icona devono esplicitare lo stato.

## Typography

**Display Font:** Geist (con fallback Arial e sans-serif)
**Body Font:** Geist (con fallback Arial e sans-serif)

**Character:** Una singola famiglia sans mantiene il CRM tecnico ma non freddo.
Peso, dimensione e contrasto creano la gerarchia; il viewport non modifica la
dimensione dei caratteri.

### Hierarchy
- **Headline:** titoli pagina, massimo due righe sui viewport mobili.
- **Title:** intestazioni di pannelli e titoli degli annunci.
- **Body:** descrizioni e dati operativi, con interlinea ariosa.
- **Label:** soprattitoli e categorie in maiuscolo con tracking positivo.

### Named Rules

**The Operational Type Rule.** Il testo piu grande appartiene solo alla pagina;
card, pannelli e righe usano titoli compatti adatti alla scansione ripetuta.

## Elevation

Il sistema non usa ombre. La profondita nasce da differenze tonali contenute,
bordi sottili e separatori; modali e overlay futuri devono seguire la stessa
logica senza bagliori.

### Named Rules

**The Flat By Default Rule.** Ogni superficie resta piatta; hover e focus
cambiano colore o bordo senza sollevare fisicamente il componente.

## Components

### Buttons
- **Shape:** angoli contenuti e altezza tattile costante.
- **Primary:** salvia piena con testo scuro, riservato all'azione successiva.
- **Hover / Focus:** variazione tonale breve e anello di focus salvia visibile.
- **Secondary:** superficie del pannello, bordo forte e testo caldo.

### Chips
- **Style:** pillole compatte con fondo tonale, bordo e testo semantico.
- **State:** comunicano fonte o stato; non sostituiscono un pulsante.

### Cards / Containers
- **Corner Style:** raggio contenuto.
- **Background:** pannello grafite distinto dal canvas.
- **Shadow Strategy:** nessuna ombra.
- **Border:** un pixel, sempre tramite i token di linea.
- **Internal Padding:** compatto, normalmente tra 16 e 20 pixel.

### Inputs / Fields
- **Style:** fondo grafite, bordo forte, raggio da controllo e altezza minima di 44 pixel.
- **Focus:** anello salvia esterno; nessun glow.
- **Error / Disabled:** token semantico con spiegazione testuale.

### Navigation

La navigazione e verticale e persistente su desktop; su mobile diventa una riga
orizzontale scorrevole. Lo stato attivo usa fondo salvia attenuato, icona e
testo salvia.

### Operational Queue

La coda mostra foto, fonte, data, titolo, dati essenziali e una sola azione. Su
mobile la miniatura resta compatta e il pulsante occupa una riga separata; su
desktop l'azione resta allineata a destra.

## Do's and Don'ts

### Do:
- **Do** mettere la coda da completare prima delle statistiche.
- **Do** usare tutta la larghezza disponibile sui monitor desktop.
- **Do** spiegare ogni opportunita con una motivazione comprensibile.
- **Do** mantenere foto, titolo, prezzo e azione visibili durante la scansione.
- **Do** verificare sempre 390, 1024 e 1600 pixel senza overflow orizzontale.

### Don't:
- **Don't** creare griglie di metriche tutte equivalenti e prive di una priorita operativa.
- **Don't** usare dashboard decorative con gradienti, bagliori, vetro o colori neon.
- **Don't** mostrare pannelli pieni di score tecnici senza una motivazione comprensibile.
- **Don't** introdurre layout stretti che sprecano spazio disponibile su monitor desktop.
- **Don't** nascondere il prossimo passo dietro statistiche descrittive.
- **Don't** annidare card dentro altre card o usare pannelli flottanti come sezioni di pagina.
