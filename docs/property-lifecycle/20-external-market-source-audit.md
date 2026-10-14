# Phase 2 — audit delle fonti pubbliche

Audit del 14 ottobre 2026, prima di implementare gli adapter. Nessuna modifica a produzione.

Verifica aggiuntiva del 14 ottobre, 21:43 UTC: Chrome headless ordinario, contesto isolato, senza stealth/proxy/cookie importati o interazione con challenge. Inventory Wikicasa Bitonto, Wikicasa Crocifisso 29812570, Immobiliare Crocifisso 128823342 e Casa 54520194 restituiscono ancora **403**. Metadati in `tests/fixtures/property-lifecycle/external/browser-access-audit.json`; nessun token o body challenge committato.

## Wikicasa

- Metodo: HTTP pubblico e consultazione di pagine primarie tramite indice web. HTTP diretto di `/vendita-case/bitonto/` e dei dettagli 30533235, 30644308, 28897794: **403 Cloudflare**, non inventory vuota. `robots.txt` accessibile; gli endpoint `/api-nuxt/`, `/rest/realEstate/`, `/ws/` sono disallowed: non utilizzati.
- Identificatore pubblico: `/annuncio/{id}`, «Rif. Interno». «Rif. Esterno» e «Rif. Immobile» sono altri identificatori, non intercambiabili.
- Data: «Data annuncio» è un claim di pubblicazione. Mai una data di incarico. Non usare la data di crawling dell'indice.
- Prezzo: 28897794 espone 80.000 e precedente 100.000, senza data del ribasso. 29718340 mostra discrepanza fra prezzo e descrizione: conservarla, non trasformarla in ribasso.
- Inventario/paginazione: inventario pubblico geografico; markup corrente e completezza **non verificati tramite HTTP diretto**. Link next, totale e identità di ciascuna pagina devono concordare. Una pagina indicizzata non dimostra completezza. Nessuna autorizzazione missing in questa fase.
- Agenzie: Ad Maiora 30533235 (25/07/2026), Studi Santi 30644308 (12/08/2026), Tecnocasa 30171085 (13/06/2026) verificabili su pagine primarie recuperate dall'indice. RE/MAX e Gabetti richiedono ancora fixture HTML live affidabili; assenza dai risultati di ricerca non è assenza dal mercato.
- Stato/venduto/agente: accettare soltanto etichette esplicite pertinenti all'annuncio, mai parole nella descrizione o suggerimenti di altri annunci. Nessuna semantica universale verificata per venduto.
- JSON-LD, sitemap, endpoint: contratto per JSON-LD e HTML pubblico; struttura live non ancora validata. Nessun endpoint interno o bypass anti-bot.
- Rate limit non documentato: default una richiesta alla volta, pausa 1,5 secondi, timeout 20 secondi, massimo due retry esponenziali; rispettare Retry-After. 403 interrompe la fonte.
- Confidence: claim primario esplicito forte, copia da indice più debole; policy centralizzata/versionata. Fonte disabilitata per default.

## Immobiliare.it

- Verificatore mirato di URL noti `/annunci/{id}/`, non inventory nazionale. HTTP diretto nel probe: 403. Non associare l'ID del probe a Bitonto senza prova geografica.
- Le pagine primarie indicizzate espongono «Venduto il DD/MM/YYYY», «Annuncio aggiornato il», e talvolta agente nominato. Data di aggiornamento separata da pubblicazione/vendita.
- «Venduto» senza data dà solo sold observed; 404/410 danno indisponibilità dell'URL, **mai vendita o missing sano**. Date di vendita future/malformate non accettate.
- Rischi: pagina di errore/captcha, redirect, annunci correlati, testo negato. Validare identità, struttura e località. Abilitazione e interpretazione separate, default off; stessa policy HTTP prudente.

## Casa.it

- URL pubblici `/immobili/{id}/`; probe 403. Fixture reali già presenti dell'adapter V2 Studio Casa documentano `__NEXT_DATA__.props.pageProps.pdp` e inventory `__INITIAL_STATE__`.
- «Ultimo aggiornamento» e campi di modifica sono esclusivamente PORTAL_MODIFIED_DATE. Non dedurre date da HTTP Last-Modified.
- Solo verificatore di publication nota; nessun nuovo crawler generalizzato. Identity, prezzo, agency e stato soltanto da campi pertinenti; missing non autorizzato. Default off, qualità live da rivalidare.

## Idealista e indice storico

- Idealista: contratto mirato per URL pubblico `/immobile/{id}/`, presence/price/identity. Markup e accesso live non verificati: sperimentale, off, nessun missing.
- Indice: import di una prova selezionata con URL originale, URL della cattura, timestamp della cattura e metodo. Nessuno scraping generalizzato dei motori; mai trattare uno snippet come presenza attuale o vendita confermata. Precisione inferiore, contraddizioni esplicite.

## Matrice siti agenzia

Gli adapter V2 esistenti restano la base; non crearne copie. La qualità sotto riguarda l'architettura e le fixture esistenti, non una nuova certificazione live.

| Agency | Website / inventory | Stable ID | Published | Sold / offer | Price / images | V2 | Quality / priority |
|---|---|---|---|---|---|---|---|
| Ad Maiora | admaioraimmobiliare.it, WordPress | sì | claim WP | da verificare | sì | sì | A, mantenere |
| Studi Santi | studisantiimmobiliare.it, sitemap | sì | da verificare | da verificare | sì | sì | B, mantenere |
| Studio Casa | Casa.it publisher 1098672 | sì | non confondere modified | da verificare | sì | sì | B, accesso bloccato da rivalidare |
| Futura, Garofalo, Iconacasa, Momento, Punto Casa, Trio, Vistocasa | URL configurati in agencies / adapter V2 | sì nelle fixture | variabile | alcuni espliciti | sì | sì | B, mantenere e smoke per fonte |
| RE/MAX Bitonto | branch e inventario esatto da verificare | riferimento noto 41091011-176 | da verificare | da verificare | da verificare | no | C provvisoria, audit live prima di adapter |
| Gabetti Bitonto | sito e branch esatti da verificare | da verificare | da verificare | da verificare | da verificare | no | C provvisoria, audit prima di adapter |
| Tecnocasa Bitonto | branch da registrare esplicitamente | ID portale | claim Wikicasa | da verificare | sì | no | controllo; OUR_AGENCY solo da registry configurata |

Non implementare adapter A/B già presenti una seconda volta. Fonti mancanti senza inventario validato restano in studio.

## Follow-up: fonte primaria RE/MAX Stella Polare

Studio aggiuntivo prima dell'implementazione: 14 ottobre, 21:56–21:59 UTC. HTTP diretto pubblico, senza cookie o bypass. Detail Crocifisso e homepage 200; Wikicasa e Immobiliare restano 403. Gabetti 3339528 risponde 404 benché la copia indicizzata conservi il dettaglio di Bitonto, agenzia Bari Palese Santo Spirito: non una prova di presenza corrente o della branch Gabetti Bitonto.

- Access method: HTML pubblico del solo host `stella-polare.remax.it`; nessun endpoint interno. `robots.txt` pubblico; inventory raggiungibile seguendo il redirect pubblico a `/agenzia/stella-polare/vendita-case?contractType=vendita`.
- Inventory/pagination: pagina inventory 200, ma nessuna lista SSR verificabile. UI e paginazione dipendono da hydration: **non implementare crawler né autorizzare missing sulla base di questa risposta**. Il verificatore usa soltanto URL noti nello scope Bitonto/Palombaio/Mariotto.
- Identity: canonical e `RealEstateListing.url` concordanti; riferimento pubblico finale dell'URL e `Rif.` della pagina. Ogni listing JSON-LD deve essere pertinente al canonical. Provider/agent appartengono al listing, non ai suggerimenti.
- Date: `datePosted` è un claim di pubblicazione; «Ultimo aggiornamento» è modified. Mai incarico o data del ribasso. Nessuna data da media, HTTP o timestamp del server.
- Status/sold: `Offer.availability=InStock` e `businessFunction=Sell` danno presenza/in vendita. `SoldOut` segnala indisponibilità, **non vendita immobiliare dimostrata**. Venduto/trattativa richiedono un'etichetta esplicita pertinente; nessun significato dedotto da descrizioni o annunci simili.
- Evidence: asking, date, provider, agente e immagini primarie, con URL/observed_at/confidence/policy. Coordinate senza prova di precisione esatta restano approximate.
- Rate limits: non documentati, stessa policy sequenziale (1,5 s, timeout 20 s, retry/backoff/Retry-After); flag individuale spento. Nessun crawler nazionale o inventory regionale senza filtro.
- Quality: **A per detail mirato**, **C per inventory**. Acquisite tre fixture primarie in scope (Crocifisso, Corte Abbate Loiacono, Giandomenico Romano); controllo fuori scope tramite mutazione esplicita del contratto, non falsa cattura live. La singola pagina Crocifisso non certifica tutti i tipi di immobili.
- Risks/confidence: datePosted primario esplicito forte; attribution della branch da provider, mai dal solo marchio. Agency mapping esatto richiesto per promuovere stati. Agent identity solo dal campo `realEstateAgent` del nodo pertinente. Nessuna inferenza di vendita da 404, SoldOut o assenza.


## Caso Crocifisso 52

La ricerca mirata ha successivamente recuperato le pagine primarie indicizzate: [Wikicasa 29812570](https://www.wikicasa.it/annuncio/29812570) dichiara 5 maggio 2026, 195.000 euro e precedente 225.000; [Immobiliare 128823342](https://www.immobiliare.it/annunci/128823342/) mostra 155.000, precedente 195.000 e aggiornamento 22 settembre 2026; [RE/MAX Stella Polare](https://stella-polare.remax.it/vendita-casa-indipendente/bitonto/centro-41091011-176) mostra 155.000 e ultimo aggiornamento 22 settembre. La [pagina RE/MAX storica](https://www.remax.it/trova/immobile/Casa-Indipendente-In-Vendita-Bitonto_41091011-176) recuperata dall'indice mostra 225.000 e agente Nicola Sicolo. Sono retrieval di indice, non fetch HTTP live certificati. Conservare le prove separatamente: il 22 settembre è una data di aggiornamento, **non la data dimostrata del ribasso**. Nessun hardcoding o backfill. Questo caso verifica anche il rischio di copie indicizzate non sincronizzate. Il successivo follow-up ha ottenuto il detail primario RE/MAX via HTTP 200, come documentato nel [report 22](22-external-market-primary-validation.md).
