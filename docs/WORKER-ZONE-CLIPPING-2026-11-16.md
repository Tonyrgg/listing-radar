# Worker 0.34.50 — ritaglio visivo per zona

Completa la 0.34.49: selezionando zone in Vie per zona, la mappa colora soltanto i segmenti interni alla loro unione. Supporta Polygon/MultiPolygon e buchi; non cambia le geometrie archiviate, i dati catastali o il perimetro della ricerca SISTER.

La funzione geometrica è condivisa e deterministica. Regressione: attraversamento con estremi fuori zona, nessuna intersezione e preservazione dell'originale. Cinque test del modulo passati; build desktop e NSIS completate.
