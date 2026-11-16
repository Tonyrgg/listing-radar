# Intelligence: filtro zone disegnate — 16 novembre 2026

Il menu Territorio → Zona disegnata usa le aree salvate in map_areas, le stesse mostrate in Territorio e nel Worker (es. Tony Borgo San francesco, Zona Carmen). Le aree operative rimangono distinte dai quartieri di internal_zones e dalle zone dichiarate dalla fonte: non vengono riscritti i dati degli immobili.

Disponibile nelle liste immobiliari Mercato, Opportunità, Radar privati, Usciti/Venduti e Preferiti. La selezione è un ID persistente, compare tra i filtri rimovibili, viene mantenuta durante ordinamento/paginazione e passando fra le liste. Il vecchio filtro testuale zona resta leggibile negli URL storici.

L'associazione è geografica, sulla posizione disponibile. I punti non localizzati non entrano nel filtro; le posizioni approssimative restano tali. Bounding box sul database e verifica Polygon/MultiPolygon (inclusi buchi) precedono la paginazione. Lo scorrimento ordinato è limitato a 20000 candidati e un superamento produce errore esplicito, senza fingere una lista completa.

Verifiche: 2 nuove regressioni per confini/buchi/posizione assente e paginazione oltre la prima pagina di candidati; 2 regressioni esistenti per lettura anzianità. TypeScript, ESLint e build Next passati. Lettura reale di Borgo San Francesco: Mercato 19, Opportunità 8, Privati 0, Usciti 3; tutti i risultati verificati dentro il perimetro. Prova browser: scelta del menu, applicazione, chip del filtro e passaggio a Opportunità conservando la zona, zero errori JavaScript.
